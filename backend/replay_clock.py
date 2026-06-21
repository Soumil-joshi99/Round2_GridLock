"""
replay_clock.py
---------------
Singleton ReplayClock service.

Virtual time starts at the dataset's first timestamp and advances at
wall-clock rate × speed multiplier when playing.

Lag features are computed LIVE from the in-memory DataFrame by slicing
actual historical rows — not from the static spatial_features_dict.pkl.
"""

import asyncio
from datetime import datetime, timezone
import time
import pandas as pd
import numpy as np
from typing import Optional

_INSTANCE: Optional["ReplayClock"] = None


def get_clock() -> "ReplayClock":
    global _INSTANCE
    if _INSTANCE is None:
        raise RuntimeError("ReplayClock not initialized. Call ReplayClock.create() first.")
    return _INSTANCE


class ReplayClock:
    SPEED_OPTIONS = [1, 10, 60, 3600]  # 3600 = "instant" fast-forward

    def __init__(self, df: pd.DataFrame):
        """
        df must already be filtered to approved, in-bbox records,
        with 'h3_index' and 'hour_timestamp' columns present.
        """
        self._df = df
        # Pre-group by (h3_index, hour_timestamp) for fast lag lookups
        self._hourly = (
            df.groupby(["h3_index", "hour_timestamp"])
            .size()
            .rename("ticket_count")
            .reset_index()
        )
        # Also keep a pure timestamp→count table (all hexes combined) for global lag
        self._global_hourly = (
            df.groupby("hour_timestamp")
            .size()
            .rename("ticket_count")
        )

        self._min_time: datetime = df["hour_timestamp"].min().to_pydatetime()
        self._max_time: datetime = df["hour_timestamp"].max().to_pydatetime()

        self.virtual_time: datetime = self._min_time
        self.is_playing: bool = False
        self.speed: int = 1          # virtual seconds per real second
        self._last_wall: float = time.monotonic()
        self._task: Optional[asyncio.Task] = None

        global _INSTANCE
        _INSTANCE = self

    # ------------------------------------------------------------------
    # Control
    # ------------------------------------------------------------------
    def play(self, speed: Optional[int] = None):
        if speed and speed in self.SPEED_OPTIONS:
            self.speed = speed
        self._last_wall = time.monotonic()
        self.is_playing = True

    def pause(self):
        self._advance()          # commit any pending virtual time
        self.is_playing = False

    def seek(self, ts: datetime):
        self.virtual_time = max(self._min_time, min(self._max_time, ts))
        self._last_wall = time.monotonic()

    def set_speed(self, speed: int):
        if speed in self.SPEED_OPTIONS:
            self._advance()
            self.speed = speed
            self._last_wall = time.monotonic()

    def get_state(self) -> dict:
        self._advance()
        return {
            "virtual_time": self.virtual_time.isoformat(),
            "is_playing": self.is_playing,
            "speed": self.speed,
            "min_time": self._min_time.isoformat(),
            "max_time": self._max_time.isoformat(),
        }

    # ------------------------------------------------------------------
    # Internal tick
    # ------------------------------------------------------------------
    def _advance(self):
        if not self.is_playing:
            return
        now = time.monotonic()
        elapsed_wall = now - self._last_wall
        self._last_wall = now
        delta_virtual = elapsed_wall * self.speed  # seconds of virtual time
        new_vt = self.virtual_time + pd.Timedelta(seconds=delta_virtual)
        if new_vt >= self._max_time:
            new_vt = self._max_time
            self.is_playing = False
        self.virtual_time = new_vt.to_pydatetime() if hasattr(new_vt, "to_pydatetime") else new_vt

    async def _tick_loop(self):
        """Asyncio background task — keeps virtual_time current."""
        while True:
            self._advance()
            await asyncio.sleep(0.1)

    def start_background_task(self):
        loop = asyncio.get_event_loop()
        self._task = loop.create_task(self._tick_loop())

    # ------------------------------------------------------------------
    # Live lag feature computation
    # ------------------------------------------------------------------
    def get_lags(self, h3_index: str, at: datetime) -> dict:
        """
        Compute lag_24h and lag_168h for a given hex AT a given virtual time.
        Sums actual historical ticket_count rows from the loaded DataFrame.
        This is the live-recompute path (not from stale pickles).
        """
        at_ts = pd.Timestamp(at).floor("h")
        w24_start = at_ts - pd.Timedelta(hours=24)
        w168_start = at_ts - pd.Timedelta(hours=168)

        hex_hours = self._hourly[self._hourly["h3_index"] == h3_index]

        mask_24 = (hex_hours["hour_timestamp"] >= w24_start) & (hex_hours["hour_timestamp"] < at_ts)
        mask_168 = (hex_hours["hour_timestamp"] >= w168_start) & (hex_hours["hour_timestamp"] < at_ts)

        lag_24h = float(hex_hours.loc[mask_24, "ticket_count"].sum())
        lag_168h = float(hex_hours.loc[mask_168, "ticket_count"].sum())

        return {"lag_24h": lag_24h, "lag_168h": lag_168h}

    def get_lags_bulk(self, h3_indices: list, at: datetime) -> dict:
        """
        Vectorised lag computation for many hexes at once (used by /hotspots).
        Returns dict: h3_index -> {lag_24h, lag_168h}
        """
        at_ts = pd.Timestamp(at).floor("h")
        w24_start  = at_ts - pd.Timedelta(hours=24)
        w168_start = at_ts - pd.Timedelta(hours=168)

        h = self._hourly

        mask_24  = (h["hour_timestamp"] >= w24_start)  & (h["hour_timestamp"] < at_ts)
        mask_168 = (h["hour_timestamp"] >= w168_start) & (h["hour_timestamp"] < at_ts)

        lag24  = h[mask_24].groupby("h3_index")["ticket_count"].sum().to_dict()
        lag168 = h[mask_168].groupby("h3_index")["ticket_count"].sum().to_dict()

        result = {}
        for idx in h3_indices:
            result[idx] = {
                "lag_24h":  float(lag24.get(idx, 0.0)),
                "lag_168h": float(lag168.get(idx, 0.0)),
            }
        return result

    def get_actual_counts(self, h3_index: str, start: datetime, end: datetime) -> list:
        """Return actual hourly ticket counts for a hex in [start, end)."""
        st = pd.Timestamp(start).floor("h")
        en = pd.Timestamp(end).floor("h")
        hex_hours = self._hourly[self._hourly["h3_index"] == h3_index]
        mask = (hex_hours["hour_timestamp"] >= st) & (hex_hours["hour_timestamp"] < en)
        sub = hex_hours[mask][["hour_timestamp", "ticket_count"]].copy()
        sub["hour_timestamp"] = sub["hour_timestamp"].astype(str)
        return sub.to_dict(orient="records")

    # Properties for other routers
    @property
    def df(self) -> pd.DataFrame:
        return self._df

    @property
    def hourly(self) -> pd.DataFrame:
        return self._hourly

    @property
    def min_time(self) -> datetime:
        return self._min_time

    @property
    def max_time(self) -> datetime:
        return self._max_time
