import { useReplay } from '../hooks/useReplay.js';

const SPEED_LABELS = { 1: '1×', 10: '10×', 60: '60×', 3600: '⚡' };

function formatTs(iso) {
  if (!iso) return '---';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

export default function ReplayBar({ replay }) {
  const { is_playing, speed, virtual_time, play, pause, seek, setSpeed, progress, SPEEDS } = replay;

  function handleScrubberClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, pct)));
  }

  return (
    <div className="replay-bar">
      {/* Play / Pause */}
      <button
        id="replay-play-pause"
        className="replay-play-btn"
        onClick={() => is_playing ? pause() : play()}
        title={is_playing ? 'Pause' : 'Play'}
      >
        {is_playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="4" height="16" rx="1" />
            <rect x="15" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v13.72a1 1 0 001.47.88l11-6.86a1 1 0 000-1.76l-11-6.86A1 1 0 008 5.14z" />
          </svg>
        )}
      </button>

      {/* Speed chips */}
      <div className="speed-chips">
        {SPEEDS.map((s) => (
          <button
            key={s}
            id={`speed-chip-${s}`}
            className={`speed-chip${speed === s ? ' active' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {SPEED_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Scrubber */}
      <div
        id="replay-scrubber"
        className="replay-scrubber-wrap"
        onClick={handleScrubberClick}
      >
        <div className="replay-scrubber-fill" style={{ width: `${progress * 100}%` }} />
        <div className="replay-scrubber-thumb" style={{ left: `${progress * 100}%` }} />
      </div>

      {/* Timestamp */}
      <div className="replay-timestamp" id="replay-timestamp">
        {formatTs(virtual_time)}
      </div>
    </div>
  );
}
