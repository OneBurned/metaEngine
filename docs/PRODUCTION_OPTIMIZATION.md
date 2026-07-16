# Production optimization

P6 adds production optimizers for RSI, MDD Mean Reversion and MDDGrid: the
PostgreSQL/Worker workflow and their screens in the React client. They are
separate from the local Node.js optimizer.

## Current scope

- An optimization starts from a completed **base calculation**. Its immutable
  artifact is the source for every candidate.
- The source is divided into consecutive, non-overlapping samples before
  candidates are evaluated. Every strategy is prepared independently for each
  sample, so indicator state never crosses a sample boundary.
- RSI candidates are grouped by period. For each sample, the RSI series for the
  current period is calculated once and reused for every buy/sell pair before
  the next period replaces it. The cache is bounded to the current period, so
  a wide period range does not retain every indicator row in memory.
- Search is streamed: combinations are generated one at a time and only top-N
  aggregate results are stored. Full rows for every candidate are never written
  to the database or materialized in process; the optimizer evaluates summary
  metrics only.
- MDD supports a **simple** mode (entry count, minimum DD delta, common DD and
  weight ranges, maximum target weight and TP range) and a **detailed** mode
  with separate DD/weight ranges for every entry. Its weights are target total
  positions, must be nondecreasing and may be equal. Maximum total weight caps
  the deepest target weight; it is not a sum of entry weights.
- MDD random search produces the requested candidate count with a deterministic
  seed. Full search streams every valid candidate and deliberately reports an
  unknown total, avoiding a pre-count that could itself exhaust memory.
- MDDGrid prepares source `Accum`, `HWM` and `DD` once per sample. Its first
  optimizer mode uses one selected exit metric for all levels and independently
  searches each level's entry DD, incremental weight and TP. Entries must be
  strictly deeper by the configured minimum delta; weights are nondecreasing
  and their **sum** cannot exceed maximum total weight. For DD exit metrics TP
  is an absolute target DD magnitude; for HWM it is a growth from entry HWM.
  Mixed exit metrics per level remain a manual-run capability for now.
- The Worker records progress and honours a stop request after the candidate
  currently being calculated has completed.
- A result can queue the corresponding normal RSI, MDD or MDDGrid strategy run against
  the same base calculation.
  After that run completes, the existing save workflow creates a reusable saved
  strategy and preserves a link to the selected optimization result.

## Production UI

The **Strategies** page has separate **Manual calculation** and **Optimization**
tabs. The optimization tab lets the user:

1. choose a completed base calculation;
2. choose RSI, MDD Mean Reversion or MDDGrid and define its search ranges;
3. choose sequential sample count, top result count and optional filters for
   maximum MDD, total trades and profitable samples;
4. monitor processed combinations, stop an active job and open recent jobs;
5. sort results, inspect every sample's return/MDD/trades and queue one result
   as a normal strategy calculation.

After that strategy run is complete, the existing save control creates the
reusable saved strategy.

## API

All endpoints are workspace-scoped. `Admin` and `Researcher` can create or stop
jobs; `Viewer` can read jobs and results. Every `POST` uses the normal CSRF
header.

```text
POST /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/optimizations
GET  /api/v1/workspaces/{workspaceId}/optimization-jobs
GET  /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}
POST /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}/stop
POST /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}/retry
POST /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}/results/{resultId}/strategy-runs
```

Queue request example:

```json
{
  "strategyType": "rsi",
  "searchSpace": {
    "rsiPeriod": { "from": 5, "to": 30, "step": 1 },
    "buyLevel": { "from": 20, "to": 45, "step": 5 },
    "sellLevel": { "from": 55, "to": 80, "step": 5 }
  },
  "sampleCount": 3,
  "seed": 42,
  "topCount": 100,
  "maximumDrawdownMagnitude": 0.2,
  "minimumTradeCount": 2,
  "minimumProfitableSampleCount": 2
}
```

Ranges are inclusive. `0.2` for maximum drawdown magnitude means 20%. Omit a
filter to leave it disabled. `topCount` is limited to 1,000 stored rows; the
candidate search itself is streamed. RSI reports its finite cartesian-product
count. MDD and MDDGrid random search report the requested count, while their
full searches report an unknown total.

## Metrics and lifecycle

Each top-N row contains per-sample final return, MDD, trades and Recovery score;
compounded return `(1 + sample 1) * ... * (1 + sample N) - 1`; average and
worst sample return; worst MDD; total trades; and profitable sample count.

Overall Recovery score is compounded return divided by absolute worst MDD. For
zero MDD, a tiny nonzero denominator keeps the score finite and sortable.
Filters apply before a candidate can enter top-N.

The job becomes `completed` after all candidates, or `stopped` after a requested
stop has completed the in-progress candidate. Top-N stays readable in either
terminal state. Applying a row only queues a strategy run; saving remains a
deliberate final action after its canonical result is calculated.

## Worker

`MetaEngine.Worker` checks calculation runs first and optimizer jobs second. A
Worker process must be running for queued RSI, MDD or MDDGrid optimization to progress.
Each claim carries a database lease. A transient database failure or an expired
lease is automatically requeued with exponential delay until the retry budget
is exhausted, then becomes `interrupted` and can be retried manually. An
expired job in `stopping` becomes `stopped`, so a stop request never revives it.
See `docs/QUEUE_RELIABILITY.md` for the shared queue rules and safe operation
of several Worker processes.
