/**
 * api.js — all API calls to the FastAPI backend
 * Vite proxy forwards /api/* → http://localhost:8000/*
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  // Replay
  getReplayState: () => get('/replay/state'),
  replayControl: (payload) => post('/replay/control', payload),

  // Hotspots
  getHotspots: (at) => get(`/hotspots${at ? `?at=${encodeURIComponent(at)}` : ''}`),

  // Forecast
  getHexForecast: (hexId, at, hours = 24) =>
    get(`/hex/${hexId}/forecast?hours=${hours}${at ? `&at=${encodeURIComponent(at)}` : ''}`),
  getHexInfo: (hexId) => get(`/hex/${hexId}/info`),

  // Enforcement
  getEnforcementPriority: (at, topN = 20) =>
    get(`/enforcement-priority?top_n=${topN}${at ? `&at=${encodeURIComponent(at)}` : ''}`),

  // Offenders
  getRepeatOffenders: (minCount = 2, sort = 'count', skip = 0, limit = 50) =>
    get(`/repeat-offenders?min_count=${minCount}&sort=${sort}&skip=${skip}&limit=${limit}`),
  getRepeatOffendersCount: (minCount = 2) => get(`/repeat-offenders/count?min_count=${minCount}`),
  getVehicle: (vehicleNumber) => get(`/vehicle/${encodeURIComponent(vehicleNumber)}`),

  // Insights
  getTemporalHeatmap: () => get('/insights/temporal'),
  getVehicleMix: () => get('/insights/vehicle-mix'),
  getFeatureImportance: () => get('/insights/feature-importance'),
};
