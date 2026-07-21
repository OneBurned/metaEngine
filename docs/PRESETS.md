# Production presets

P5b makes presets a production workflow. A preset is an immutable, versioned
recipe that combines exact imported portfolio versions and saved strategy
results. The UI can create a preset and queue it for calculation.

## What a preset stores

Each saved item has:

- one exact source: a `PortfolioVersion` or a `SavedStrategyVersion` result;
- a decimal weight: `0.25` means 25%, `1.5` means 150%; total weight is not
  capped and may therefore use leverage;
- an inclusive start timestamp;
- an exclusive end timestamp, or `null` for “until the end”.

Weights must be finite and non-negative. The same source can appear more than
once for rebalancing, but its periods must not overlap. Touching
periods are valid: an item ending at `12:00` and the next one starting at
`12:00` do not overlap. Different sources may be active at the same time.

Creating a new preset creates version 1 with a new `presetKey`. Supplying an
existing `presetKey` creates its next immutable version. The older version is
never changed.

A strategy item references the exact saved strategy version and its immutable
`StrategyResult` artifact. Creating a new strategy run or later strategy
version never changes an existing preset.

## Workspace API

All endpoints require an authenticated user with membership in the workspace.
`Admin` and `Researcher` can create; `Viewer` can read only. A non-member sees
`404`, rather than any data from that workspace. The `POST` endpoint requires
the existing CSRF request header.

```text
POST   /api/v1/workspaces/{workspaceId}/presets
DELETE /api/v1/workspaces/{workspaceId}/presets/{presetId}
GET    /api/v1/workspaces/{workspaceId}/presets
GET    /api/v1/workspaces/{workspaceId}/presets/{presetId}
```

Example create body:

```json
{
  "name": "Core allocation",
  "presetKey": null,
  "items": [
    {
      "sourceType": "portfolio",
      "sourceId": "11111111-1111-1111-1111-111111111111",
      "weight": 0.25,
      "startsAt": "2024-01-01T00:00:00Z",
      "endsAt": "2025-01-01T00:00:00Z"
    },
    {
      "sourceType": "strategy",
      "sourceId": "22222222-2222-2222-2222-222222222222",
      "weight": 1.0,
      "startsAt": "2024-01-01T00:00:00Z",
      "endsAt": null
    }
  ]
}
```

The response returns the new preset ID/key/version and each resolved source
name, type, timeframe and source period. An audit event `preset_created` is
written in the same database transaction.

## Calculation core

`PresetCalculationEngine` receives source rows as canonical
`timestamp,diff`, the item weight/period, the requested calculation period and
the target timeframe. It:

1. chooses the finest fixed source timeframe among items;
2. builds the common grid;
3. considers an item only inside its `[startsAt, endsAt)` period;
4. on the item’s own source timestamps, replaces a missing `diff` with `0` and
   reports it as a warning;
5. sums `sourceDiff * weight` from all active items;
6. runs the common `diff -> accum -> hwm -> dd -> mdd` core and optional
   timeframe conversion.

A coarser source contributes zero between its native timestamps; those
between-step timestamps are not treated as missing data. At most 100 warning
details are returned while the full missing-point count is retained.

If leveraged aggregation produces a return below `-100%` on one timestamp, the
calculation is rejected by the common `return_below_minus_one` guard. This
prevents a non-finite equity curve from entering an artifact.

The Worker loads portfolio points and saved strategy artifacts in separate
queries before calculating a preset. This prevents a long strategy artifact
from multiplying portfolio rows in one database query. The result is persisted
as a canonical `run_artifact`; the production UI can queue and inspect it.

## Shared contract

`test/fixtures/golden/preset_calculation.json` is used by both the Node.js
reference and `MetaEngine.DomainTests`. It covers weighted aggregation, the
exclusive end of a period and a missing source point. Expected results are
checked with the same `1e-12` absolute tolerance as the base calculation.

```bash
npm test
dotnet test tests/MetaEngine.DomainTests/MetaEngine.DomainTests.csproj
```

Preset versions can be deleted from the production UI after confirmation when they are not referenced by calculation runs, optimization jobs or saved strategies.
