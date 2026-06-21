"""
routers/offenders.py
GET /repeat-offenders?min_count=2&sort=count&limit=50
GET /repeat-offenders/count?min_count=2  ← lightweight KPI endpoint
GET /vehicle/{vehicle_number}
"""
from typing import Optional, Literal

import pandas as pd
from fastapi import APIRouter, Path, Query

from replay_clock import get_clock

router = APIRouter()


@router.get("/repeat-offenders")
def repeat_offenders(
    min_count: int = Query(2, ge=1),
    sort: Literal["count", "recent"] = Query("count"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=10000),  # raised from 500 — KPI uses limit=1000
):
    df = get_clock().df

    grp = df.groupby("vehicle_number").agg(
        violation_count=("vehicle_number", "count"),
        last_seen=("hour_timestamp", "max"),
        primary_violation=("violation_type", lambda s: s.mode().iloc[0] if len(s) > 0 else ""),
        vehicle_type=("vehicle_type", lambda s: s.mode().iloc[0] if len(s) > 0 else ""),
        last_lat=("latitude", "last"),
        last_lon=("longitude", "last"),
        last_location=("location", "last"),
    ).reset_index()

    grp = grp[grp["violation_count"] >= min_count]

    if sort == "count":
        grp = grp.sort_values("violation_count", ascending=False)
    else:
        grp = grp.sort_values("last_seen", ascending=False)

    # total = count of ALL qualifying offenders (before slicing for display)
    total_all = int(len(grp))

    grp = grp.iloc[skip:skip+limit]
    grp["last_seen"] = grp["last_seen"].astype(str)

    return {
        "total": total_all,          # full qualifying count — used by KPI tile
        "shown": len(grp),           # how many rows are in this response
        "offenders": grp.to_dict(orient="records"),
    }

@router.get("/repeat-offenders/count")
def repeat_offenders_count(min_count: int = Query(2, ge=1)):
    """
    Lightweight endpoint — returns just the integer count of vehicles
    with >= min_count violations. Used by the KPI tile on the map tab.
    No list serialisation overhead.
    """
    df = get_clock().df
    vehicle_counts = df.groupby("vehicle_number").size()
    count = int((vehicle_counts >= min_count).sum())
    return {"count": count, "min_count": min_count}


@router.get("/vehicle/{vehicle_number}")
def vehicle_detail(vehicle_number: str = Path(...)):
    df = get_clock().df
    vn = vehicle_number.upper().strip()

    rows = df[df["vehicle_number"] == vn].copy()
    if rows.empty:
        return {"vehicle_number": vn, "violations": [], "summary": {}}

    # Build violation timeline
    cols = [
        "hour_timestamp", "latitude", "longitude", "location",
        "violation_type", "vehicle_type", "junction_name",
        "severity_weight", "has_wrong_parking", "has_footpath",
        "h3_index",
    ]
    available = [c for c in cols if c in rows.columns]
    timeline = rows[available].copy()
    timeline["hour_timestamp"] = timeline["hour_timestamp"].astype(str)
    timeline = timeline.sort_values("hour_timestamp", ascending=False)

    summary = {
        "vehicle_number":   vn,
        "total_violations": len(rows),
        "vehicle_type":     rows["vehicle_type"].mode().iloc[0] if len(rows) > 0 else "",
        "primary_violation": rows["violation_type"].mode().iloc[0] if len(rows) > 0 else "",
        "first_seen":       str(rows["hour_timestamp"].min()),
        "last_seen":        str(rows["hour_timestamp"].max()),
        "distinct_hexes":   rows["h3_index"].nunique(),
        "severity_avg":     round(float(rows["severity_weight"].mean()), 2),
    }

    return {
        "vehicle_number": vn,
        "summary": summary,
        "violations": timeline.to_dict(orient="records"),
    }
