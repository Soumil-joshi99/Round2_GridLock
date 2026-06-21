import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.metrics import mean_squared_error, mean_absolute_error
import joblib
import json
import warnings
warnings.filterwarnings('ignore')

# ==========================================
# CONFIGURATION
# ==========================================
FILE_PATH = 'PS1_data.csv'
H3_RESOLUTION = 9  # Resolution 9 (~170m) for block-level precision
MODEL_OUT_PATH = 'parking_hotspot_model.pkl'

# --- FIX #3: h3-py v3/v4 compatibility shim -----------------------------
# v3 uses geo_to_h3 / k_ring. v4 renamed these to latlng_to_cell / grid_disk
# and REMOVED the old names (not just deprecated). A fresh `pip install h3`
# installs v4, so this shim makes the script work regardless of which
# version lands in the deployment environment.
try:
    from h3 import latlng_to_cell as _h3_encode, grid_disk as _h3_kring
    H3_V4 = True
except ImportError:
    from h3 import geo_to_h3 as _h3_encode, k_ring as _h3_kring
    H3_V4 = False

def h3_encode(lat, lon, res):
    return _h3_encode(lat, lon, res)

def h3_neighbors(hex_id, k=1):
    return _h3_kring(hex_id, k)
# --------------------------------------------------------------------------

print("STEP 0: Ingest & Clean...")
df = pd.read_csv(FILE_PATH)
initial_len = len(df)

# --- FIX #2: validation_status has 5 values, not 2 -----------------------
# approved / rejected / created1 / processing / duplicate.
# created1 and processing are unverified — counting them as confirmed
# violations pollutes the target. Train only on confirmed records.
df = df[df['validation_status'] == 'approved']
# ---------------------------------------------------------------------------

# Bounding box filter to remove out-of-Bengaluru outliers
df = df[
    (df['latitude'].between(12.80, 13.30)) &
    (df['longitude'].between(77.44, 77.77))
]
print(f"Dropped {initial_len - len(df)} non-approved/outlier records. "
      f"Remaining: {len(df)}")

print("STEP 1: Enrich Raw Rows (Semantic Extraction)...")
df['has_wrong_parking'] = df['violation_type'].str.contains('WRONG PARKING', case=False, na=False).astype(int)
df['has_footpath'] = df['violation_type'].str.contains('FOOTPATH', case=False, na=False).astype(int)
df['has_no_parking'] = df['violation_type'].str.contains('NO PARKING', case=False, na=False).astype(int)

weight_map = {
    'HGV': 3, 'BUS': 3, 'TANKER': 3,
    'LGV': 2, 'TEMPO': 2, 'VAN': 2,
    'CAR': 1.5, 'MAXI-CAB': 1.5,
    'SCOOTER': 1, 'MOPED': 1
}
df['severity_weight'] = df['vehicle_type'].str.upper().map(weight_map).fillna(1.5)
df['is_named_junction'] = (df['junction_name'] != 'No Junction').astype(int)

print("STEP 2: Spatial Binning & Temporal Aggregation...")
df['h3_index'] = df.apply(lambda r: h3_encode(r['latitude'], r['longitude'], H3_RESOLUTION), axis=1)
df['hour_timestamp'] = pd.to_datetime(df['created_datetime']).dt.floor('h')

hex_statics = df.groupby('h3_index')['is_named_junction'].max().reset_index()
actual_counts = df.groupby(['h3_index', 'hour_timestamp']).size().reset_index(name='ticket_count')

print("STEP 3: Determine Split Boundaries Up Front...")
# Split dates are computed before the skeleton grid is built, so the hex
# universe (Step 4) can be defined without peeking at the test window.
global_max_time = actual_counts['hour_timestamp'].max()
global_min_time = actual_counts['hour_timestamp'].min()

TEST_DAYS = 15
VAL_DAYS = 10
test_start = global_max_time - pd.Timedelta(days=TEST_DAYS)
val_start = test_start - pd.Timedelta(days=VAL_DAYS)

print(f"  train < {val_start}  |  {val_start} <= val < {test_start}  |  test >= {test_start}")

print("STEP 4: Building the Skeleton Grid...")
# --- FIX #5: hex universe derived from pre-test data only -----------------
# Previously this used hexes from the FULL dataset (train+test combined),
# which lets the model's candidate set quietly use future information.
# A hex is only included if it had at least one approved violation before
# the test window starts.
pre_test_hexes = actual_counts.loc[
    actual_counts['hour_timestamp'] < test_start, 'h3_index'
].unique()
# ---------------------------------------------------------------------------

