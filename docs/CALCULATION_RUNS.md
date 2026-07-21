# Production calculation runs

P3 turns the production calculation core into an asynchronous workflow. A user
queues a base calculation; the API returns immediately, and the separate
`MetaEngine.Worker` process performs the calculation and stores its immutable
result in PostgreSQL.

## Supported inputs

The request selects exactly one existing source in the current workspace:

- one exact `PortfolioVersion`;
- one exact `PresetVersion` made from portfolio and/or saved strategy sources.

The selected source, period and timeframe are captured in a `calculation_run`.
Changing a portfolio or creating a newer preset later never changes an already
queued or completed run.

P5a adds **strategy calculations**. A strategy always takes one completed base
run as an immutable input and produces a separate canonical artifact. RSI and
MDD Mean Reversion are available. P6 adds separate RSI and MDD Mean Reversion
optimizer jobs: they use a completed base artifact, evaluate parameter
candidates on sequential samples and store only top-N metrics. Applying an
optimizer row queues a normal strategy run. See
`docs/PRODUCTION_OPTIMIZATION.md`.

The run summary exposes `kind`, the original portfolio/preset source and, for a
strategy run, `strategyType` and `strategySchemaVersion`. The production UI
uses these immutable values to show a readable source/type name such as
`Core allocation · v2 · RSI`; it does not store a mutable nickname on a run.

For a strategy run, the Worker reads only the completed base artifact in a
separate series query. It does not join the base artifact points to the
portfolio or preset points, so a long source series remains practical to
process.

## API

All endpoints require workspace membership. `Admin` and `Researcher` can queue
a run; `Viewer` can read its status and result. A non-member receives `404`.
The `POST` request requires the normal CSRF header.

```text
POST   /api/v1/workspaces/{workspaceId}/calculation-runs
POST   /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/strategies
POST   /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}/retry
POST   /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}/delete?kind=base|strategy
POST   /api/v1/workspaces/{workspaceId}/calculation-runs/delete-many?kind=base|strategy
DELETE /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}?kind=base|strategy
DELETE /api/v1/workspaces/{workspaceId}/calculation-runs?kind=base|strategy
GET    /api/v1/workspaces/{workspaceId}/calculation-runs
GET    /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}
GET    /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}/result
```

Example queue request:

```json
{
  "portfolioId": "11111111-1111-1111-1111-111111111111",
  "presetId": null,
  "periodStart": "2024-01-01T00:00:00Z",
  "periodEnd": "2024-12-31T23:00:00Z",
  "timeframe": "1h"
}
```

For a preset, set `portfolioId` to `null` and provide `presetId`. Supplying
both IDs or neither one is rejected. The queue response is `202 Accepted` and
contains the run ID and initial `queued` status.

The result endpoint returns a paged canonical series of `timestamp,diff`. For strategy runs, each point can also contain a `fields` object with strategy-table values such as signals, executions, active deals, weights and indicator values. `offset` must be non-negative and `limit` is from 1 through 5,000. It returns `409 calculation_not_completed` until the worker has completed the run.

## Worker and statuses

The Worker polls PostgreSQL every second. It atomically claims one `queued`
base or strategy run, marks it `running`, then records one of:

- `completed`: summary, warnings and a `BaseResult` or `StrategyResult` artifact are saved;
- `failed`: a stable error code is recorded, for example an unsupported source
  or a leveraged return below `-100%`.
- `interrupted`: automatic retries were exhausted or the Worker lease expired
  after the configured retry budget.

Each transition is auditable through `calculation_queued`,
`calculation_completed`, `calculation_failed`, retry and lease-recovery events.
Transient PostgreSQL failures are requeued automatically with a short
exponential delay. A user can use the retry endpoint for a `failed` or
`interrupted` run; it starts a fresh attempt and preserves the audit trail.

Queue ownership, retry budget and recovery details are described in
`docs/QUEUE_RELIABILITY.md`.

## Stored result

The artifact stores canonical `timestamp,diff` rows plus a SHA-256 checksum. Strategy artifacts may also store per-point `fields_json` for the strategy table/export layer: signals, executions, active deals, weights and strategy-specific indicators. `accum`, HWM, DD and MDD remain derived from canonical `diff` for base results and summaries.

## Local run

Start the API and Worker in two terminals after applying migrations:

```bash
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
dotnet run --project src/MetaEngine.Worker
```

The Worker must be running for a queued API run to progress beyond `queued`.
Tests call the same processor directly, including the real PostgreSQL
integration scenario.

The production UI uses POST cleanup actions for reliable same-origin form-style requests; DELETE aliases remain available for direct API clients. Inactive calculation runs can be deleted individually or in bulk. Bulk deletion skips queued/running runs and runs referenced by strategy runs, optimization jobs or saved strategy versions.
