# Z-Score trading strategy

Z-Score is a trading strategy module with type `z_score`.

## Source and Z-score

The strategy works on the current base portfolio/preset calculation from block **3. Расчет**.
It follows the same independent-deal model as MDD Mean Reversion, but entries and Z-based exits use a rolling Z-score calculated from drawdown.

For each source point:

```text
source equity = 1 + IN Accum
source DD = source equity / source HWM - 1
```

The user sets `rollingWindow`; the default is `240` points. Until the rolling window is available, rolling mean/std are empty and Source Z is `0`. After that, Source Z is:

```text
Source Z = (source DD - rolling source DD mean) / rolling source DD std
```

The strategy also calculates Strategy Z from OUT DD with the same rolling window, so exits can use either source-side or strategy-side Z recovery.

## Independent deals

One deal contains:

1. entry by Source Z;
2. additive opening weight;
3. exit type;
4. exit value.

Default deals are `-1.5 → 10%`, `-2.0 → 20%`, `-2.5 → 30%`, `-3.0 → 40%`, `-3.5 → 50%`, all with exit `Z исходника 0`. These weights are additive. If all default deals are open, the total strategy weight is `150%`.

Deals are sorted from the smaller Z anomaly to the deeper Z anomaly. Weights do not have to be nondecreasing and the sum of weights is not capped.

## Entry, signal and execution

A deal enters when current Source Z is less than or equal to its configured entry Z-score. When one point gaps through several entries, all crossed deals receive entry signals. Signals are executed on the next point, never on the signal point.

Each deal can open only once during the current source drawdown cycle. If a deal closes before the source recovers to `DD исходника = 0%`, it cannot open again until that recovery starts a new cycle.

## Exit types

Each deal supports one of four exit types:

| Technical value | User label | Meaning |
| --- | --- | --- |
| `source_z` | Z исходника | close when current Source Z recovered to the configured level or better |
| `strategy_z` | Z стратегии | close when current Strategy Z recovered to the configured level or better |
| `source_hwm` | HWM исходника | after source DD recovers to `0%`, close after source growth by the configured percentage points |
| `strategy_hwm` | HWM стратегии | after strategy DD recovers to `0%`, close after strategy growth by the configured percentage points |

Z exits use the current Z value. HWM exits first wait for DD recovery to `0%`, remember the recovery equity, and then wait for the configured growth. All exits are also executed on the next point.

## Parameters

Canonical parameter JSON:

```json
{
  "rollingWindow": 240,
  "deals": [
    { "entryZScore": -1.5, "weight": 0.1, "exitType": "source_z", "exitValue": 0 },
    { "entryZScore": -2.0, "weight": 0.2, "exitType": "source_z", "exitValue": 0 },
    { "entryZScore": -2.5, "weight": 0.3, "exitType": "strategy_hwm", "exitValue": 0.1 }
  ]
}
```

For `source_z` and `strategy_z`, `exitValue` is a Z-score value. For HWM exits, `exitValue` is a decimal percentage value.

## Result table and CSV export columns

Z-Score uses the common strategy table convention:

- `IN ...` means input data from the source calculation;
- `OUT ...` means output result of the trading strategy.

Table/export columns include:

```text
Дата
IN Diff
IN Accum
IN DD
IN DD rolling mean
IN DD rolling std
Source Z
OUT DD rolling mean
OUT DD rolling std
Strategy Z
Signal
Execution
Active deals
Weight
OUT Diff
OUT Accum
OUT HWM
OUT DD
OUT MDD
Max config weight
Max realized weight
```

CSV signal/execution values are stored as ASCII English tokens such as `entry deal`, `opened deal`, `exit deal` and `closed deal` so spreadsheet preview/download remains safe.
