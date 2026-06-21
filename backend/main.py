"""
main.py
-------
FastAPI application entry point.

Startup sequence:
  1. Load CSV into memory, clean & enrich.
  2. Initialise ModelService (loads pkl artifacts).
  3. Initialise ReplayClock with the cleaned DataFrame.
  4. Start the background tick task.
"""

import os
import asyncio
from contextlib import asynccontextmanager

import pandas as pd
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from model_service import ModelService
from replay_clock import ReplayClock

# ---------------------------------------------------------------------------
# h3-py v3/v4 shim
# ---------------------------------------------------------------------------
try:
    from h3 import latlng_to_cell as _h3_encode
except ImportError:
    from h3 import geo_to_h3 as _h3_encode


def h3_encode(lat, lon, res):
    return _h3_encode(lat, lon, res)


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "PS1_data.csv")

WEIGHT_MAP = {
    "HGV": 3, "BUS": 3, "TANKER": 3,
    "LGV": 2, "TEMPO": 2, "VAN": 2,
    "CAR": 1.5, "MAXI-CAB": 1.5,
    "SCOOTER": 1, "MOPED": 1,
}


def load_and_clean() -> pd.DataFrame:
    print("[startup] Loading CSV …")
    df = pd.read_csv(CSV_PATH, low_memory=False)

    # Keep only approved violations
    df = df[df["validation_status"] == "approved"].copy()

    # Bengaluru bounding box
    df = df[
        df["latitude"].between(12.80, 13.30) &
        df["longitude"].between(77.44, 77.77)
    ]

    # Semantic enrichment
    df["has_wrong_parking"] = df["violation_type"].str.contains(
        "WRONG PARKING", case=False, na=False).astype(int)
    df["has_footpath"] = df["violation_type"].str.contains(
        "FOOTPATH", case=False, na=False).astype(int)
    df["has_no_parking"] = df["violation_type"].str.contains(
        "NO PARKING", case=False, na=False).astype(int)

    df["severity_weight"] = (
        df["vehicle_type"].str.upper().map(WEIGHT_MAP).fillna(1.5)
    )
    df["is_named_junction"] = (
        df["junction_name"].fillna("No Junction") != "No Junction"
    ).astype(int)

    # H3 spatial binning
    print("[startup] H3 encoding …")
    df["h3_index"] = df.apply(
        lambda r: h3_encode(r["latitude"], r["longitude"], 9), axis=1
    )

    # Temporal
    df["hour_timestamp"] = pd.to_datetime(
        df["created_datetime"], utc=True, errors="coerce"
    ).dt.floor("h")
    df = df.dropna(subset=["hour_timestamp"])

    # Repeat-offender convenience column
    df["vehicle_number"] = df["vehicle_number"].fillna("UNKNOWN").str.strip().str.upper()

    print(f"[startup] Cleaned rows: {len(df):,}")
    return df


# ---------------------------------------------------------------------------
# Lifespan (replaces on_event in FastAPI ≥ 0.93)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    df = load_and_clean()

    # Patch spatial_features_dict with junction data derived from df
    model_svc = ModelService()
    hex_junction = (
        df.groupby("h3_index")["is_named_junction"].max().to_dict()
    )
    model_svc.spatial["hex_junction"] = hex_junction

    clock = ReplayClock(df)
    clock.start_background_task()

    print("[startup] Ready — virtual time starts at", clock.virtual_time)
    yield
    # Cleanup on shutdown (nothing needed for prototype)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Parking Ops API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
from routers import replay, hotspots, forecast, enforcement, offenders, insights

app.include_router(replay.router,      prefix="",         tags=["replay"])
app.include_router(hotspots.router,    prefix="",         tags=["hotspots"])
app.include_router(forecast.router,    prefix="",         tags=["forecast"])
app.include_router(enforcement.router, prefix="",         tags=["enforcement"])
app.include_router(offenders.router,   prefix="",         tags=["offenders"])
app.include_router(insights.router,    prefix="/insights", tags=["insights"])


@app.get("/")
def root():
    return {"status": "ok", "service": "Parking Ops API"}
