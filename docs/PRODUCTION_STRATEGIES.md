# Production strategies

P5a makes RSI and MDD Mean Reversion executable in the production runtime.
Both strategies validate parameters, prepare one immutable source series and
calculate canonical `timestamp,diff` results.

## Workflow

1. Complete a base calculation for a portfolio or preset.
2. Queue RSI or MDD Mean Reversion against that exact completed base run.
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
POST   /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/strategies
DELETE /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}?kind=strategy
DELETE /api/v1/workspaces/{workspaceId}/calculation-runs?kind=strategy
POST   /api/v1/workspaces/{workspaceId}/strategies
DELETE /api/v1/workspaces/{workspaceId}/strategies/{strategyId}
GET    /api/v1/workspaces/{workspaceId}/strategies
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
store independent `deals`; each deal has entry by Local DD исходника, additive
opening weight, `exitType` (`source_dd`, `strategy_dd`, `source_hwm`,
`strategy_hwm`) and `exitValue`. Weights do not have to be nondecreasing and the
sum of open deal weights is not capped.

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

P6 can optimize RSI or MDD Mean Reversion against a completed base calculation.
It stores aggregate top-N results only; the user chooses ranges, samples and
optional filters in the **Optimization** tab, then applies one row to queue the
corresponding normal strategy run. The user saves that completed run through the
workflow above. The saved strategy records the selected optimization result for
reproducibility. Job details and API are in `docs/PRODUCTION_OPTIMIZATION.md`.

## UI

The **Strategies** page selects only completed base runs, exposes manual RSI
and MDD parameters, follows queued/running status, displays the strategy result
with Diff/Accum/HWM/DD/MDD on one percent scale, and saves its configuration.
The result block also restores the trading-model chart from the old local lab:
RSI shows its indicator with buy/sell thresholds, while MDD shows source DD and
Local DD used for deal entries. The strategy result table reuses the calculation
result table pattern: it is hidden by default, opens with **Показать данные**,
starts from 100 rows and then adds rows through **Показать ещё 500** so saved
strategies remain reachable without scrolling through a huge table. The table
shows IN/OUT columns, signals, executions and position/weight fields; MDD rows
persist `source_diff`, `source_accum` and `source_dd` for export/table parity.
Inactive strategy runs can be deleted from the run list after confirmation, and
the list also has **Удалить все** for inactive unsaved runs; queued/running runs
and runs already saved as versioned strategies are protected. Saved strategies
can also be deleted after confirmation when no preset references them.
A current-result CSV export shortcut downloads the visible strategy result
columns, while the dedicated
**Экспорт** tab can export strategy results alongside portfolio versions and
base calculations with any selected column set and a preview table. Its
**Optimization** tab provides the full
production RSI/MDD workflow: queue, progress, stop, sort and apply. The
**Presets** page can use that saved result alongside portfolio sources.
