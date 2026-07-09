# RSI trading strategy

RSI is a trading strategy module with type `rsi`.

## Source

RSI is calculated from the equity curve of the current base calculation:

```text
equity = 1 + accum
```

The strategy must be run after block **3. Расчет** has a current portfolio or preset result.

## Signals and execution

Default parameters:

- RSI period: `14`;
- upper level: `70`;
- lower level: `30`;
- baseline: `50`;
- buy level: `30`;
- sell level: `70`.

Rules:

- buy signal: RSI crosses `buyLevel` downward;
- sell signal: RSI crosses `sellLevel` upward;
- repeated buy/sell signals are ignored if the position is already in that state;
- every signal is executed on the next point, not the signal point.

## Result table and CSV export columns

RSI uses the common strategy table convention:

- `IN ...` means input data from the base portfolio/preset calculation;
- `OUT ...` means output result of the trading strategy.

Table/export columns:

```text
Дата
RSI
Сигнал
Исполнение
Вес
IN Diff
IN Accum
OUT Diff
OUT Accum
OUT HWM
OUT DD
OUT MDD
```

CSV export for the current strategy result uses the same logical columns with stable technical headers:

```text
timestamp,rsi,signal,execution,weight,in_diff,in_accum,out_diff,out_accum,out_hwm,out_dd,out_mdd
```

## Chart layout

RSI follows the common strategy chart layout:

1. base portfolio/preset graph;
2. RSI indicator subgraph with upper/baseline/lower level lines;
3. separate strategy-result graph and table with `OUT Diff`, `OUT Accum`, `OUT HWM`, `OUT DD`, `OUT MDD`.
