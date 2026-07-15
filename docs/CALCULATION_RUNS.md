# Production calculation runs

P3 turns the production calculation core into an asynchronous workflow. A user
queues a base calculation; the API returns immediately, and the separate
`MetaEngine.Worker` process performs the calculation and stores its immutable
result in PostgreSQL.

## Supported inputs

The request selects exactly one existing source in the current workspace:

- one exact `PortfolioVersion`;
- one exact `PresetVersion` made from portfolio sources.

The selected source, period and timeframe are captured in a `calculation_run`.
Changing a portfolio or creating a newer preset later never changes an already
queued or completed run.

P5a adds **strategy calculations**. A strategy always takes one completed base
run as an immutable input and produces a separate canonical artifact. RSI and
MDD Mean Reversion are available; optimizer jobs, cancel/retry and saved
strategy sources inside presets are later stages.

## API

All endpoints require workspace membership. `Admin` and `Researcher` can queue
a run; `Viewer` can read its status and result. A non-member receives `404`.
The `POST` request requires the normal CSRF header.

```text
POST /api/v1/workspaces/{workspaceId}/calculation-runs
POST /api/v1/workspaces/{workspaceId}/calculation-runs/{baseRunId}/strategies
GET  /api/v1/workspaces/{workspaceId}/calculation-runs
GET  /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}
GET  /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}/result
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

The result endpoint returns a paged canonical series of `timestamp,diff`.
`offset` must be non-negative and `limit` is from 1 through 5,000. It returns
`409 calculation_not_completed` until the worker has completed the run.

## Worker and statuses

The Worker polls PostgreSQL every second. It atomically claims one `queued`
base or strategy run, marks it `running`, then records one of:

- `completed`: summary, warnings and a `BaseResult` or `StrategyResult` artifact are saved;
- `failed`: a stable error code is recorded, for example an unsupported source
  or a leveraged return below `-100%`.

Each transition is auditable through `calculation_queued`,
`calculation_completed` or `calculation_failed` events. There is no retry or
automatic recovery of a process that was interrupted while running in P3.

## Stored result

The artifact stores only canonical `timestamp,diff` rows plus a SHA-256
checksum. `accum`, HWM, DD and MDD are calculated on the worker for the summary
and can always be rebuilt from the canonical result. This keeps results
reproducible without persisting multiple versions of the same derived series.

## Local run

Start the API and Worker in two terminals after applying migrations:

```bash
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
dotnet run --project src/MetaEngine.Worker
```

The Worker must be running for a queued API run to progress beyond `queued`.
Tests call the same processor directly, including the real PostgreSQL
integration scenario.
