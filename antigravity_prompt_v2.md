# Build Brief: Parking Violation Hotspot Intelligence Prototype

Paste everything below into Antigravity as the project brief. Sections marked **\[YOU FILL IN\]** need a real file path or detail from your machine before you paste.

---

## 1\. What this is

A working prototype for a Bengaluru hackathon problem statement: detect illegal parking hotspots and quantify their traffic-congestion impact to enable targeted enforcement. This is not a generic CRUD dashboard — it's an **ops-room tool for traffic police**, built on a trained LightGBM model that forecasts parking violation counts on a real H3 hexagonal grid.

You are building three things, end to end:

1. A FastAPI backend that serves predictions, a "simulated live" replay engine, and aggregate analytics — all computed from real historical data.
2. A React frontend with five tabs (spec below).
3. The glue: a replay clock that steps through real timestamps from the dataset and makes the whole UI feel like it's watching a live feed.

Do not fabricate sample data anywhere. Every number on screen must trace back to `PS1_data.csv` or the trained model's actual output.

---

## 2\. Data & model artifacts

- **Dataset**: `PS1_data.csv` — **\[YOU FILL IN: attach/upload this file\]** \~298K Bengaluru parking violation records, Nov 2023–Apr 2024\. Columns: `id, latitude, longitude, location, vehicle_number, vehicle_type, description, violation_type, offence_code, created_datetime, closed_datetime, modified_datetime, device_id, created_by_id, center_code, police_station, data_sent_to_scita, junction_name, action_taken_timestamp, data_sent_to_scita_timestamp, updated_vehicle_number, updated_vehicle_type, validation_status, validation_timestamp`.
- **Model training script**: `train_model.py` — **\[YOU FILL IN: attach the script\]** This is the corrected, production-ready script. Run it as-is; do not re-derive or alter any of the fixes below. It produces:
  - `parking_hotspot_model.pkl` — LightGBM regressor predicting violation count per H3 hex per hour
  - `spatial_features_dict.pkl` — hex-level historical stats: `hex_hist_mean`, `hex_spillover`, `hex_wrong_pct`, `hex_footpath_pct`, `hex_severity_avg`, `global_train_mean`, `features_list`
  - `feature_importance.json` — model feature importances keyed by feature name, ready for the `/insights/feature-importance` endpoint
  - `MODEL_NOTES.md` — corrected metrics, split details, and a record of every fix applied

**All fixes have already been applied to the provided script. Do not modify it. For reference, here is what changed versus the original:**

1. **Early stopping** now uses a held-out validation slice carved from the train period. The test set is never touched until final scoring.
2. **`validation_status` filter** now keeps only `approved` records. `created1` and `processing` are unverified and excluded from the target.
3. **h3-py v3/v4 API compatibility shim** is included. The script works whether `h3-py` v3 or v4 is installed.
4. **Loss function** changed from default L2 `regression` to `objective='poisson'`, appropriate for sparse, zero-inflated count data.
5. **Hex universe** for the skeleton grid is derived from pre-test data only, preventing future-hex leakage.

**Expected output after running `train_model.py` (from `MODEL_NOTES.md`):**

| Split | Period | Rows |
|-------|--------|------|
| Train | Before 2024-03-04 03:00 UTC | 5,194,800 |
| Validation | 2024-03-04 to 2024-03-14 UTC | 479,520 |
| Test | 2024-03-14 onward | 721,278 |

| Metric scope | RMSE | MAE |
|---|---|---|
| Overall (including zeros) | 0.1765 | 0.0111 |
| Active hotspots only (y > 0) | 4.3513 | 2.5618 |

Best iteration selected via validation set: **44**

If your run produces materially different numbers, something changed in the preprocessing environment. Do not proceed to wiring up the backend until metrics are within rounding distance of the above.

---

## 3\. Backend: FastAPI

### Replay engine (core architectural piece)

Build a `ReplayClock` service that:

- Holds the full cleaned dataset in memory (or a lightweight local DB — SQLite is fine for a prototype).
- Exposes a virtual "current time" that advances when the user hits play, at a configurable speed multiplier (1x / 10x / 60x / instant-jump).
- At any virtual timestamp `t`, computes real `lag_24h` and `lag_168h` features for any hex by aggregating actual historical rows in `[t - 24h, t)` and `[t - 168h, t)` — not from the static pickled dict. This is what makes the demo legitimate: the lag features are recomputed live against real data as the clock moves, exactly like a production system would, just replaying history instead of the present.
- `hex_hist_mean`, `hex_spillover`, `hex_wrong_pct`, etc. can come from the static `spatial_features_dict.pkl` (these are slow-moving historical priors; recomputing them live is not necessary for the demo).

### Endpoints

