# Production presets

P2c adds the first production workflow for a preset. A preset is an immutable,
versioned recipe that combines exact imported portfolio versions. Production UI
and a public calculation-run endpoint are still future work; this document
describes the database API and the domain calculation core already available.

## What a preset stores

Each saved item has:

- one exact `PortfolioVersion` ID, not a portfolio name or its latest version;
- a decimal weight: `0.25` means 25%, `1.5` means 150%; total weight is not
  capped and may therefore use leverage;
- an inclusive start timestamp;
- an exclusive end timestamp, or `null` for “until the end”.

Weights must be finite and non-negative. The same portfolio version can appear
more than once for rebalancing, but its periods must not overlap. Touching
periods are valid: an item ending at `12:00` and the next one starting at
`12:00` do not overlap. Different portfolios may be active at the same time.

Creating a new preset creates version 1 with a new `presetKey`. Supplying an
existing `presetKey` creates its next immutable version. The older version is
never changed.

Saved meta-strategies are deliberately not sources in P2c. The database model
already reserves that relation, and it will be enabled after strategy results
are saved as canonical `timestamp,diff` artifacts.

## Workspace API

All endpoints require an authenticated user with membership in the workspace.
`Admin` and `Researcher` can create; `Viewer` can read only. A non-member sees
`404`, rather than any data from that workspace. The `POST` endpoint requires
the existing CSRF request header.

```text
POST /api/v1/workspaces/{workspaceId}/presets
GET  /api/v1/workspaces/{workspaceId}/presets
GET  /api/v1/workspaces/{workspaceId}/presets/{presetId}
```

Example create body:

```json
{
  "name": "Core allocation",
  "presetKey": null,
  "items": [
    {
      "portfolioId": "11111111-1111-1111-1111-111111111111",
      "weight": 0.25,
      "startsAt": "2024-01-01T00:00:00Z",
      "endsAt": "2025-01-01T00:00:00Z"
    },
    {
      "portfolioId": "22222222-2222-2222-2222-222222222222",
      "weight": 1.0,
      "startsAt": "2024-01-01T00:00:00Z",
      "endsAt": null
    }
  ]
}
```

The response returns the new preset ID/key/version and each resolved portfolio
key/version/name/timeframe. An audit event `preset_created` is written in the
same database transaction.

## Calculation core

`PresetCalculationEngine` receives portfolio rows as canonical
`timestamp,diff`, the item weight/period, the requested calculation period and
the target timeframe. It:

1. chooses the finest fixed source timeframe among items;
2. builds the common grid;
3. considers an item only inside its `[startsAt, endsAt)` period;
4. on the item’s own source timestamps, replaces a missing `diff` with `0` and
   reports it as a warning;
5. sums `portfolioDiff * weight` from all active items;
6. runs the common `diff -> accum -> hwm -> dd -> mdd` core and optional
   timeframe conversion.

A coarser portfolio contributes zero between its native timestamps; those
between-step timestamps are not treated as missing data. At most 100 warning
details are returned while the full missing-point count is retained.

If leveraged aggregation produces a return below `-100%` on one timestamp, the
calculation is rejected by the common `return_below_minus_one` guard. This
prevents a non-finite equity curve from entering an artifact.

The calculation core is a library only in P2c. A later job/worker workflow will
load saved preset items and portfolio points, persist the canonical result as a
`run_artifact`, and expose it through API/UI.

## Shared contract

`test/fixtures/golden/preset_calculation.json` is used by both the Node.js
reference and `MetaEngine.DomainTests`. It covers weighted aggregation, the
exclusive end of a period and a missing source point. Expected results are
checked with the same `1e-12` absolute tolerance as the base calculation.

```bash
npm test
dotnet test tests/MetaEngine.DomainTests/MetaEngine.DomainTests.csproj
```
