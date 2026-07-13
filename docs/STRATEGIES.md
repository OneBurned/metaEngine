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
strategies/rsi.js    RSI strategy implementation
```

The server should call the strategy registry instead of importing one concrete strategy directly. This keeps the backend ready for future strategy types.

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

Strategy period dates mirror block **“3. Расчет”**. When the user changes calculation dates in block 3 and the strategy panel is open, the strategy period fields are updated to the same values. This keeps the strategy visibly tied to the current base calculation period.

The strategy result block shows three chart areas:

- source portfolio/preset result with its own `diff/accum/hwm/dd/mdd` toggles;
- RSI chart;
- trading strategy result with its own `strategy_diff/strategy_accum/strategy_hwm/strategy_dd/strategy_mdd` toggles.

The source chart lets the user compare the original return/drawdown profile with the calculated strategy result. A shared chart-height selector resizes the source, RSI, and strategy-result charts together so details can be inspected more comfortably.

## RSI optimizer

The RSI calculation is also used as the first optimizer target. The optimizer does not implement separate trading logic. It repeatedly calls the existing strategy calculation with different parameters, similar to the Tester/Optimizer split in OsEngine.

For the first version only these RSI parameters are optimized:

- `rsiPeriod`;
- `buyLevel`;
- `sellLevel`.

`upperLevel`, `lowerLevel`, and `baseline` remain ordinary display/config values and are not part of the optimizer grid yet.

The optimizer returns a ranked table of runs with:

- parameter values;
- final `accum`;
- max drawdown;
- buy/sell counts;
- `score`.

During optimization the UI shows progress:

- completed runs / total runs;
- current parameter set;
- best score found so far.

The user can stop optimization. Stop is soft: the backend finishes the current run chunk, does not start new parameter combinations, and returns the ranked table for the completed runs.

The first score is Recovery-style:

```text
score = finalAccum / abs(maxDrawdown)
```

If max drawdown is zero, the score is handled separately to avoid division by zero.
