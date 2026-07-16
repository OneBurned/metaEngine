# Production optimization

P6 adds the production RSI optimizer: the PostgreSQL/Worker workflow and its
screen in the React client. It is separate from the local Node.js optimizer.

## Current scope

- RSI is the only strategy whose production optimizer is available.
- An optimization starts from a completed **base calculation**. Its immutable
  artifact is the source for every candidate.
- The source is divided into consecutive, non-overlapping samples before
  candidates are evaluated. RSI is prepared independently for each sample, so
  indicator state never crosses a sample boundary.
- Search is streamed: combinations are generated one at a time and only top-N
  aggregate results are stored. Full rows for every candidate are never written
  to the database.
- The Worker records progress and honours a stop request after the candidate
  currently being calculated has completed.
- A result can queue a normal RSI strategy run against the same base calculation.
  After that run completes, the existing save workflow creates a reusable saved
  strategy and preserves a link to the selected optimization result.

## Production UI

The **Strategies** page has separate **Manual calculation** and **Optimization**
tabs. The optimization tab lets the user:

1. choose a completed base calculation;
2. define inclusive ranges for RSI period, buy level and sell level;
3. choose sequential sample count, top result count and optional filters for
   maximum MDD, total trades and profitable samples;
4. monitor processed combinations, stop an active job and open recent jobs;
5. sort results, inspect every sample's return/MDD/trades and queue one result
   as a normal RSI strategy calculation.

After that strategy run is complete, the existing save control creates the
reusable saved strategy. MDD Mean Reversion is visibly marked as the next
production optimization stage until its candidate generator and constraints are
added to this shared workflow.

## API

All endpoints are workspace-scoped. `Admin` and `Researcher` can create or stop
jobs; `Viewer` can read jobs and results. Every `POST` uses the normal CSRF
header.

```text
POST /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/optimizations
GET  /api/v1/workspaces/{workspaceId}/optimization-jobs
GET  /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}
POST /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}/stop
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
candidate search itself is streamed and has no product cap.

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
Worker process must be running for queued optimization to progress. Automatic
retry and restart recovery remain future reliability work.