time_range = pd.date_range(start=global_min_time, end=global_max_time, freq='h')

skeleton = pd.MultiIndex.from_product(
    [pre_test_hexes, time_range], names=['h3_index', 'hour_timestamp']
).to_frame(index=False)
grid = pd.merge(skeleton, actual_counts, on=['h3_index', 'hour_timestamp'], how='left')
grid['ticket_count'] = grid['ticket_count'].fillna(0)

grid = pd.merge(grid, hex_statics, on='h3_index', how='left')
grid['is_named_junction'] = grid['is_named_junction'].fillna(0)

print("STEP 5: Temporal & Trend Features...")
grid['hour'] = grid['hour_timestamp'].dt.hour
grid['day_of_week'] = grid['hour_timestamp'].dt.dayofweek
grid['is_weekend'] = grid['day_of_week'].isin([5, 6]).astype(int)
grid['month'] = grid['hour_timestamp'].dt.month
grid['hours_since_start'] = (grid['hour_timestamp'] - global_min_time).dt.total_seconds() / 3600

print("STEP 6: Time-Joined Lags (Zero-Shift Trap Avoided)...")
lag_24 = grid[['h3_index', 'hour_timestamp', 'ticket_count']].copy()
lag_24['hour_timestamp'] += pd.Timedelta(hours=24)
lag_24.rename(columns={'ticket_count': 'lag_24h'}, inplace=True)

lag_168 = grid[['h3_index', 'hour_timestamp', 'ticket_count']].copy()
lag_168['hour_timestamp'] += pd.Timedelta(hours=168)
lag_168.rename(columns={'ticket_count': 'lag_168h'}, inplace=True)

grid = pd.merge(grid, lag_24, on=['h3_index', 'hour_timestamp'], how='left')
grid = pd.merge(grid, lag_168, on=['h3_index', 'hour_timestamp'], how='left')
grid = grid.dropna(subset=['lag_168h']).reset_index(drop=True)

print("STEP 7: Three-Way Temporal Split (Train / Val / Test)...")
# --- FIX #1: early stopping must never see the test set --------------------
# A held-out validation slice, carved from the TRAIN period, drives early
# stopping. Test stays untouched until Step 10.
train_grid = grid[grid['hour_timestamp'] < val_start].copy()
val_grid = grid[(grid['hour_timestamp'] >= val_start) & (grid['hour_timestamp'] < test_start)].copy()
test_grid = grid[grid['hour_timestamp'] >= test_start].copy()
# ---------------------------------------------------------------------------

train_raw_df = df[df['hour_timestamp'] < val_start]

print(f"  train rows: {len(train_grid)} | val rows: {len(val_grid)} | test rows: {len(test_grid)}")

print("STEP 8: Leak-Proof Historical Target Encodings & Spatial Profiles...")
# All historical encodings are fit on the strict train period only, then
# applied identically to train, val, and test — val is treated exactly
# like test will be, so early-stopping behavior is a fair preview.
hex_hist_mean = train_grid.groupby('h3_index')['ticket_count'].mean().to_dict()
global_train_mean = train_grid['ticket_count'].mean()

hex_wrong_pct = train_raw_df.groupby('h3_index')['has_wrong_parking'].mean().to_dict()
hex_footpath_pct = train_raw_df.groupby('h3_index')['has_footpath'].mean().to_dict()
hex_severity_avg = train_raw_df.groupby('h3_index')['severity_weight'].mean().to_dict()

hex_spillover = {}
for hex_id in pre_test_hexes:
    neighbors = h3_neighbors(hex_id, 1)
    neighbor_means = [hex_hist_mean.get(n, 0) for n in neighbors if n != hex_id]
    hex_spillover[hex_id] = np.mean(neighbor_means) if neighbor_means else 0

for dataset in [train_grid, val_grid, test_grid]:
    dataset['hex_hist_mean'] = dataset['h3_index'].map(hex_hist_mean).fillna(global_train_mean)
    dataset['hex_neighbor_spillover'] = dataset['h3_index'].map(hex_spillover).fillna(0)
    dataset['hex_wrong_pct'] = dataset['h3_index'].map(hex_wrong_pct).fillna(0)
    dataset['hex_footpath_pct'] = dataset['h3_index'].map(hex_footpath_pct).fillna(0)
    dataset['hex_severity_avg'] = dataset['h3_index'].map(hex_severity_avg).fillna(1.0)

