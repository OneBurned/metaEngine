# MDD Mean Reversion trading strategy

MDD Mean Reversion is a trading strategy module with type `mdd_mean_reversion`.

## Source

The strategy works on the current base portfolio/preset calculation from block **3. Расчет**.

Input values are shown with the `IN` prefix:

```text
IN Diff
IN Accum
IN DD
```

## Local MDD

The strategy uses the standard base DD and adds `Local MDD` for the current drawdown cycle.

Rules:

- when base DD is `0`, the local cycle is reset and `Local MDD = 0`;
- while base DD is below `0`, `Local MDD` remembers the worst DD inside the current drawdown cycle;
- after a full recovery to DD `0`, the next drawdown starts a new local cycle.

## Grid and weights

Default grid:

```text
-10% → 10%
-20% → 20%
-30% → 30%
-40% → 40%
-50% → 50%
```

Grid weights are target total weights, not incremental buys. Weights can be greater than `100%` and cannot be negative.

If one point gaps through multiple levels, the deepest crossed level wins immediately. The new weight is still executed on the next point.

## TP and Local Accum

After base DD returns to `0` while a position is open, the strategy waits for TP.

TP is defined as base asset movement after recovery. For example:

```text
TP = 1%
weight = 10%
```

means the base asset must grow by `1%` after recovery; the strategy balance gets roughly `0.1%` from that TP leg.

`Local Accum` makes the TP trigger visible in the table:

- it starts at `0%` when DD recovers to `0`;
- while TP is waiting, it shows source equity growth from that TP-start point;
- if TP is `1%`, the `TP` signal appears when `Local Accum >= 1%`;
- if the base series returns to DD below `0` before TP, TP waiting is cancelled and `Local Accum` becomes empty again.

## Signals and execution

User-facing labels:

```text
target_weight:0.1 → Вес 10%
weight:0.1        → Вес 10%
weight:0          → Вес 0%
take_profit_close → TP
waiting           → Ждем TP
hit               → TP
cancelled         → TP отменен
```

Every weight change, including TP close, is executed on the next point.

## Production optimization

Production MDD optimization starts from a completed base calculation and applies
every candidate to every sequential sample. It stores only top results and
summary metrics; candidate rows are not materialized.

The simple mode accepts:

- entry count;
- minimum DD delta between entries;
- one DD range and one target-weight range for all entries;
- maximum target weight and TP range.

Detailed mode exposes a separate DD and target-weight range for every entry.
Both modes enforce strictly deeper DD levels, the selected minimum delta, and
nondecreasing target weights. Equal weights are valid. The maximum total weight
limits the deepest target weight, not the sum of level weights.

Random search produces the requested candidate count from its seed. Full search
streams valid candidates without a precomputed total; the user can stop either
mode and keep the best accumulated results.

## Result table and CSV export columns

MDD uses the common strategy table convention:

- `IN ...` means input data from the base portfolio/preset calculation;
- `OUT ...` means output result of the trading strategy.

Table/export columns:

```text
Дата
IN Diff
IN Accum
IN DD
Local MDD
Local Accum
TP статус
Сигнал
Исполнение
Вес
OUT Diff
OUT Accum
OUT HWM
OUT DD
OUT MDD
```

CSV export for the current strategy result uses the same logical columns with stable technical headers:

```text
timestamp,in_diff,in_accum,in_dd,local_mdd,local_accum,tp_status,signal,execution,weight,out_diff,out_accum,out_hwm,out_dd,out_mdd
```

## Chart layout

MDD follows the common strategy chart layout:

1. base portfolio/preset graph;
2. MDD indicator subgraph with base DD, Local MDD, and grid levels;
3. separate strategy-result graph and table with `OUT Diff`, `OUT Accum`, `OUT HWM`, `OUT DD`, `OUT MDD`.
