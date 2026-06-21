import { useState, useEffect } from 'react';
import { api } from '../api.js';

function formatTs(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function VehicleDetail({ vehicleNumber, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getVehicle(vehicleNumber)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vehicleNumber]);

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div className="side-panel" onClick={e => e.stopPropagation()}>
        <div className="side-panel-header">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>VEHICLE DETAIL</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
              {vehicleNumber}
            </div>
          </div>
          <button className="side-panel-close" onClick={onClose}>×</button>
        </div>

        <div className="side-panel-body">
          {loading ? (
            <div className="loading-hex"><div className="hex-spinner" /><span>Loading…</span></div>
          ) : detail ? (
            <>
              {/* Summary */}
              <div className="tile">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    ['Total violations', detail.summary.total_violations],
                    ['Vehicle type', detail.summary.vehicle_type],
                    ['First seen', formatTs(detail.summary.first_seen)],
                    ['Last seen', formatTs(detail.summary.last_seen)],
                    ['Distinct zones', detail.summary.distinct_hexes],
                    ['Severity avg', detail.summary.severity_avg],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="tile-label" style={{ marginBottom: 2 }}>{l}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', fontFeatureSettings: '"tnum"' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Primary violation */}
              <div>
                <div className="section-eyebrow">Primary Offence</div>
                <div style={{ marginTop: 6 }}>
                  <span className="badge badge-red">{detail.summary.primary_violation}</span>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <div className="section-eyebrow">Violation Timeline</div>
                <div className="tile-scroll" style={{ maxHeight: 320, marginTop: 8 }}>
                  {detail.violations.slice(0, 40).map((v, i) => (
                    <div key={i} className="list-row" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '7px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>{v.violation_type}</span>
                        <span className="list-sub">{formatTs(v.hour_timestamp)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {v.location || v.junction_name || v.h3_index?.slice(0, 14)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">Vehicle not found</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RepeatOffenders() {
  const [offenders, setOffenders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [minCount, setMinCount] = useState(2);
  const [sort, setSort] = useState('count');
  const [skip, setSkip] = useState(0);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const limit = 50;

  // Reset list when filters change
  useEffect(() => {
    setOffenders([]);
    setSkip(0);
  }, [minCount, sort]);

  useEffect(() => {
    setLoading(true);
    api.getRepeatOffenders(minCount, sort, skip, limit)
      .then(res => {
        setTotal(res.total);
        if (skip === 0) {
          setOffenders(res.offenders || []);
        } else {
          setOffenders(prev => [...prev, ...(res.offenders || [])]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [minCount, sort, skip]);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', position: 'relative' }}>
      {/* Controls */}
      <div className="tile">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 6 }}>Min violations</div>
            <select id="offender-min-count" className="dropdown" style={{ width: 100 }} value={minCount} onChange={e => setMinCount(Number(e.target.value))}>
              {[2, 3, 5, 10].map(n => <option key={n} value={n}>{n}+</option>)}
            </select>
          </div>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 6 }}>Sort by</div>
            <select id="offender-sort" className="dropdown" style={{ width: 130 }} value={sort} onChange={e => setSort(e.target.value)}>
              <option value="count">Most violations</option>
              <option value="recent">Most recent</option>
            </select>
          </div>
          {total > 0 && (
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
              {total} offenders
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="tile" style={{ flex: 1, overflow: 'auto' }}>
        {loading && offenders.length === 0 ? (
          <div className="loading-hex"><div className="hex-spinner" /><span>Loading offenders…</span></div>
        ) : (
          <>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Vehicle No.</th>
                <th>Type</th>
                <th>Count</th>
                <th>Primary Offence</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {offenders.map((o, i) => (
                <tr
                  key={`${o.vehicle_number}-${i}`}
                  onClick={() => setSelectedVehicle(o.vehicle_number)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="td-mono td-secondary">{i + 1}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent-amber)', fontFeatureSettings: '"tnum"' }}>
                    {o.vehicle_number}
                  </td>
                  <td className="td-secondary">{o.vehicle_type}</td>
                  <td className="td-amber">{o.violation_count}</td>
                  <td className="td-secondary" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.primary_violation}
                  </td>
                  <td className="td-mono td-secondary">{formatTs(o.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {offenders.length < total && (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <button 
                className="button" 
                onClick={() => setSkip(prev => prev + limit)}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
        )}
      </div>

      {/* Vehicle detail side panel */}
      {selectedVehicle && (
        <VehicleDetail
          vehicleNumber={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
        />
      )}
    </div>
  );
}
