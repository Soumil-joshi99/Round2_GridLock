"""
routers/replay.py
POST /replay/control  — play, pause, seek, set speed
GET  /replay/state    — current virtual time + status
"""
from datetime import datetime
from typing import Optional, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from replay_clock import get_clock

router = APIRouter()


class ControlPayload(BaseModel):
    action: Literal["play", "pause", "seek"]
    speed: Optional[int] = None
    timestamp: Optional[str] = None   # ISO-8601 string for seek


@router.post("/replay/control")
def replay_control(payload: ControlPayload):
    clock = get_clock()
    if payload.speed is not None:
        clock.set_speed(payload.speed)

    if payload.action == "play":
        clock.play(speed=payload.speed)
    elif payload.action == "pause":
        clock.pause()
    elif payload.action == "seek":
        if payload.timestamp:
            ts = datetime.fromisoformat(payload.timestamp)
            clock.seek(ts)

    return clock.get_state()


@router.get("/replay/state")
def replay_state():
    return get_clock().get_state()
