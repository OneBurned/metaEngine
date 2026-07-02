# Timeframe conversion

MetaEngine separates **calculation timeframe** from **display timeframe**.

- **ТФ для расчета** defines the timeframe where the base result or trading strategy is actually calculated.
- **ТФ для отображения** defines how an already calculated result is aggregated for summary, chart, and table output.

## Supported target timeframes

The standard target timeframes are:

```text
1m, 5m, 15m, 1h, 1d, 1M, 1Y
```

The default calculation timeframe is `1h`, because the current sample/test datasets are mostly hourly.

## Safe conversion rule

The converter only allows conversion to the same or a larger timeframe.

Examples:

- `1h → 1h` is allowed;
- `1h → 1d` is allowed;
- `1h → 1M` is allowed;
- `1h → 15m` is rejected.

MetaEngine does not silently create synthetic smaller-timeframe data. If the user selects a calculation or display timeframe that is smaller than the source data, the action fails or the smaller option is disabled with a clear warning.

For display:

- block **3. Расчет** has `ТФ для расчета`;
- block **4. Исходный результат** has `ТФ для отображения`;
- block **5. Стратегии** has `ТФ для расчета`;
- block **6. Итог торговли по стратегии** has `ТФ для отображения`.

Example:

```text
Block 3 calculation timeframe = 1h
Block 4 display timeframe     = 1d
```

The base result is calculated on hourly rows, while the visible summary/chart/table in block 4 are aggregated to daily checkpoints.

After a new calculation, the display timeframe resets to the freshly calculated timeframe. This prevents an old larger display timeframe from making the user think that a new smaller-timeframe calculation did not change the result.

When the user changes a display timeframe, the UI briefly shows:

```text
Пересчитывается...
```

This is a visual hint that the summary/chart/table are being re-aggregated locally.

## Aggregation model

The converter works through equity/accum checkpoints:

1. Read normalized source `timestamp,diff` data.
2. Build the source calculation grid.
3. Fill missing source `diff` values with `0` according to the project missing-data rule.
4. Calculate source `accum` / equity.
5. Take checkpoints on strict target timeframe boundaries.
6. Calculate target `diff` between neighboring checkpoints:

```text
target_diff = (1 + current_accum) / (1 + previous_accum) - 1
```

7. Recalculate `accum`, `hwm`, `dd`, and `mdd` from the new target `diff` series.

The first target checkpoint in the selected range has `diff = 0`, so the visible target calculation starts from `accum = 0`.

## Strict boundaries

Target timeframe boundaries are strict and stay inside the selected calculation period.

For fixed timeframes:

- `1m` — minute boundary;
- `5m` — 5-minute boundary;
- `15m` — 15-minute boundary;
- `1h` — hour boundary;
- `1d` — `00:00 UTC` day boundary.

For calendar timeframes:

- `1M` — first day of the month at `00:00 UTC`;
- `1Y` — January 1 at `00:00 UTC`.

If the selected period starts or ends inside a target bucket, partial outside boundaries are excluded.

Example for `1d`:

```text
from = 2024-01-10 13:00
to   = 2024-03-20 18:00
```

The daily target range starts at:

```text
2024-01-11 00:00
```

and ends at:

```text
2024-03-20 00:00
```

If the selected period is already exactly on boundaries:

```text
from = 2024-01-10 00:00
to   = 2024-03-20 00:00
```

then those exact timestamps are included.

## Chart mode

Blocks **4. Исходный результат** and **6. Итог торговли по стратегии** have a `Вид Diff` selector:

- `Линия`;
- `Гистограмма`.

The chart mode is a display setting, not a calculation setting. Block **3. Расчет** does not have `Вид Diff`.

In histogram mode:

- `diff` is automatically enabled and displayed as bars;
- `accum`, `hwm`, `dd`, and `mdd` are turned off;
- positive `diff` bars are green, negative bars are red, and zero bars keep the neutral gray color.
- switching back to `Линия` restores the standard visible set: `diff` off, `accum`/`hwm`/`dd`/`mdd` on.

This keeps monthly/yearly period returns readable without changing the meaning of cumulative and drawdown metrics.
