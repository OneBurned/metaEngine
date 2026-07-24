# Production strategies

P5a makes RSI, MDD Mean Reversion and Z-Score executable in the production runtime.
Strategies validate parameters, prepare one immutable source series and
calculate canonical `timestamp,diff` results.

## Workflow

1. Complete a base calculation for a portfolio or preset.
2. Queue RSI, MDD Mean Reversion or Z-Score against that exact completed base run.
3. The Worker stores a `StrategyResult` artifact and summary metrics.
4. Optionally save the completed run as a versioned strategy configuration.

A strategy run stores `source_calculation_run_id`; it never re-reads a newer
portfolio or a later base run. Its result artifact contains canonical
`timestamp,diff` plus per-point strategy fields used by the result table and CSV export; UI metrics and charts are rebuilt from the canonical series.

The Worker loads the source artifact separately from portfolio/preset metadata.
This keeps a long strategy source from creating a cross-product database query
with the original portfolio rows.

## API

All endpoints are workspace-scoped. `Admin` and `Researcher` can create data;
`Viewer` can read it.

```text
POST /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/strategies
POST /api/v1/workspaces/{workspaceId}/strategies
GET  /api/v1/workspaces/{workspaceId}/strategies
```

Queue body example:

```json
{
  "strategyType": "rsi",
  "parameters": {
    "rsiPeriod": 14,
    "buyLevel": 30,
    "sellLevel": 70
  }
}
```

MDD parameters use decimal values: `entryDrawdown: -0.1` is -10%, `weight: 0.1`
is 10%, and `exitValue: 0` means the configured exit threshold. MDD configs now
store independent `deals`; each deal has entry by Local MDD исходника, additive
opening weight, `exitType` (`source_dd`, `strategy_dd`, `source_hwm`,
`strategy_hwm`) and `exitValue`. Weights do not have to be nondecreasing and the
sum of open deal weights is not capped.

Z-Score parameters also use decimal weights and independent `deals`, but each deal enters by `entryZScore` instead of Local MDD. `rollingWindow` defaults to `240`; Z exits use `source_z` or `strategy_z`, while HWM exits keep `source_hwm` and `strategy_hwm`.

Save body example:

```json
{
  "name": "RSI research 14/30/70",
  "strategyRunId": "11111111-1111-1111-1111-111111111111",
  "strategyKey": null
}
```

`strategyKey: null` creates version 1. A known key creates the next immutable
version. The same calculated result cannot be saved twice.

A saved strategy can be selected as a source while creating a preset. The
preset reads its exact saved `StrategyResult`; it does not rerun the strategy.

## Optimizer handoff

P6 can optimize RSI or MDD Mean Reversion against a completed base calculation. Z-Score is manual-only for now.
It stores aggregate top-N results only; the user chooses ranges, samples and
optional filters in the **Optimization** tab, then applies one row to queue the
corresponding normal strategy run. The user saves that completed run through the
workflow above. The saved strategy records the selected optimization result for
reproducibility. Job details and API are in `docs/PRODUCTION_OPTIMIZATION.md`.

## UI

The **Strategies** page selects only completed base runs, exposes manual RSI, MDD
and Z-Score parameters, follows queued/running status, displays the strategy result
with Diff/Accum/HWM/DD/MDD on one percent scale, and saves its configuration.
The result block also restores the trading-model chart from the old local lab:
RSI shows its indicator with buy/sell thresholds, MDD shows source DD and
Local MDD used for deal entries, and Z-Score shows IN/OUT Z values with deal entry levels. The strategy result table shows IN/OUT columns,
signals, executions and position/weight fields. Stored MDD/Z-Score signal/execution
values use ASCII English tokens such as `IN #1` and `OPEN #1` so CSV
preview/download stays spreadsheet-safe even when the UI labels are localized.
A current-result CSV export shortcut downloads the visible strategy result
columns, while the dedicated **Экспорт** tab can export strategy results
alongside portfolio versions and base calculations with any selected column set
and a preview table. Its **Optimization** tab provides the full
production RSI/MDD workflow: queue, progress, stop, sort and apply. Z-Score is hidden from optimization until a dedicated search space is designed. The
**Presets** page can use that saved result alongside portfolio sources.
