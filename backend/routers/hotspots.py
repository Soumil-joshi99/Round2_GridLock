"""
routers/hotspots.py
GET /hotspots?at=<ISO timestamp>

Performance contract:
  1. Results are cached per virtual MINUTE. The same floored-minute returns
     instantly without any recomputation.
  2. The heavy CPU work (lag aggregation + model.predict) runs in a thread
     pool via run_in_executor so it never blocks the FastAPI event loop.
"""
import asyncio
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Query

from replay_clock import get_clock
from model_service import get_model_service

router = APIRouter()

# Cache: ISO-minute string → full hotspot list
# e.g. "2024-01-21T09:14" → [...]
_hotspot_cache: dict = {}
_MAX_CACHE_ENTRIES = 120  # ~2h of per-minute entries
_display_name_cache: Optional[dict] = None

def _build_display_names(df: pd.DataFrame, hex_ids: list) -> dict:
    """Pre-compute hex → human readable name (junction, location, or h3 fallback). Static."""
    result = {}
    for h in hex_ids:
        rows = df[df["h3_index"] == h]
        # 1. Junction name
        junctions = [j for j in rows["junction_name"].dropna().unique() if j and j != "No Junction"]
        if junctions:
            result[h] = junctions[0]
            continue
        # 2. Location name (most common)
        locs = rows["location"].dropna()
        locs = locs[locs != ""]
        if not locs.empty:
            result[h] = locs.mode().iloc[0]
            continue
        # 3. Fallback
        result[h] = h
    return result


def _compute_hotspots_sync(ts_floor, clock, ms):
    """
    Synchronous heavy computation — runs in a thread pool.
    Keeps the asyncio event loop unblocked.
    """
    hex_ids = ms.hex_ids
    lags = clock.get_lags_bulk(hex_ids, ts_floor)

    feature_dicts = [
        ms.build_feature_vector(
            h, ts_floor, lags[h]["lag_24h"], lags[h]["lag_168h"], clock.min_time
        )
        for h in hex_ids
    ]
    predictions = ms.predict_batch(feature_dicts)

    h_df = clock.hourly
    actual_last_hour = (
        h_df[h_df["hour_timestamp"] == ts_floor.floor("h")]
        .set_index("h3_index")["ticket_count"]
        .to_dict()
    )

    sp = ms.spatial
    results = []
    for hex_id, pred in zip(hex_ids, predictions):
        lat, lon = ms.hex_center(hex_id)
        results.append({
            "h3_index":       hex_id,
            "display_name":   _display_name_cache[hex_id],
            "lat":            lat,
            "lon":            lon,
            "predicted":      round(pred, 3),
            "actual_last_hr": int(actual_last_hour.get(hex_id, 0)),
            "severity_avg":   round(sp["hex_severity_avg"].get(hex_id, 1.5), 2),
            "is_junction":    int(sp.get("hex_junction", {}).get(hex_id, 0)),
            "wrong_pct":      round(sp["hex_wrong_pct"].get(hex_id, 0.0), 3),
            "footpath_pct":   round(sp["hex_footpath_pct"].get(hex_id, 0.0), 3),
            "hist_mean":      round(sp["hex_hist_mean"].get(hex_id, 0.0), 3),
        })
    return results


@router.get("/hotspots")
async def get_hotspots(at: Optional[str] = Query(None)):
    clock = get_clock()
    ms = get_model_service()

    if at:
        ts = pd.Timestamp(at)
        if ts.tz is None:
            ts = ts.tz_localize("UTC")
    else:
        clock._advance()
        ts = clock.virtual_time

    ts_floor = pd.Timestamp(ts).floor("min")   # minute precision for cache key
    cache_key = ts_floor.isoformat()

    global _display_name_cache
    if _display_name_cache is None:
        _display_name_cache = _build_display_names(clock.df, ms.hex_ids)

    # --- Cache hit: return immediately, no computation ---
    if cache_key in _hotspot_cache:
        results = _hotspot_cache[cache_key]
        active = [r for r in results if r["predicted"] > 0.05 or r["actual_last_hr"] > 0]
        return {
            "timestamp":    cache_key,
            "total_hexes":  len(results),
            "active_hexes": len(active),
            "hotspots":     active,
            "cached":       True,
        }

    # --- Cache miss: run heavy work off the event loop ---
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, _compute_hotspots_sync, ts_floor, clock, ms
    )

    # Store; evict oldest if full
    _hotspot_cache[cache_key] = results
    if len(_hotspot_cache) > _MAX_CACHE_ENTRIES:
        del _hotspot_cache[next(iter(_hotspot_cache))]

    active = [r for r in results if r["predicted"] > 0.05 or r["actual_last_hr"] > 0]
    return {
        "timestamp":    cache_key,
        "total_hexes":  len(ms.hex_ids),
        "active_hexes": len(active),
        "hotspots":     active,
        "cached":       False,
    }
