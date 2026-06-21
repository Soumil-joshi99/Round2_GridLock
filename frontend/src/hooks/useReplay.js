import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const SPEEDS = [1, 10, 60, 3600];

export function useReplay() {
  const [state, setState] = useState({
    virtual_time: null,
    is_playing: false,
    speed: 1,
    min_time: null,
    max_time: null,
  });

  // Poll replay state every 500ms
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const s = await api.getReplayState();
        if (active) setState(s);
      } catch (_) {}
    };
    tick();
    const id = setInterval(tick, 500);
    return () => { active = false; clearInterval(id); };
  }, []);

  const play = useCallback(async (speed) => {
    await api.replayControl({ action: 'play', speed: speed ?? state.speed });
  }, [state.speed]);

  const pause = useCallback(async () => {
    await api.replayControl({ action: 'pause' });
  }, []);

  const seek = useCallback(async (pct) => {
    if (!state.min_time || !state.max_time) return;
    const min = new Date(state.min_time).getTime();
    const max = new Date(state.max_time).getTime();
    const ts = new Date(min + pct * (max - min));
    await api.replayControl({ action: 'seek', timestamp: ts.toISOString() });
  }, [state.min_time, state.max_time]);

  const setSpeed = useCallback(async (speed) => {
    await api.replayControl({ action: 'play', speed });
  }, []);

  const progress = (() => {
    if (!state.min_time || !state.max_time || !state.virtual_time) return 0;
    const min = new Date(state.min_time).getTime();
    const max = new Date(state.max_time).getTime();
    const cur = new Date(state.virtual_time).getTime();
    return Math.max(0, Math.min(1, (cur - min) / (max - min)));
  })();

  return { ...state, play, pause, seek, setSpeed, progress, SPEEDS };
}
