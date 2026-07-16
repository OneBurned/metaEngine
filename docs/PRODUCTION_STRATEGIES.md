# Production strategies

RSI, MDD Mean Reversion and MDDGrid are executable in the production runtime.
Every strategy validates parameters, prepares one immutable source series and
calculates canonical `timestamp,diff` results.

## Workflow

1. Complete a base calculation for a portfolio or preset.
2. Queue RSI, MDD Mean Reversion or MDDGrid against that exact completed base
   run.
3. The Worker stores a `StrategyResult` artifact and summary metrics.
4. Optionally save the completed run as a versioned strategy configuration.

A strategy run stores `source_calculation_run_id`; it never re-reads a newer
portfolio or a later base run. Its result artifact contains only canonical
`timestamp,diff`; UI metrics and charts are rebuilt from that series.

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

MDD parameters use decimal values: `drawdown: -0.1` is -10%, `weight: 0.1`
is 10%, and `takeProfit: 0.01` is 1%. Target weights must be nondecreasing;
equal weights are allowed.

MDDGrid parameters use the same decimal scale. Each `levels` item has its own
incremental `weight`, `exitMetric` and `takeProfit`; `maxTotalWeight` caps the
sum of configured entry weights. Available exit metrics are `source_dd`,
`strategy_dd`, `source_hwm` and `strategy_hwm`. See
`docs/strategies/MDD_GRID.md` for the TP and re-entry rules.

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

P6 can optimize RSI, MDD Mean Reversion or MDDGrid against a completed base calculation.
It stores aggregate top-N results only; the user chooses ranges, samples and
optional filters in the **Optimization** tab, then applies one row to queue the
corresponding normal strategy run. The user saves that completed run through the
workflow above. The saved strategy records the selected optimization result for
reproducibility. Job details and API are in `docs/PRODUCTION_OPTIMIZATION.md`.

## UI

The **Strategies** page selects only completed base runs, exposes manual RSI,
MDD and MDDGrid parameters, follows queued/running status, displays the saved
strategy result and saves its configuration. Its **Optimization** tab provides
the full production RSI/MDD/MDDGrid workflow: queue, progress, stop, sort and
apply. For MDDGrid, a DD exit target is absolute (`5%` means DD `-5%`); an HWM
target is growth from the HWM recorded at entry. The **Presets** page can use any saved strategy result alongside
portfolio sources.