| Endpoint | Purpose |
| :---- | :---- |
| `POST /replay/control` | `{action: "play"\|"pause"\|"seek", speed, timestamp}` |
| `GET /replay/state` | current virtual time, play/pause status |
| `GET /hotspots?at=<timestamp>` | all hexes with predicted count, lat/lon center, severity, for map heatmap rendering |
| `GET /hex/{h3_index}/forecast?at=<timestamp>` | predicted count for next N hours for one hex, plus the actual historical curve for that hex (for backtest overlay) |
| `GET /enforcement-priority?at=<timestamp>` | ranked list combining forecast count, severity\_weight, junction flag, repeat-offender density per hex — return top N with a computed `priority_score` and the formula breakdown |
| `GET /repeat-offenders?min_count=2&sort=count` | ranked vehicle list with violation count, primary violation type, most recent location/time |
| `GET /vehicle/{vehicle_number}` | full violation history for one vehicle |
| `GET /insights/temporal` | hour × day-of-week violation density matrix |
| `GET /insights/vehicle-mix` | violation counts by vehicle\_type |
| `GET /insights/feature-importance` | read directly from `feature_importance.json` produced by the training script — labeled, not raw feature names |

All endpoints must read from real data/model output. No endpoint should return hardcoded or randomly generated numbers.

---

## 4\. Frontend: five tabs

### Global layout structure

The shell is a full-viewport flex layout with two regions:

1. **Left navigation rail** — 64px wide, `#15181C` background, `1px solid rgba(255,255,255,0.08)` right border. Contains: a hexagonal logo mark at the top (use a CSS `clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)` amber fill), followed by five nav icon buttons also using that same hexagonal clip-path shape. The active tab button fills `#E8A23D` (amber); inactive buttons are transparent with `#565B61` icon color. Each button's SVG icon corresponds to its tab (map pin, trend line, target/crosshair, ID card, bar chart).

2. **Main area** — flex column: top bar → scrollable content area → persistent replay control bar.

### Persistent replay control bar

This bar sits pinned to the bottom of every tab. It never disappears on tab switch. It contains (left to right): a circular play/pause button (`30px`, bordered), speed multiplier chips labeled `1x`, `10x`, `60x` (the active chip highlights in amber with `rgba(232,162,61,0.14)` background), a horizontal scrubber track with an amber-teal fill and a circular thumb, and a monospace timestamp showing the current virtual time.

### Tab 1 — Hotspot Map (default landing tab)

Map-first layout. The actual map occupies the full left two-thirds of the content area (not the HTML hex mockup — a real interactive map using **Deck.gl H3HexagonLayer** or **Pydeck**, with the base tile layer set to **CartoDB Dark Matter** — no labels, low contrast dark background). Hexagons are colored by predicted violation intensity using the six-stop ramp: `#1C2025 → #3A3023 → #6B4F22 → #A66E1F → #E8A23D → #F2622E`. The legend beneath the map is labeled **"Enforcement Urgency Index"**, not "Ticket Count" or "Violation Count". This label is non-negotiable — it correctly describes what the model is rendering (a risk weight), not a raw enforcement count.

The right one-third is a KPI stack with three tiles:
- **Active hotspots** — large monospace count, amber delta vs. last hour
- **Predicted next hour** — large monospace count, teal label "poisson model · res 9"
- **Repeat vehicles flagged** — large monospace count, tertiary label "2+ violations, 7d window"

Clicking a hex opens a side panel (slides in over the KPI stack) with: current prediction, junction flag, dominant violation types, severity breakdown, and a link to the Forecast tab pre-loaded for that hex.

The top bar for this tab shows: title "Hotspot map", subtitle "Bengaluru · {N} active cells · resolution 9", and a live/replay pill on the right: teal border, teal dot, monospace text "REPLAY · {date}".

### Tab 2 — Forecast

Select a hex from a map click-through or a searchable dropdown of named junctions. Show a line chart with two series: predicted count (next N hours) and actual historical curve for the same hex and period. The prediction vs. reality overlay is the credibility moment — do not skip it.

### Tab 3 — Enforcement Priority

Ranked, dispatch-ready table. Each row shows: rank (monospace, tertiary), junction name or hex address, `priority_score` (amber monospace), and an expandable breakdown of what's driving the score (forecast weight, severity weight, junction weight, repeat-offender density). This tab answers the actual problem statement: where do we send the patrol right now.

### Tab 4 — Repeat Offenders

Ranked vehicle table: violation count, primary violation type, vehicle\_type, last seen timestamp. Row click opens a detail panel with the vehicle's full violation timeline and a small map of its violation locations.

### Tab 5 — Patterns & Insights

Three panels:
(a) Hour × day-of-week density heatmap — when do violations spike.
(b) Vehicle-type mix — what is actually driving congestion weight.
(c) Feature importance — pulled from `feature_importance.json`, displayed with readable plain-language labels (not raw feature names like `hex_hist_mean` — translate those).

