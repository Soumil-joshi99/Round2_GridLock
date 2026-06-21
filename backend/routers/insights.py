"""
routers/insights.py
Mounted at /insights

GET /insights/temporal        — hour × day-of-week density matrix
GET /insights/vehicle-mix     — violation counts by vehicle_type
GET /insights/feature-importance — from feature_importance.json, human-readable labels
"""
import pandas as pd
from fastapi import APIRouter

from replay_clock import get_clock
from model_service import get_model_service

router = APIRouter()


@router.get("/temporal")
def temporal_heatmap():
    df = get_clock().df

    df = df.copy()
    df["hour"]        = df["hour_timestamp"].dt.hour
    df["day_of_week"] = df["hour_timestamp"].dt.dayofweek

    matrix = (
        df.groupby(["day_of_week", "hour"])
        .size()
        .reset_index(name="count")
    )

    # Pivot to nested dict: {dow: {hour: count}}
    result = {}
    for _, row in matrix.iterrows():
        dow = int(row["day_of_week"])
        hr  = int(row["hour"])
        cnt = int(row["count"])
        result.setdefault(dow, {})[hr] = cnt

    # Also return as flat list for chart rendering
    flat = matrix.to_dict(orient="records")

    day_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return {
        "matrix": result,
        "flat":   flat,
        "day_labels": day_labels,
    }


@router.get("/vehicle-mix")
def vehicle_mix():
    df = get_clock().df

    counts = (
        df.groupby("vehicle_type")
        .agg(
            count=("vehicle_type", "count"),
            avg_severity=("severity_weight", "mean"),
        )
        .reset_index()
        .sort_values("count", ascending=False)
    )
    counts["avg_severity"] = counts["avg_severity"].round(2)

    total = int(counts["count"].sum())
    counts["pct"] = (counts["count"] / total * 100).round(1)

    return {
        "total": total,
        "breakdown": counts.to_dict(orient="records"),
    }


@router.get("/feature-importance")
def feature_importance():
    ms = get_model_service()
    return {
        "features": ms.get_feature_importance_labeled(),
        "note": "Importance is gain-based (LightGBM). Higher = more influential in predicting violation count.",
    }
