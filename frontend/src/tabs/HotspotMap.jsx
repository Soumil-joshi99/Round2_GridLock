import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import maplibregl from 'maplibre-gl';
import { Deck, MapView } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';

// 6-stop color ramp: low → critical
const COLOR_STOPS = [
  [0,    [28,  32,  37]],
  [0.2,  [58,  48,  35]],
  [0.4,  [107, 79,  34]],
  [0.6,  [166, 110, 31]],
  [0.8,  [232, 162, 61]],
  [1.0,  [242, 98,  46]],
];

function interpolateColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [t0, c0] = COLOR_STOPS[i - 1];
    const [t1, c1] = COLOR_STOPS[i];
    if (clamped <= t1) {
      const f = (clamped - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + f * (c1[j] - v)));
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

function KPITile({ label, value, delta, sub, id }) {
  return (
    <div className="tile" style={{ marginBottom: 10 }}>
      <div className="tile-header">
        <span className="tile-label">{label}</span>
      </div>
      <div className="kpi-value" id={id}>{value ?? '—'}</div>
      {delta != null && (
        <div className={`kpi-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
          {delta >= 0 ? '+' : ''}{delta} vs last hour
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function HexSidePanel({ hexId, onClose, onForecast, replay }) {
  const [info, setInfo] = useState(null);
  const [pred, setPred] = useState(null);

  useEffect(() => {
    if (!hexId) return;
    api.getHexInfo(hexId).then(setInfo).catch(() => {});
    api.getHexForecast(hexId, replay.virtual_time, 1)
      .then(d => setPred(d.predicted?.[0]?.predicted))
      .catch(() => {});
  }, [hexId, replay.virtual_time]);

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div className="side-panel" onClick={e => e.stopPropagation()}>
        <div className="side-panel-header">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3 }}>HEX DETAIL</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{hexId}</div>
          </div>
          <button className="side-panel-close" onClick={onClose}>×</button>
        </div>
        <div className="side-panel-body">
          {!info ? (
            <div className="loading-hex"><div className="hex-spinner" /><span>Loading…</span></div>
          ) : (
            <>
              <div>
                <div className="section-eyebrow">Location</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {info.junction_names?.length > 0
                    ? info.junction_names.map(n => <span key={n} className="badge badge-amber">{n}</span>)
                    : <span className="badge badge-teal">Non-junction zone</span>
                  }
                </div>
              </div>

              <div className="tile">
                <div className="tile-label" style={{ marginBottom: 8 }}>Current Forecast</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{pred != null ? pred.toFixed(2) : '…'}</div>
                <div className="kpi-sub">violations · next hour</div>
              </div>

              <div>
                <div className="section-eyebrow">Zone Profile</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {[
                    ['Hist. avg / hr', info.hist_mean?.toFixed(3)],
                    ['Severity avg',   info.severity_avg?.toFixed(2)],
                    ['Wrong parking',  `${(info.wrong_pct * 100).toFixed(1)}%`],
                    ['Footpath block', `${(info.footpath_pct * 100).toFixed(1)}%`],
                  ].map(([l, v]) => (
                    <div key={l} className="expand-content-row">
                      <span className="expand-label" style={{ fontSize: 12 }}>{l}</span>
                      <span className="expand-value" style={{ fontSize: 12 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {info.dominant_violations && (
                <div>
                  <div className="section-eyebrow">Top Violation Types</div>
                  <div style={{ marginTop: 8 }}>
                    {Object.entries(info.dominant_violations).slice(0, 4).map(([type, cnt]) => (
                      <div key={type} className="list-row" style={{ padding: '5px 0' }}>
                        <span className="list-name" style={{ fontSize: 11 }}>{type}</span>
                        <span className="list-score" style={{ fontSize: 11 }}>{cnt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => { onForecast(hexId); onClose(); }}
                style={{
                  width: '100%', padding: '9px 0',
                  background: 'var(--accent-amber-dim)',
                  border: '1px solid rgba(232,162,61,0.3)', borderRadius: 7,
                  color: 'var(--accent-amber)', fontFamily: 'var(--font-sans)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Open 24-hour Forecast →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CARTO_DARK = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};
const BENGALURU = { longitude: 77.5946, latitude: 12.9716, zoom: 11.5 };

export default function HotspotMap({ replay, onHotspotStats, onHexSelect }) {
  const containerRef = useRef(null);
  const deckCanvasRef = useRef(null);
  const deckRef = useRef(null);
  const mapRef = useRef(null);

  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHex, setSelectedHex] = useState(null);
  const [repeatCount, setRepeatCount] = useState(0);
  const [predictedNext, setPredictedNext] = useState(null);
  const lastFetch = useRef(null);

  // Init deck + map
  useEffect(() => {
    if (!containerRef.current || !deckCanvasRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK,
      center: [BENGALURU.longitude, BENGALURU.latitude],
      zoom: BENGALURU.zoom,
      pitch: 30,
      bearing: 0,
      antialias: true,
    });

    const deck = new Deck({
      canvas: deckCanvasRef.current,
      initialViewState: BENGALURU,
      controller: true,
      onViewStateChange: ({ viewState }) => {
        map.jumpTo({
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          bearing: viewState.bearing ?? 0,
          pitch: viewState.pitch ?? 30,
        });
      },
      layers: [],
      getCursor: ({ isDragging, isHovering }) =>
        isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    });

    map.on('load', () => setLoading(false));

    deckRef.current = deck;
    mapRef.current = map;

    return () => {
      deck.finalize();
      map.remove();
    };
  }, []);

  // Fetch hotspots
  const fetchHotspots = useCallback(async (ts) => {
    try {
      const data = await api.getHotspots(ts);
      setHotspots(data.hotspots || []);
      onHotspotStats({ active: data.active_hexes, totalHexes: data.total_hexes });
      const total = (data.hotspots || []).reduce((s, h) => s + h.predicted, 0);
      setPredictedNext(Math.round(total));
    } catch (e) {
      console.warn('Hotspot fetch:', e.message);
    }
  }, [onHotspotStats]);

  const replayTimeRef = useRef(replay.virtual_time);
  useEffect(() => {
    replayTimeRef.current = replay.virtual_time;
  }, [replay.virtual_time]);

  useEffect(() => {
    const doFetch = () => {
      if (replayTimeRef.current) fetchHotspots(replayTimeRef.current);
    };
    doFetch();
    const interval = setInterval(doFetch, 10000); // 10s poll
    return () => clearInterval(interval);
  }, [fetchHotspots]);

  useEffect(() => {
    api.getRepeatOffendersCount(2).then(d => setRepeatCount(d.count)).catch(() => {});
  }, []);

  // Update Deck.gl layers
  useEffect(() => {
    if (!deckRef.current) return;
    const maxPred = hotspots.reduce((m, h) => Math.max(m, h.predicted), 0.01);

    deckRef.current.setProps({
      layers: [
        new H3HexagonLayer({
          id: 'hotspots',
          data: hotspots,
          getHexagon: d => d.h3_index,
          getFillColor: d => [...interpolateColor(d.predicted / maxPred), 200],
          getElevation: d => d.predicted * 100,
          extruded: true,
          elevationScale: 1,
          pickable: true,
          wireframe: false,
          onClick: ({ object }) => { if (object) setSelectedHex(object.h3_index); },
          updateTriggers: { getFillColor: maxPred, getElevation: maxPred },
          transitions: { getFillColor: 300, getElevation: 300 },
        }),
      ],
    });
  }, [hotspots]);

  const activeCount = hotspots.filter(h => h.predicted > 0.5).length;

  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
      {/* Map — left 2/3 */}
      <div style={{ flex: '0 0 66.7%', position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <div className="loading-hex" style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'var(--bg-canvas)' }}>
            <div className="hex-spinner" />
            <span>Loading map…</span>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <canvas
          ref={deckCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}
        />

        {/* Enforcement Urgency Index legend — non-negotiable label */}
        <div className="map-legend" id="enforcement-urgency-legend">
          <div className="map-legend-title">Enforcement Urgency Index</div>
          <div className="legend-gradient" />
          <div className="legend-labels">
            <span>Low</span>
            <span>Moderate</span>
            <span>Critical</span>
          </div>
        </div>
      </div>

      {/* KPI stack — right 1/3 */}
      <div style={{
        flex: '0 0 33.3%', padding: '16px 14px',
        display: 'flex', flexDirection: 'column', gap: 0,
        overflowY: 'auto', borderLeft: '1px solid var(--border-hair)',
        background: 'var(--bg-canvas)', position: 'relative',
      }}>
        <KPITile id="kpi-active-hotspots" label="Active Hotspots" value={activeCount} sub="cells with predicted > 0.5" />
        <KPITile id="kpi-predicted-next" label="Predicted Next Hour" value={predictedNext} sub="poisson model · res 9" />
        <KPITile id="kpi-repeat-vehicles" label="Repeat Vehicles Flagged" value={repeatCount} sub="2+ violations, 7d window" />

        <div className="tile" style={{ flex: 1, marginTop: 10 }}>
          <div className="tile-header">
            <span className="tile-label">Top Active Zones</span>
            <span className="tile-meta">by prediction</span>
          </div>
          <div className="tile-scroll">
            {[...hotspots]
              .sort((a, b) => b.predicted - a.predicted)
              .slice(0, 12)
              .map((h, i) => (
                <div key={h.h3_index} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setSelectedHex(h.h3_index)}>
                  <span className="list-rank">#{i + 1}</span>
                  <span className="list-name">{h.h3_index.slice(0, 12)}…</span>
                  <span className="list-score">{h.predicted.toFixed(2)}</span>
                  {h.is_junction === 1 && <span className="badge badge-amber" style={{ fontSize: 9, padding: '2px 5px' }}>JCT</span>}
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Side panel */}
      {selectedHex && (
        <HexSidePanel
          hexId={selectedHex}
          onClose={() => setSelectedHex(null)}
          onForecast={onHexSelect}
          replay={replay}
        />
      )}
    </div>
  );
}
