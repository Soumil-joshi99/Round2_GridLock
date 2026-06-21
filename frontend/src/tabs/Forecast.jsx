import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function formatHour(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:00`;
}

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-surface-2)',
      border: '1px solid var(--border-hair-strong)',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-tertiary)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
          {p.name}: {p.value != null ? p.value.toFixed(3) : 'N/A'}
        </div>
      ))}
    </div>
  );
};

export default function Forecast({ replay, initialHex }) {
  const [hexId, setHexId] = useState(initialHex || '');
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [hexList, setHexList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch hex list for dropdown (top 50 active from a snapshot hotspot call)
  useEffect(() => {
    api.getHotspots().then(d => {
      const sorted = (d.hotspots || [])
        .sort((a, b) => b.predicted - a.predicted)
        .slice(0, 100);
      setHexList(sorted);
      if (!hexId && sorted.length > 0) setHexId(sorted[0].h3_index);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialHex) setHexId(initialHex);
  }, [initialHex]);

  const fetchForecast = async () => {
    if (!hexId) return;
    setLoading(true);
    try {
      const d = await api.getHexForecast(hexId, replay.virtual_time, hours);
      // Merge predicted + actual into one series for the chart
      const merged = d.predicted.map((p, i) => ({
        time: formatHour(p.timestamp),
        predicted: p.predicted,
        actual: d.actual[i]?.actual ?? null,
      }));
      setData({ ...d, merged });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchForecast(); }, [hexId, hours]);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Controls */}
      <div className="tile">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="section-eyebrow" style={{ marginBottom: 6 }}>Select Zone / Junction</div>
            <select
              id="forecast-hex-select"
              className="dropdown"
              value={hexId}
              onChange={e => setHexId(e.target.value)}
            >
              {hexList.map(h => (
                <option key={h.h3_index} value={h.h3_index}>
                  {h.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 6 }}>Horizon</div>
            <select
              id="forecast-hours-select"
              className="dropdown"
              style={{ width: 120 }}
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
            >
              {[6, 12, 24, 48, 72].map(h => (
                <option key={h} value={h}>{h}h</option>
              ))}
            </select>
          </div>
          <button
            id="forecast-refresh"
            onClick={fetchForecast}
            style={{
              padding: '8px 16px',
              background: 'var(--accent-amber-dim)',
              border: '1px solid rgba(232,162,61,0.3)',
              borderRadius: 7,
              color: 'var(--accent-amber)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Metadata strip */}
      {data && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            ['Zone', data.h3_index?.slice(0, 14) + '…'],
            ['Hist. mean', data.hist_mean?.toFixed(3)],
            ['Severity avg', data.severity_avg?.toFixed(2)],
            ['Junction', data.is_junction ? 'Yes' : 'No'],
          ].map(([l, v]) => (
            <div key={l} className="tile" style={{ flex: 1, minWidth: 120, padding: '10px 14px' }}>
              <div className="tile-label" style={{ marginBottom: 4 }}>{l}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFeatureSettings: '"tnum"' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="tile" style={{ flex: 1 }}>
        <div className="tile-header">
          <span className="tile-label">Prediction vs Actual Historical Curve</span>
          <span className="tile-meta">res 9 · poisson model</span>
        </div>
        {loading ? (
          <div className="loading-hex"><div className="hex-spinner" /><span>Computing…</span></div>
        ) : data?.merged ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.merged} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#6C727A' }}
                interval={Math.max(1, Math.floor(data.merged.length / 8))}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#6C727A' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8B9096' }}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                stroke="#E8A23D"
                strokeWidth={2}
                dot={false}
                name="Predicted"
                activeDot={{ r: 4, fill: '#E8A23D' }}
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#3FA88C"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                name="Actual (historical)"
                connectNulls={false}
                activeDot={{ r: 4, fill: '#3FA88C' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">Select a zone and click Refresh</div>
        )}
      </div>
    </div>
  );
}
