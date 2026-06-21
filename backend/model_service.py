"""
model_service.py
----------------
Loads parking_hotspot_model.pkl and spatial_features_dict.pkl once at startup.
Provides predict() and build_feature_vector() helpers used by all hotspot endpoints.
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Optional

# ---------------------------------------------------------------------------
# h3-py v3/v4 shim (same as train_model.py)
# ---------------------------------------------------------------------------
try:
    from h3 import latlng_to_cell as _h3_encode, cell_to_latlng as _h3_center
    H3_V4 = True
except ImportError:
    from h3 import geo_to_h3 as _h3_encode, h3_to_geo as _h3_center
    H3_V4 = False


def h3_center(hex_id: str) -> tuple:
    """Return (lat, lon) center of an H3 cell."""
    return _h3_center(hex_id)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------
_INSTANCE: Optional["ModelService"] = None


def get_model_service() -> "ModelService":
    global _INSTANCE
    if _INSTANCE is None:
        raise RuntimeError("ModelService not initialized.")
    return _INSTANCE


class ModelService:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    def __init__(self):
        model_path   = os.path.join(self.BASE_DIR, "parking_hotspot_model.pkl")
        spatial_path = os.path.join(self.BASE_DIR, "spatial_features_dict.pkl")
        fi_path      = os.path.join(self.BASE_DIR, "feature_importance.json")

        self.model   = joblib.load(model_path)
        self.spatial = joblib.load(spatial_path)

        with open(fi_path) as f:
            self.feature_importance_raw = json.load(f)

        self.features_list = self.spatial["features_list"]
        self.global_train_mean = self.spatial["global_train_mean"]
        self.h3_resolution = self.spatial.get("h3_resolution", 9)

        # All known hexes from the spatial dict
        self.hex_ids = list(self.spatial["hex_hist_mean"].keys())

        # Build a cached lat/lon lookup for hex centres
        self._hex_centers: dict = {}

        global _INSTANCE
        _INSTANCE = self

    def hex_center(self, hex_id: str) -> tuple:
        if hex_id not in self._hex_centers:
            self._hex_centers[hex_id] = h3_center(hex_id)
        return self._hex_centers[hex_id]

    def build_feature_vector(
        self,
        hex_id: str,
        ts: datetime,
        lag_24h: float,
        lag_168h: float,
        global_min_time: datetime,
    ) -> dict:
        """
        Build the full feature dict for one hex at one timestamp.
        Static spatial features come from spatial_features_dict.pkl.
        Lag features are passed in (computed live by ReplayClock).
        """
        spatial = self.spatial
        hour_ts = pd.Timestamp(ts).floor("h")

        hours_since_start = max(
            0.0,
            (hour_ts - pd.Timestamp(global_min_time)).total_seconds() / 3600,
        )

        return {
            "hour":                   float(hour_ts.hour),
            "day_of_week":            float(hour_ts.dayofweek),
            "is_weekend":             float(1 if hour_ts.dayofweek >= 5 else 0),
            "month":                  float(hour_ts.month),
            "hours_since_start":      hours_since_start,
            "lag_24h":                lag_24h,
            "lag_168h":               lag_168h,
            "is_named_junction":      float(spatial.get("hex_junction", {}).get(hex_id, 0)),
            "hex_hist_mean":          float(spatial["hex_hist_mean"].get(hex_id, self.global_train_mean)),
            "hex_neighbor_spillover": float(spatial["hex_spillover"].get(hex_id, 0.0)),
            "hex_wrong_pct":          float(spatial["hex_wrong_pct"].get(hex_id, 0.0)),
            "hex_footpath_pct":       float(spatial["hex_footpath_pct"].get(hex_id, 0.0)),
            "hex_severity_avg":       float(spatial["hex_severity_avg"].get(hex_id, 1.0)),
        }

    def predict(self, feature_dict: dict) -> float:
        X = pd.DataFrame([feature_dict])[self.features_list]
        pred = self.model.predict(X)[0]
        return float(max(0.0, pred))

    def predict_batch(self, feature_dicts: list) -> list:
        if not feature_dicts:
            return []
        X = pd.DataFrame(feature_dicts)[self.features_list]
        preds = self.model.predict(X)
        return [float(max(0.0, p)) for p in preds]

    # Human-readable feature importance labels
    LABEL_MAP = {
        "hour":                   "Time of Day (hour)",
        "day_of_week":            "Day of Week",
        "is_weekend":             "Weekend vs Weekday",
        "month":                  "Month",
        "hours_since_start":      "Trend (Hours Elapsed)",
        "lag_24h":                "Same Hour Yesterday",
        "lag_168h":               "Same Hour Last Week",
        "is_named_junction":      "Named Junction Flag",
        "hex_hist_mean":          "Historical Avg (this zone)",
        "hex_neighbor_spillover": "Neighbor Zone Activity",
        "hex_wrong_pct":          "Wrong-Parking Rate",
        "hex_footpath_pct":       "Footpath-Blocking Rate",
        "hex_severity_avg":       "Avg Vehicle Severity",
    }

    def get_feature_importance_labeled(self) -> list:
        total = sum(self.feature_importance_raw.values()) or 1
        out = []
        for raw_name, score in sorted(
            self.feature_importance_raw.items(), key=lambda x: -x[1]
        ):
            out.append({
                "feature":     raw_name,
                "label":       self.LABEL_MAP.get(raw_name, raw_name),
                "importance":  score,
                "pct":         round(score / total * 100, 1),
            })
        return out
