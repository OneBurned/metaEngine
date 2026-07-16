# MDDGrid trading strategy

`MDDGrid` is a production trading strategy module with type `mdd_grid`. It is
separate from `MDD Mean Reversion`: grid weights are incremental purchases,
not target positions.

## Inputs

The source is one completed immutable base calculation. The strategy uses its
canonical `timestamp,diff` series. Before a manual run or an optimizer starts,
it builds the source accum, HWM and DD series once; every lot and every
candidate then reuses those prepared source metrics.

Each level contains:

```text
drawdown   Source DD level that opens the lot, for example -0.20.
weight     Incremental strategy weight, for example 0.15 for 15%.
exitMetric Metric used by that lot's TP.
takeProfit Target used by the selected exit metric, for example 0.05.
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

Every lot is independent. The meaning of its `takeProfit` depends on the
selected exit metric:

```text
source DD entry -5%, target DD 0% -> close when source DD reaches 0%
source DD entry -10%, target DD 5% -> close when source DD reaches -5%
source HWM at entry 40%, TP 10% -> close when source HWM reaches 50%
```

For `source_dd` and `strategy_dd`, `takeProfit` is an **absolute target DD
magnitude**: `0.05` means target DD `-5%`, and a lot closes when the current DD
is at or above that target. A DD target cannot be deeper than the source DD
entry level. For `source_hwm` and `strategy_hwm`, the lot records HWM at entry
and closes when HWM grows by `takeProfit` from that value.

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

## Optimizer

MDDGrid is available for production optimization from a completed base
calculation. The source can be split into sequential samples. Source metrics
are prepared once per sample, while each candidate only calculates its own lot
state and strategy metrics.

The first optimizer version searches a common exit metric for all levels and
independently selects each level's DD entry, incremental weight and TP target.
It enforces strictly deeper entries, the configured minimum DD delta,
nondecreasing weights and a cap on the **sum** of all weights. Random search is
seeded and bounded by the requested candidate count; full search is streamed
and intentionally has no precounted total. Mixing different exit metrics across
levels remains available in a manual MDDGrid run and is a future optimizer
extension.

As with RSI and MDD Mean Reversion, a top result can be queued as a normal
strategy run, inspected, and then saved as a versioned strategy for presets.
