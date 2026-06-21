"""
routers/enforcement.py
GET /enforcement-priority?at=<ISO>&top_n=20

Priority score formula (all components normalised to [0,1] before combining):
  priority = 0.40 × forecast_norm
           + 0.25 × severity_norm
           + 0.20 × junction_flag
           + 0.15 × repeat_density_norm

Performance:
  - _repeat_density is pre-computed once at first request (expensive, dataset-wide).
  - Full bulk-lag + batch inference runs in a thread pool via run_in_executor.
  - Results are cached per virtual MINUTE so repeated calls return instantly.
"""
import asyncio
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query

from replay_clock import get_clock
from model_service import get_model_service

router = APIRouter()

W_FORECAST = 0.40
W_SEVERITY = 0.25
W_JUNCTION = 0.20
W_REPEAT   = 0.15

# ---------------------------------------------------------------------------
# Module-level caches
# ---------------------------------------------------------------------------
_repeat_density_cache: Optional[dict] = None   # computed once, never changes
_display_name_cache:   Optional[dict] = None   # per-hex junction name, also static

# Response cache: keyed by ts_floor ISO string → full results list
_response_cache: dict = {}
_MAX_CACHE_ENTRIES = 120   # keep at most 120 cached minutes


def _build_repeat_density(df: pd.DataFrame, hex_ids: list) -> dict:
    """
    Count per-hex distinct vehicles with ≥2 violations in the last 7 days
    of the dataset (static window — does NOT move with virtual time).
    Computed once per backend lifetime.
    """
    max_ts = df["hour_timestamp"].max()
    cutoff = max_ts - pd.Timedelta(days=7)
    recent = df[df["hour_timestamp"] >= cutoff]
    vc = recent.groupby(["h3_index", "vehicle_number"]).size()
    repeat_mask = vc >= 2
    repeat_counts = repeat_mask.groupby(level="h3_index").sum().to_dict()
    return {h: int(repeat_counts.get(h, 0)) for h in hex_ids}


def _build_display_names(df: pd.DataFrame, hex_ids: list) -> dict:
    """Pre-compute hex → first named junction (or short hex string). Static."""
    result = {}
    for h in hex_ids:
        junction_rows = df[df["h3_index"] == h]["junction_name"].dropna()
        names = [j for j in junction_rows.unique() if j and j != "No Junction"]
        result[h] = names[0] if names else h[:12] + "…"
    return result


def _get_or_build_static_caches(df: pd.DataFrame, hex_ids: list):
    global _repeat_density_cache, _display_name_cache
    if _repeat_density_cache is None:
        _repeat_density_cache = _build_repeat_density(df, hex_ids)
    if _display_name_cache is None:
        _display_name_cache = _build_display_names(df, hex_ids)


def _compute_enforcement_sync(ts_floor, clock, ms):
    """
    Synchronous heavy computation — runs in a thread pool.
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

    sp = ms.spatial
    forecasts  = np.array(predictions)
    severities = np.array([sp["hex_severity_avg"].get(h, 1.5) for h in hex_ids])
    junctions  = np.array([sp.get("hex_junction", {}).get(h, 0) for h in hex_ids], dtype=float)
    repeats    = np.array([_repeat_density_cache[h] for h in hex_ids], dtype=float)

    def norm(arr):
        mn, mx = arr.min(), arr.max()
        return (arr - mn) / (mx - mn + 1e-9)

    f_norm = norm(forecasts)
    s_norm = norm(severities)
    r_norm = norm(repeats)

    scores = (
        W_FORECAST * f_norm +
        W_SEVERITY * s_norm +
        W_JUNCTION * junctions +
        W_REPEAT   * r_norm
    ) * 100

    # Build full sorted list
    top_idx = np.argsort(scores)[::-1][:100]

    results = []
    for rank, idx in enumerate(top_idx, start=1):
        h = hex_ids[idx]
        lat, lon = ms.hex_center(h)
        results.append({
            "rank":           rank,
            "h3_index":       h,
            "display_name":   _display_name_cache[h],
            "lat":            lat,
            "lon":            lon,
            "priority_score": round(float(scores[idx]), 1),
            "breakdown": {
                "forecast_weight": round(float(W_FORECAST * f_norm[idx] * 100), 1),
                "severity_weight": round(float(W_SEVERITY * s_norm[idx] * 100), 1),
                "junction_weight": round(float(W_JUNCTION * junctions[idx] * 100), 1),
                "repeat_density":  round(float(W_REPEAT   * r_norm[idx]  * 100), 1),
            },
            "raw": {
                "predicted_count":    round(float(forecasts[idx]), 3),
                "severity_avg":       round(float(severities[idx]), 2),
                "is_junction":        int(junctions[idx]),
                "repeat_vehicles_7d": int(repeats[idx]),
            },
        })

    return results


@router.get("/enforcement-priority")
async def enforcement_priority(
    at: Optional[str] = Query(None),
    top_n: int = Query(20, ge=1, le=100),
):
    clock = get_clock()
    ms = get_model_service()

    if at:
        ts = pd.Timestamp(at)
        if ts.tz is None:
            ts = ts.tz_localize("UTC")
    else:
        clock._advance()
        ts = clock.virtual_time

    ts_floor = pd.Timestamp(ts).floor("min")  # minute precision
    cache_key = ts_floor.isoformat()

    _get_or_build_static_caches(clock.df, ms.hex_ids)

    if cache_key in _response_cache:
        cached = _response_cache[cache_key]
        return {
            "timestamp": cache_key,
            "formula": f"{W_FORECAST}×forecast + {W_SEVERITY}×severity + {W_JUNCTION}×junction + {W_REPEAT}×repeat",
            "results": cached[:top_n],
            "cached": True
        }

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, _compute_enforcement_sync, ts_floor, clock, ms
    )

    _response_cache[cache_key] = results
    if len(_response_cache) > _MAX_CACHE_ENTRIES:
        oldest_key = next(iter(_response_cache))
        del _response_cache[oldest_key]

    return {
        "timestamp": cache_key,
        "formula":   f"{W_FORECAST}×forecast + {W_SEVERITY}×severity + {W_JUNCTION}×junction + {W_REPEAT}×repeat",
        "results":   results[:top_n],
        "cached": False
    }
