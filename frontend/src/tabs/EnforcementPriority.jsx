import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

function ScoreBar({ value, max = 100, color = 'var(--accent-amber)' }) {
  return (
    <div style={{
      height: 3,
      background: 'rgba(255,255,255,0.06)',
      borderRadius: 2,
      overflow: 'hidden',
      marginTop: 4,
    }}>
      <div style={{
        height: '100%',
        width: `${(value / max) * 100}%`,
        background: color,
        borderRadius: 2,
        transition: 'width 400ms ease',
      }} />
    </div>
  );
}

function BreakdownRow({ label, value, total }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '3px 0' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontFeatureSettings: '"tnum"' }}>
        {value.toFixed(1)} pts
      </span>
    </div>
  );
}

function PriorityRow({ item, expanded, onToggle }) {
  return (
    <>
      <tr
        className="expand-row"
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        <td className="td-mono">{item.rank}</td>
        <td>
          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>
            {item.display_name}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
            {item.h3_index.slice(0, 15)}…
          </div>
          <ScoreBar value={item.priority_score} />
        </td>
        <td className="td-amber" style={{ fontSize: 16 }}>
          {item.priority_score.toFixed(1)}
        </td>
        <td>
          {item.raw.is_junction === 1 && (
            <span className="badge badge-amber" style={{ fontSize: 9, marginRight: 4 }}>JCT</span>
          )}
          {item.raw.repeat_vehicles_7d > 0 && (
            <span className="badge badge-red" style={{ fontSize: 9 }}>
              {item.raw.repeat_vehicles_7d} RPT
            </span>
          )}
        </td>
        <td style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
          {expanded ? '▲' : '▼'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td />
          <td colSpan={4}>
            <div className="expand-content" style={{ margin: '2px 0 8px 0' }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
                <div>
                  <div className="tile-label" style={{ marginBottom: 3 }}>Predicted</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>
                    {item.raw.predicted_count.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="tile-label" style={{ marginBottom: 3 }}>Severity</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>
                    {item.raw.severity_avg.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="tile-label" style={{ marginBottom: 3 }}>Repeat vehicles</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>
                    {item.raw.repeat_vehicles_7d}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border-hair)', paddingTop: 8 }}>
                <div className="tile-label" style={{ marginBottom: 6 }}>Score Breakdown</div>
                <BreakdownRow label="Forecast weight (40%)"   value={item.breakdown.forecast_weight} />
                <BreakdownRow label="Severity weight (25%)"   value={item.breakdown.severity_weight} />
                <BreakdownRow label="Junction flag (20%)"     value={item.breakdown.junction_weight} />
                <BreakdownRow label="Repeat density (15%)"    value={item.breakdown.repeat_density} />
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {/* Formula from backend */}
                formula · 0.40×forecast + 0.25×severity + 0.20×junction + 0.15×repeat
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function EnforcementPriority({ replay }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [topN, setTopN] = useState(20);
  const [expandedRank, setExpandedRank] = useState(null);
  const replayTimeRef = React.useRef(replay.virtual_time);
  
  // Keep ref synced with latest props without triggering re-renders
  useEffect(() => {
    replayTimeRef.current = replay.virtual_time;
  }, [replay.virtual_time]);

  useEffect(() => {
    const fetchPriority = () => {
      if (!replayTimeRef.current) return;
      // Note: we don't setLoading(true) on background polls to avoid screen flash
      api.getEnforcementPriority(replayTimeRef.current, topN)
        .then(res => {
          setData(res);
          setLoading(false);
        })
        .catch(console.error);
    };

    fetchPriority(); // Initial load
    const interval = setInterval(fetchPriority, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, [topN]);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Header tile */}
      <div className="tile">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tile-label">Dispatch-Ready Priority Queue</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Ranked by composite urgency · {data?.timestamp ? new Date(data.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="section-eyebrow" style={{ margin: 0 }}>Show top</span>
            <select
              id="enforcement-topn"
              className="dropdown"
              style={{ width: 80 }}
              value={topN}
              onChange={e => setTopN(Number(e.target.value))}
            >
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="tile" style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div className="loading-hex"><div className="hex-spinner" /><span>Computing priorities…</span></div>
        ) : data?.results?.length > 0 ? (
          <table className="data-table" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Zone / Junction</th>
                <th style={{ width: 80 }}>Score</th>
                <th style={{ width: 100 }}>Flags</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map(item => (
                <PriorityRow
                  key={item.h3_index}
                  item={item}
                  expanded={expandedRank === item.rank}
                  onToggle={() => setExpandedRank(expandedRank === item.rank ? null : item.rank)}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No data available for this time window</div>
        )}
      </div>
    </div>
  );
}
