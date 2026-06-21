import { useState } from 'react';
import NavRail from './components/NavRail.jsx';
import ReplayBar from './components/ReplayBar.jsx';
import { useReplay } from './hooks/useReplay.js';

import HotspotMap from './tabs/HotspotMap.jsx';
import Forecast from './tabs/Forecast.jsx';
import EnforcementPriority from './tabs/EnforcementPriority.jsx';
import RepeatOffenders from './tabs/RepeatOffenders.jsx';
import Insights from './tabs/Insights.jsx';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
  });
}

const TAB_CONFIG = {
  map:         { title: 'Hotspot Map',         showReplayPill: true },
  forecast:    { title: 'Forecast',             showReplayPill: false },
  enforcement: { title: 'Enforcement Priority', showReplayPill: true },
  offenders:   { title: 'Repeat Offenders',     showReplayPill: false },
  insights:    { title: 'Patterns & Insights',  showReplayPill: false },
};

export default function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [hotspotStats, setHotspotStats] = useState({ active: 0, totalHexes: 0 });
  const [forecastHex, setForecastHex] = useState(null);
  const replay = useReplay();

  const cfg = TAB_CONFIG[activeTab];

  function handleHexSelect(hexId) {
    setForecastHex(hexId);
    setActiveTab('forecast');
  }

  return (
    <div className="shell">
      <NavRail activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="main-area">
        {/* Top Bar */}
        <header className="top-bar">
          <div className="top-bar-left">
            <div className="top-bar-title">{cfg.title}</div>
            {activeTab === 'map' && (
              <div className="top-bar-sub">
                Bengaluru · {hotspotStats.active} active cells · resolution 9
              </div>
            )}
          </div>

          {cfg.showReplayPill && replay.virtual_time && (
            <div className="live-pill" id="replay-pill">
              <span className="live-dot" />
              REPLAY · {formatDate(replay.virtual_time)}
            </div>
          )}
        </header>

        {/* Content */}
        <div className="content-area">
          {activeTab === 'map' && (
            <HotspotMap
              replay={replay}
              onHotspotStats={setHotspotStats}
              onHexSelect={handleHexSelect}
            />
          )}
          {activeTab === 'forecast' && (
            <Forecast replay={replay} initialHex={forecastHex} />
          )}
          {activeTab === 'enforcement' && (
            <EnforcementPriority replay={replay} />
          )}
          {activeTab === 'offenders' && (
            <RepeatOffenders />
          )}
          {activeTab === 'insights' && (
            <Insights />
          )}
        </div>

        {/* Persistent replay bar */}
        <ReplayBar replay={replay} />
      </div>
    </div>
  );
}
