# Model Notes

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
- Train: rows before 2024-03-04 03:00:00+00:00
- Validation: 2024-03-04 03:00:00+00:00 to 2024-03-14 03:00:00+00:00
- Test: 2024-03-14 03:00:00+00:00 onward
- Train rows: 5194800 | Val rows: 479520 | Test rows: 721278

## Test metrics (held out, never used for early stopping)
- Overall  -> RMSE: 0.1765 | MAE: 0.0111
- Active hotspots (y > 0) -> RMSE: 4.3513 | MAE: 2.5618
- Best iteration (selected via validation set): 44
