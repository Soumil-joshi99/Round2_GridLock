"""
routers/forecast.py
GET /hex/{h3_index}/forecast?at=<ISO>&hours=24

Returns:
  - predicted count for each of the next `hours` hours
  - actual historical count for the same period (backtest overlay)
"""
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Path, Query

from replay_clock import get_clock
from model_service import get_model_service

router = APIRouter()


@router.get("/hex/{h3_index}/forecast")
def hex_forecast(
    h3_index: str = Path(...),
    at: Optional[str] = Query(None),
    hours: int = Query(24, ge=1, le=168),
):
    clock = get_clock()
    ms = get_model_service()

    if at:
        ts = datetime.fromisoformat(at)
    else:
        clock._advance()
        ts = clock.virtual_time

    ts_floor = pd.Timestamp(ts).floor("h")

    predicted_series = []
    actual_series = []

    for i in range(hours):
        future_ts = ts_floor + pd.Timedelta(hours=i)
        lag_data = clock.get_lags(h3_index, future_ts)
        fv = ms.build_feature_vector(
            h3_index,
            future_ts,
            lag_data["lag_24h"],
            lag_data["lag_168h"],
            clock.min_time,
        )
        pred = ms.predict(fv)
        predicted_series.append({
            "timestamp": future_ts.isoformat(),
            "predicted": round(pred, 3),
        })

        # Actual historical value at this timestamp
        h = clock.hourly
        row = h[(h["h3_index"] == h3_index) & (h["hour_timestamp"] == future_ts)]
        actual = int(row["ticket_count"].iloc[0]) if len(row) > 0 else None
        actual_series.append({
            "timestamp": future_ts.isoformat(),
            "actual": actual,
        })

    lat, lon = ms.hex_center(h3_index)
    sp = ms.spatial

    return {
        "h3_index":       h3_index,
        "lat":            lat,
        "lon":            lon,
        "from_timestamp": ts_floor.isoformat(),
        "hours":          hours,
        "is_junction":    int(sp.get("hex_junction", {}).get(h3_index, 0)),
        "hist_mean":      round(sp["hex_hist_mean"].get(h3_index, 0.0), 3),
        "severity_avg":   round(sp["hex_severity_avg"].get(h3_index, 1.5), 2),
        "predicted":      predicted_series,
        "actual":         actual_series,
    }


@router.get("/hex/{h3_index}/info")
def hex_info(h3_index: str = Path(...)):
    """Return static metadata for a hex — used by map side panel."""
    ms = get_model_service()
    sp = ms.spatial
    lat, lon = ms.hex_center(h3_index)

    # Named junction lookup from df
    clock = get_clock()
    df = clock.df
    junction_rows = df[df["h3_index"] == h3_index]["junction_name"].dropna()
    junction_names = [j for j in junction_rows.unique() if j and j != "No Junction"]

    # Dominant violation types
    vtype_rows = df[df["h3_index"] == h3_index]["violation_type"].dropna()
    dominant_types = vtype_rows.value_counts().head(5).to_dict()

    return {
        "h3_index":       h3_index,
        "lat":            lat,
        "lon":            lon,
        "is_junction":    int(sp.get("hex_junction", {}).get(h3_index, 0)),
        "junction_names": junction_names[:3],
        "hist_mean":      round(sp["hex_hist_mean"].get(h3_index, 0.0), 3),
        "severity_avg":   round(sp["hex_severity_avg"].get(h3_index, 1.5), 2),
        "wrong_pct":      round(sp["hex_wrong_pct"].get(h3_index, 0.0), 3),
        "footpath_pct":   round(sp["hex_footpath_pct"].get(h3_index, 0.0), 3),
        "dominant_violations": dominant_types,
    }
