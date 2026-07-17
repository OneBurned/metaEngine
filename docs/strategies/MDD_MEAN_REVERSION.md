# MDD Mean Reversion trading strategy

MDD Mean Reversion is a trading strategy module with type `mdd_mean_reversion`.

## Source and local drawdown

The strategy works on the current base portfolio/preset calculation from block **3. Расчет**.
Input values use the `IN` prefix: `IN Diff`, `IN Accum`, `IN DD`.

The entry indicator is **Local DD исходника**: the worst source DD inside the current source drawdown cycle. It resets to `0` when source DD returns to `0`; the next negative source DD starts a new cycle.

## Independent deals

MDD now uses independent deals instead of one target-weight grid. One deal contains:

1. entry by Local DD исходника;
2. additive opening weight;
3. exit type;
4. exit value.

Default deals are `-10% → 10%`, `-20% → 20%`, `-30% → 30%`, `-40% → 40%`, `-50% → 50%`, all with exit `DD исходника 0%`. These weights are additive. If all default deals are open, the total strategy weight is `150%`.

Deals are sorted by entry DD from the smaller drawdown to the deeper drawdown. Weights do not have to be nondecreasing and the sum of weights is not capped; leverage configurations such as `50% + 100% = 150%` are valid.

## Entry, signal and execution

Every deal enters only by Local DD исходника. When one point gaps through several entries, all crossed deals receive entry signals. Signals are executed on the next point, never on the signal point.

Each deal can open only once during the current source drawdown cycle. If a deal closes before the source recovers to `DD исходника = 0%`, it cannot open again until that recovery starts a new cycle.

## Exit types

Each deal supports one of four exit types:

| Technical value | User label | Meaning |
| --- | --- | --- |
| `source_dd` | DD исходника | close when current source DD recovered to the configured level or better |
| `strategy_dd` | DD стратегии | close when current strategy DD recovered to the configured level or better |
| `source_hwm` | HWM исходника | after source DD recovers to `0%`, close after source growth by the configured percentage points |
| `strategy_hwm` | HWM стратегии | after strategy DD recovers to `0%`, close after strategy growth by the configured percentage points |

DD exits use the current DD value. HWM exits first wait for DD recovery to `0%`, remember the recovery equity, and then wait for the configured growth. All exits are also executed on the next point.

## Parameters

Canonical parameter JSON:

```json
{
  "deals": [
    { "entryDrawdown": -0.1, "weight": 0.1, "exitType": "source_dd", "exitValue": 0 },
    { "entryDrawdown": -0.2, "weight": 0.2, "exitType": "source_dd", "exitValue": 0 },
    { "entryDrawdown": -0.3, "weight": 0.3, "exitType": "strategy_hwm", "exitValue": 0.1 }
  ]
}
```

Legacy `levels + takeProfit` parameters are accepted as old saved configs, but they are normalized to independent deals with `source_dd` exit at `0%`.

## Result table and CSV export columns

MDD uses the common strategy table convention:

- `IN ...` means input data from the source calculation;
- `OUT ...` means output result of the trading strategy.

Table/export columns include:

```text
Дата
IN Diff
IN Accum
IN DD
Local DD исходника
Local Accum (legacy TP field; not used by independent-deal exits)
Сигнал
Исполнение
Активные сделки
Вес
OUT Diff
OUT Accum
OUT HWM
OUT DD
OUT MDD
Максимально возможный вес конфигурации
Максимально набранный вес в расчете
```

CSV export for the current strategy result exports the current calculated strategy table, not saved JSON configuration. Stable technical headers should include `timestamp,in_diff,in_accum,in_dd,local_mdd,local_accum,tp_status,signal,execution,active_deals,weight,out_diff,out_accum,out_hwm,out_dd,out_mdd,max_config_weight,max_realized_weight`.

## Production optimization

Production MDD optimization evaluates candidates under the same independent-deal model. Simple mode searches entry Local DD исходника and additive weight, while defaulting the exit to `DD исходника 0%`. Detailed mode can be extended with per-deal exit type/value. The optimizer does not require nondecreasing weights and does not reject candidates because the sum of weights exceeds `100%`.