---

## 5\. Visual direction — implement this exactly

**This is an operations tool, not a SaaS admin dashboard.** Do not use Bootstrap, MUI, or any default component library that produces rounded-everything blue-gradient cards. Do not deviate from the token system below without a written justification in a comment.

### Design tokens — use these exact values

```css
:root {
  /* Backgrounds */
  --bg-canvas:        #0D0F12;
  --bg-surface:       #15181C;
  --bg-surface-2:     #1B2025;

  /* Borders */
  --border-hair:        rgba(255, 255, 255, 0.08);
  --border-hair-strong: rgba(255, 255, 255, 0.16);

  /* Text */
  --text-primary:   #E8E9EA;
  --text-secondary: #8B9096;
  --text-tertiary:  #6C727A;   /* NOT #565B61 — that fails 3:1 contrast on dark surfaces */

  /* Accents — two colours only */
  --accent-amber:     #E8A23D;   /* "needs attention / active hotspot" */
  --accent-amber-dim: rgba(232, 162, 61, 0.14);
  --accent-teal:      #3FA88C;   /* "live / currently active" */

  /* Typography */
  --font-sans: "Geist Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "Consolas", "SF Mono", "IBM Plex Mono", monospace;
}
```

### Typography rules

- All data readouts (counts, timestamps, coordinates, scores, percentages) use `var(--font-mono)`.
- All labels, eyebrows, body copy, and tab names use `var(--font-sans)`.
- Eyebrow labels: `font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600;`
- KPI values: `font-family: var(--font-mono); font-size: 28px; font-weight: 600; line-height: 1; font-feature-settings: "tnum";` — the `tnum` setting is mandatory so numeric digits are tabular-width and do not cause layout shift when values update during replay.
- Monospace timestamps and scores in tables: `font-size: 11px–12px; color: var(--text-tertiary);`

### Layout and component rules

- **Tiles**: `background: var(--bg-surface); border: 1px solid var(--border-hair); border-radius: 10px; padding: 18px 20px;`
- **Tile headers**: flex row, space-between, label in `var(--text-primary)` 13px semibold, metadata in `var(--font-mono)` 11px `var(--text-tertiary)`.
- **List rows**: flex row, `padding: 8px 0; border-bottom: 1px solid var(--border-hair);` Last child: no border. Rank in monospace tertiary, name in primary, score in amber monospace.
- **Nav rail buttons**: 40×36px, `clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)` — active fills `var(--accent-amber)` with icon color `#1A1206`; inactive has transparent background and `var(--text-tertiary)` icon.
- **Speed chips**: `font-family: var(--font-mono); font-size: 11px; padding: 4px 9px; border-radius: 5px;` Active: amber border `rgba(232,162,61,0.4)`, amber text, amber-dim background.
- **Live/replay pill**: `color: var(--accent-teal); border: 1px solid rgba(63,168,140,0.3); background: rgba(63,168,140,0.08); border-radius: 20px; font-family: var(--font-mono); font-size: 12px;` with a 6px teal dot.

### The two signature elements — do not skip these

1. **Hexagon motif**: The left-rail logo, the nav buttons, and any loading/spinner states use the hexagonal clip-path. This reflects the literal H3 grid the system reasons about — it is not decoration.
2. **Visible replay progression**: The timestamp in the replay bar must visibly tick forward when play is active. KPI values should have a brief CSS transition (150ms) so number updates are perceptible, not silent. The scrubber fill and thumb must move in real time.

### What this should not look like

If the result looks like any of the following, the visual direction has not been followed: a blue-themed analytics dashboard, a card grid with drop shadows and gradients, a data table with zebra striping in white/light-grey, a sidebar with nav links that look like normal text links. The test: show it to someone and ask "does this look like a traffic ops command center or a BI tool?" The answer must be the former.

---

## 6\. Build order

1. Run `train_model.py` as provided. Verify that RMSE/MAE match the values in Section 2 before proceeding. Write `MODEL_NOTES.md` is auto-generated by the script — do not author it manually.
2. Build the `ReplayClock` service and the `/replay/*` + `/hotspots` endpoints. Verify lag features are computed live from the dataset, not from stale pickles.
3. Build remaining endpoints (Section 3 table).
4. Scaffold the frontend shell: left nav rail (with hex clip-path buttons), top bar, persistent replay control bar at the bottom. Wire the replay bar to `/replay/state` first — this is the spine everything else hangs off. Apply all CSS tokens from Section 5 before writing any component.
5. Build tabs in this order: Hotspot Map → Enforcement Priority → Forecast → Repeat Offenders → Patterns & Insights.
6. Pass: check every number on screen against the source CSV/model output for at least one hex and one vehicle, end to end. Verify the "Enforcement Urgency Index" legend label appears on the map. Verify `font-feature-settings: "tnum"` is applied to all KPI values.
