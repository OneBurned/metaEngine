# Trading strategies

This document describes trading strategy code modules and saved strategy configs in the MetaEngine local lab.

## Two different strategy locations

Use these names carefully:

```text
strategies/          Code modules for trading strategies
samples/strategies/  User-saved JSON configs for trading strategies
```

`strategies/` is part of the application source code. It contains reusable strategy implementations such as RSI.

`samples/strategies/` is working user data. The backend stores JSON configs there when the user saves a strategy from the UI. Do not delete or overwrite files in `samples/strategies/` unless the user explicitly asks.

## Current module structure

```text
strategies/index.js  Strategy registry and dispatcher
strategies/rsi.js                RSI strategy implementation
strategies/mddMeanReversion.js   MDD Mean Reversion implementation
```

The server should call the strategy registry instead of importing one concrete strategy directly. This keeps the backend ready for future strategy types.

## Detailed strategy docs

Detailed per-strategy docs live in:

```text
docs/strategies/RSI.md
docs/strategies/MDD_MEAN_REVERSION.md
docs/strategies/MDD_GRID.md
```

This overview keeps shared rules, module locations, and cross-strategy UX conventions.

## Shared strategy table and export convention

Strategy tables and current-strategy CSV export use the same IN/OUT naming rule:

- `IN ...` columns are input values from the base portfolio/preset calculation;
- `OUT ...` columns are output values produced by the trading strategy.

Saved strategies are configuration presets, not calculated result series. The saved-strategy list has a **Применить** action that loads the saved config back into block **5. Стратегии**. CSV export for strategies exports the **current calculated strategy result table**, not saved JSON configs.

## RSI strategy rules

The first trading strategy is RSI:

- type: `rsi`;
- RSI source: equity curve `1 + accum` from the already calculated portfolio/preset result;
- visible return series still uses `accum = equity - 1`, so the chart starts from `0%`;
- default parameters: period `14`, upper `70`, lower `30`, baseline `50`;
- long-only trading for now;
- buy signal: downward cross of `buyLevel` (`previous RSI > buyLevel && current RSI <= buyLevel`);
- sell signal: upward cross of `sellLevel` (`previous RSI < sellLevel && current RSI >= sellLevel`);
- the first strategy-period point is not signalable;
- signals execute on the next point, not on the same point, to avoid lookahead;
- repeated buy/sell signals are ignored when already in the corresponding position state;
- if the strategy period goes outside the base calculation period, fill missing source data by the existing missing-data rule and warn the user;
- short logic is intentionally not implemented yet.

## Result rows

RSI strategy rows should distinguish:

- `signal` — the generated signal on the current point;
- `execution` — the signal that is executed on the current point;
- `position` — current long-only position after execution;
- `source_diff` / `source_accum` — source calculation values;
- `strategy_diff`, `strategy_accum`, `strategy_hwm`, `strategy_dd`, `strategy_mdd` — strategy result series.

## MDD Mean Reversion strategy rules

The second trading strategy is MDD Mean Reversion:

- type: `mdd_mean_reversion`;
- source: already calculated base portfolio/preset rows;
- it uses standard base equity metrics (`equity = 1 + accum`, HWM, DD) and adds a **local MDD** for the current drawdown cycle;
- local MDD resets to `0` every time base DD returns to `0`;
- default grid has five levels: `-10% → 10%`, `-20% → 20%`, `-30% → 30%`, `-40% → 40%`, `-50% → 50%`;
- grid weights are target total position weights, not incremental buys;
- weights may be greater than `100%` for leverage, but cannot be negative;
- if one point gaps through multiple levels, the deepest crossed level wins immediately;
- every weight change is executed on the next point, not the signal point;
- after DD returns to `0` while a position is open, the strategy waits for TP;
- TP is defined as base asset movement after recovery, so `TP 1%` with `10%` weight adds roughly `0.1%` to strategy equity during the TP leg;
- `TP 0%` closes after recovery, still from the next point;
- if the base series returns to DD `< 0` before TP, TP waiting is cancelled and the MDD grid becomes active again.

MDD strategy rows should distinguish:

- `base_equity` — current source equity;
- `base_dd` — current source DD;
- `local_mdd` — local MDD of the current drawdown cycle;
- `local_accum` — source equity growth from the TP-start point after DD has recovered to `0`; this is the visible value that reaches TP, for example `Local Accum >= 1%` triggers `TP` when TP is `1%`;
- `signal` — target-weight or TP-close signal on the current point;
- `execution` — weight change executed on the current point;
- `position` — current target weight after execution;
- `tp_state` — waiting / hit / cancelled state for the TP automaton;
- `source_diff` / `source_accum` — source calculation values;
- `strategy_diff`, `strategy_accum`, `strategy_hwm`, `strategy_dd`, `strategy_mdd` — strategy result series.

