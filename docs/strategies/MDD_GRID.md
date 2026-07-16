# MDDGrid trading strategy

`MDDGrid` is a production trading strategy module with type `mdd_grid`. It is
separate from `MDD Mean Reversion`: grid weights are incremental purchases,
not target positions.

## Inputs

The source is one completed immutable base calculation. The strategy uses its
canonical `timestamp,diff` series and rebuilds source accum, HWM and DD before
calculating the grid.

Each level contains:

```text
drawdown   Source DD level that opens the lot, for example -0.20.
weight     Incremental strategy weight, for example 0.15 for 15%.
exitMetric Metric used by that lot's TP.
takeProfit Improvement required from the metric at entry, for example 0.05.
```

`maxTotalWeight` limits the **sum** of all configured entry weights. It can be
above `1` when leverage is intentional.

Levels must be ordered from shallower to deeper drawdown. Entry weights must
be nondecreasing; equal weights are allowed.

## Entry and position

- A lot opens when source DD newly crosses its level from above to at-or-below
  that level.
- If one source point gaps through several levels, every crossed lot opens.
- Active position is the sum of the weights of currently open lots.
- A buy signal at point `t` is executed for point `t + 1`. The position on
  point `t + 1` receives that point's source return.

For example, levels `-10% -> 10%` and `-20% -> 15%` create a 25% position if a
single source point falls from 0% DD to -25% DD.

## Independent TP

Every lot records its selected metric at the entry signal. Its TP is hit when
the metric improves by the configured `takeProfit` in percentage points:

```text
source DD at entry -20%, TP 5% -> close when source DD is at least -15%
source HWM at entry 40%, TP 10% -> close when source HWM is at least 50%
```

The four available metrics are:

| UI label | Stored value | Meaning |
| --- | --- | --- |
| DD источника | `source_dd` | DD of the base calculation |
| DD MDDGrid | `strategy_dd` | DD of the MDDGrid result |
| HWM источника | `source_hwm` | HWM of the base calculation |
| HWM MDDGrid | `strategy_hwm` | HWM of the MDDGrid result |

Closing one lot does not close other active lots. A sell signal is also
executed on the next point.

## Re-entry rule

After its TP close is executed, a lot is immediately available again. It does
not wait for source DD to return to 0%. To avoid a buy on every point below the
same level, the lot opens again only after a fresh crossing: source DD must
first recover above the entry level and later fall to or below it again.

## Scope

MDDGrid is available for manual production runs, charts and saving as a
versioned strategy that can be used in presets. Its optimizer is deliberately
not available yet; the first step is validating TP rules on manual runs.
