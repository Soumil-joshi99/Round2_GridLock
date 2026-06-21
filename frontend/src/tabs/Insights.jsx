import { useState, useEffect } from 'react';
import { api } from '../api.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Heat colors for temporal heatmap
function heatColor(value, max) {
  if (!max) return 'rgba(28,32,37,0.6)';
  const t = value / max;
  if (t < 0.2) return `rgba(28,32,37,${0.6 + t})`;
  if (t < 0.4) return `rgba(107,79,34,${0.6 + t * 0.5})`;
  if (t < 0.6) return `rgba(166,110,31,${0.7 + t * 0.3})`;
  if (t < 0.8) return `rgba(232,162,61,${0.7 + t * 0.3})`;
  return `rgba(242,98,46,${0.8 + t * 0.2})`;
}

function TemporalHeatmap({ data }) {
  if (!data) return <div className="loading-hex"><div className="hex-spinner" /><span>Loading…</span></div>;

  const matrix = data.matrix;
  const allVals = data.flat.map(r => r.count);
  const maxVal = Math.max(...allVals, 1);

  return (
    <div>
      {/* Hour axis */}
      <div className="heatmap-hour-labels">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="heatmap-hour-label">{h % 6 === 0 ? h : ''}</div>
        ))}
      </div>

      {/* Rows: Mon–Sun */}
      {DAY_LABELS.map((day, dow) => (
        <div key={dow} className="heatmap-grid" style={{ marginBottom: 2 }}>
          <div className="heatmap-axis">{day}</div>
          {Array.from({ length: 24 }, (_, hr) => {
            const val = matrix[dow]?.[hr] ?? 0;
            return (
              <div
                key={hr}
                className="heatmap-cell"
                style={{ background: heatColor(val, maxVal) }}
                title={`${day} ${hr}:00 — ${val} violations`}
              />
            );
          })}
        </div>
      ))}

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)',
      }}>
        <span style={{ color: 'rgba(28,32,37,0.8)' }}>■</span> Low
        <span style={{ color: 'rgba(232,162,61,0.9)' }}>■</span> Peak
        <span style={{ color: 'rgba(242,98,46,0.95)' }}>■</span> Critical
      </div>
    </div>
  );
}

const VehicleTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-surface-2)',
      border: '1px solid var(--border-hair-strong)',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 11,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{d.vehicle_type}</div>
      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
        {d.count.toLocaleString()} violations
      </div>
      <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
        {d.pct}% of total · sev {d.avg_severity}
      </div>
    </div>
  );
};

function VehicleMixChart({ data }) {
  if (!data) return <div className="loading-hex"><div className="hex-spinner" /><span>Loading…</span></div>;
  const items = data.breakdown.slice(0, 12);
  const maxCount = Math.max(...items.map(d => d.count));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={items} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
        <XAxis
          dataKey="vehicle_type"
          tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: '#6C727A' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: '#6C727A' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<VehicleTooltip />} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {items.map((entry, i) => (
            <Cell
              key={i}
              fill={i === 0 ? '#E8A23D' : i <= 2 ? '#A66E1F' : '#3A3023'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FeatureImportance({ data }) {
  if (!data) return <div className="loading-hex"><div className="hex-spinner" /><span>Loading…</span></div>;
  const maxPct = Math.max(...data.features.map(f => f.pct), 1);

  return (
    <div>
      {data.features.map(f => (
        <div key={f.feature} className="fi-bar-wrap">
          <span className="fi-label">{f.label}</span>
          <div className="fi-bar-bg">
            <div className="fi-bar-fill" style={{ width: `${(f.pct / maxPct) * 100}%` }} />
          </div>
          <span className="fi-pct">{f.pct}%</span>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
        {data.note}
      </div>
    </div>
  );
}

export default function Insights() {
  const [temporal, setTemporal] = useState(null);
  const [vehicleMix, setVehicleMix] = useState(null);
  const [featureImp, setFeatureImp] = useState(null);

  useEffect(() => {
    api.getTemporalHeatmap().then(setTemporal).catch(() => {});
    api.getVehicleMix().then(setVehicleMix).catch(() => {});
    api.getFeatureImportance().then(setFeatureImp).catch(() => {});
  }, []);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* (a) Temporal heatmap */}
      <div className="tile">
        <div className="tile-header">
          <span className="tile-label">Violation Density by Hour × Day</span>
          <span className="tile-meta">Nov 2023 – Apr 2024</span>
        </div>
        <TemporalHeatmap data={temporal} />
      </div>

      {/* (b) Vehicle mix + (c) Feature importance — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        {/* Vehicle mix */}
        <div className="tile">
          <div className="tile-header">
            <span className="tile-label">Vehicle Mix</span>
            <span className="tile-meta">
              {vehicleMix ? vehicleMix.total.toLocaleString() + ' violations' : ''}
            </span>
          </div>
          <VehicleMixChart data={vehicleMix} />
          {vehicleMix && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {vehicleMix.breakdown.slice(0, 5).map(v => (
                <div key={v.vehicle_type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{v.vehicle_type}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                    {v.pct}% · sev {v.avg_severity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feature importance */}
        <div className="tile">
          <div className="tile-header">
            <span className="tile-label">Model Feature Importance</span>
            <span className="tile-meta">LightGBM gain · res 9</span>
          </div>
          <FeatureImportance data={featureImp} />
        </div>
      </div>
    </div>
  );
}