For charts, MDD follows the same layout as RSI: first the base result graph plus an indicator subgraph, then the separate strategy-result graph and table. The MDD indicator subgraph shows base DD, local MDD, and the configured grid levels. In the result table input columns are shown first (`IN Diff`, `IN Accum`, `IN DD`), then local MDD/TP fields and output strategy columns (`OUT Diff`, `OUT Accum`, `OUT HWM`, `OUT DD`, `OUT MDD`). User-facing labels are localized: `target_weight:0.1` is displayed as `Вес 10%`, `weight:0` as `Вес 0%`, `take_profit_close` as `TP`, and TP states as `Ждем TP`, `TP`, or `TP отменен`.

## Production MDDGrid

`MDDGrid` is a production-only module for now; it is not implemented in the
Node.js local lab. Unlike MDD Mean Reversion, every level adds its own
incremental lot and has an individual TP source. A closed lot becomes available
again after a fresh source DD crossing of its level, without waiting for DD to
recover to 0%. See `docs/strategies/MDD_GRID.md` for its calculation contract.

## Strategy optimizer

Block **“5. Стратегии”** includes an optimizer for the current selected strategy type.

Shared optimizer rules:

- the optimizer uses the already selected portfolio/preset and period from block **“3. Расчет”**;
- the track can be split into `N` sequential samples before optimization;
- every parameter candidate is calculated on every sample;
- the result table shows per-sample metrics, compounded sample accum, worst MDD, trade count and Recovery score;
- stop requests finish the current candidate and then save/show the best accumulated results;
- table rows can be sorted by metric columns, and a row can be applied back to block **“5. Стратегии”** to calculate and plot the strategy.

RSI optimizer parameters:

- `rsiPeriod`;
- `buyLevel`;
- `sellLevel`.

For RSI, `upperLevel` and `lowerLevel` in the form mirror `sellLevel` and `buyLevel`. `baseline` is not optimized.

MDD Mean Reversion optimizer parameters:

- level count;
- drawdown levels;
- target weights;
- take profit;
- minimum drawdown delta between levels;
- maximum total target weight.

MDD optimizer weights are **target total position weights**, not incremental buys. For example, levels `10%`, `20%`, `30%` mean the deepest level targets `30%` total exposure. The optimizer requires weights to be nondecreasing, equality is allowed. “Макс. общий вес” limits the maximum target weight level, not the sum of all level values.

Production MDDGrid optimization uses the completed base calculation split into
sequential samples. It prepares source metrics once per sample, streams valid
candidates and persists only top-N results. One job selects a common exit metric
for all levels, while each level receives its own DD entry, incremental weight
and TP. DD TP is an absolute target DD; HWM TP is growth from HWM at entry.
Mixed exit metrics remain available in manual MDDGrid runs.

## Adding future strategies

When adding a new strategy:

1. Add a module under `strategies/`.
2. Register it in `strategies/index.js`.
3. Keep shared time-series math in `lib/calculations.js` when it is not strategy-specific.
4. Add tests for the new module and registry.
5. Update `README.md`, `AGENTS.md` if process/context changes, `docs/PROJECT_CONTEXT.md`, and this document.

## Strategy calculation UX

The strategy calculation button must not look frozen while a calculation is running.

Rules:

- the trading strategy button is disabled until the base calculation from block **“3. Расчет”** is available;
- the disabled button should expose a tooltip explaining why it is disabled;
- the strategy panel should show a warning box if the user enables strategies before running the base calculation;
- if the base calculation inputs change after a calculation, the strategy button is disabled until the user recalculates block 3;
- while the strategy is calculating, the button is disabled and its text changes to `Рассчитывается.`, `Рассчитывается..`, `Рассчитывается...`;
- when the calculation finishes or fails, the original button text is restored.

Trading strategies have their own **ТФ для расчета** in block **“5. Стратегии”**. The strategy calculation timeframe may be the same as the base calculation timeframe from block **“3. Расчет”** or larger, but it may not be smaller. For example, a base `1h` calculation can feed a strategy calculated on `1h`, `1d`, `1M`, or `1Y`, but not `15m`, `5m`, or `1m`.

If the user selects a lower strategy timeframe than the available base calculation timeframe, the UI warns:

```text
Вы выбрали ТФ ниже чем имеется в расчетах
```

Block **“6. Итог торговли по стратегии”** has a separate **ТФ для отображения** and `Вид Diff`, so a strategy can be calculated on one timeframe and displayed on the same or a larger timeframe.

After a new base calculation in block **“3. Расчет”**, the strategy calculation timeframe in block **“5. Стратегии”** resets to the fresh base calculation timeframe. After a new strategy calculation, block **“6. Итог торговли по стратегии”** displays the fresh strategy calculation timeframe by default. The user can then manually choose a larger display timeframe.

Strategy period dates mirror block **“3. Расчет”**. When the user changes calculation dates in block 3 and the strategy panel is open, the strategy period fields are updated to the same values. This keeps the strategy visibly tied to the current base calculation period.