print("STEP 9: Model Training (early stopping on VAL, not TEST)...")
FEATURES = [
    'hour', 'day_of_week', 'is_weekend', 'month', 'hours_since_start',
    'lag_24h', 'lag_168h',
    'is_named_junction', 'hex_hist_mean', 'hex_neighbor_spillover',
    'hex_wrong_pct', 'hex_footpath_pct', 'hex_severity_avg'
]
TARGET = 'ticket_count'

X_train, y_train = train_grid[FEATURES], train_grid[TARGET]
X_val, y_val = val_grid[FEATURES], val_grid[TARGET]
X_test, y_test = test_grid[FEATURES], test_grid[TARGET]

# --- FIX #4: count-appropriate objective ----------------------------------
# Plain L2 'regression' biases toward the mean on sparse, zero-inflated
# count data. 'poisson' (or 'tweedie' if the data is overdispersed —
# worth A/B-ing both) models counts properly.
model = lgb.LGBMRegressor(
    objective='poisson',
    n_estimators=1000,
    learning_rate=0.05,
    num_leaves=64,
    min_child_samples=50,
    random_state=42
)
# ---------------------------------------------------------------------------

model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)]
)

print("\nSTEP 10: Dual-Metric Evaluation on Held-Out TEST...")
preds = np.clip(model.predict(X_test), 0, None)

overall_rmse = np.sqrt(mean_squared_error(y_test, preds))
overall_mae = mean_absolute_error(y_test, preds)

non_zero_mask = y_test > 0
active_rmse = np.sqrt(mean_squared_error(y_test[non_zero_mask], preds[non_zero_mask]))
active_mae = mean_absolute_error(y_test[non_zero_mask], preds[non_zero_mask])

print(f"OVERALL METRICS (Including zeros) -> RMSE: {overall_rmse:.4f} | MAE: {overall_mae:.4f}")
print(f"ACTIVE HOTSPOTS (y > 0)          -> RMSE: {active_rmse:.4f} | MAE: {active_mae:.4f}")
print(f"Best iteration (chosen via VAL, not TEST): {model.best_iteration_}")

print("\nSTEP 11: Exporting Artifacts...")
joblib.dump(model, MODEL_OUT_PATH)

feature_payload = {
    'hex_hist_mean': hex_hist_mean,
    'hex_spillover': hex_spillover,
    'hex_wrong_pct': hex_wrong_pct,
    'hex_footpath_pct': hex_footpath_pct,
    'hex_severity_avg': hex_severity_avg,
    'global_train_mean': global_train_mean,
    'features_list': FEATURES,
    'h3_resolution': H3_RESOLUTION,
}
joblib.dump(feature_payload, 'spatial_features_dict.pkl')

# Feature importance export — feeds the /insights/feature-importance
# endpoint in the FastAPI backend directly.
importance = dict(zip(FEATURES, model.feature_importances_.tolist()))
with open('feature_importance.json', 'w') as f:
    json.dump(importance, f, indent=2)

# MODEL_NOTES.md — the corrected metrics, visible to anyone reviewing the
# prototype, plus a record of what changed vs. the original script.
notes = f"""# Model Notes

## Fixes applied vs. original script
1. Early stopping now uses a held-out validation slice carved from the
   train period — the test set is never touched until final scoring.
2. Target now built from `validation_status == 'approved'` only
   (previously included unverified `created1`/`processing` records).
3. h3-py v3/v4 API compatibility shim added.
4. Objective changed from L2 `regression` to `poisson`, appropriate for
   sparse zero-inflated count data.
5. Hex universe for the skeleton grid is derived from pre-test data only.

## Split
- Train: rows before {val_start}
- Validation: {val_start} to {test_start}
- Test: {test_start} onward
- Train rows: {len(train_grid)} | Val rows: {len(val_grid)} | Test rows: {len(test_grid)}

## Test metrics (held out, never used for early stopping)
- Overall  -> RMSE: {overall_rmse:.4f} | MAE: {overall_mae:.4f}
- Active hotspots (y > 0) -> RMSE: {active_rmse:.4f} | MAE: {active_mae:.4f}
- Best iteration (selected via validation set): {model.best_iteration_}
"""
with open('MODEL_NOTES.md', 'w') as f:
    f.write(notes)

print("Pipeline executed. Model, spatial profiles, feature importance, "
      "and MODEL_NOTES.md written.")
