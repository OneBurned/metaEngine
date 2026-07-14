# Trading strategies

This document describes trading strategy code modules and saved strategy configs in the MetaEngine local lab.

## Two different strategy locations

Use these names carefully:

```text
strategies/          Code modules for trading strategies
samples/strategies/  User-saved JSON configs for trading strategies
```

`strategies/` is part of the application source code. It contains reusable strategy implementations such as RSI and MDD Mean Reversion.

`samples/strategies/` is working user data. The backend stores JSON configs there when the user saves a strategy from the UI. Do not delete or overwrite files in `samples/strategies/` unless the user explicitly asks.

## Current module structure

```text
strategies/index.js  Strategy registry and dispatcher
strategies/rsi.js    RSI strategy implementation
strategies/mdd.js    MDD Mean Reversion strategy implementation
```

The server should call the strategy registry instead of importing one concrete strategy directly. This keeps the backend ready for future strategy types.

## RSI strategy rules

The first trading strategy is RSI:

- type: `rsi`;
- RSI source: equity curve `1 + accum` from the already calculated portfolio/preset result;
- visible return series still uses `accum = equity - 1`, so the chart starts from `0%`;
- default parameters: period `14`, buy `30`, sell `70`;
- chart upper/lower levels are derived from `sellLevel` / `buyLevel`; there is no separate RSI baseline parameter;
- long-only trading for now;
- buy signal: downward cross of `buyLevel` (`previous RSI > buyLevel && current RSI <= buyLevel`);
- sell signal: upward cross of `sellLevel` (`previous RSI < sellLevel && current RSI >= sellLevel`);
- the first strategy-period point is not signalable;
- signals execute on the next point, not on the same point, to avoid lookahead;
- repeated buy/sell signals are ignored when already in the corresponding position state;
- if the strategy period goes outside the base calculation period, fill missing source data by the existing missing-data rule and warn the user;
- short logic is intentionally not implemented yet.

## MDD Mean Reversion strategy rules

The second trading strategy is MDD Mean Reversion:

- type: `mdd`;
- source signal: current drawdown `dd` from the already calculated portfolio/preset result;
- entry count is configurable, currently from 1 to 10;
- each entry has its own positive drawdown percentage and weight percentage;
- `maxTotalWeight` limits the sum of all entry weights, for example `100` means no more than one full position;
- one common exit level is configured as a positive drawdown percentage;
- when the source `dd` recovers to the exit level, the strategy closes all entry steps;
- execution uses the next point, matching the no-lookahead rule used by RSI.

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

The strategy result block shows two chart areas:

- RSI chart;
- one comparison chart with source portfolio/preset result and trading strategy result together.

The comparison chart has separate toggles for source `diff/accum/hwm/dd/mdd` and strategy `strategy_diff/strategy_accum/strategy_hwm/strategy_dd/strategy_mdd`. The strategy-result comparison chart and RSI chart are rendered with Plotly. A shared chart-height selector resizes both charts together. Users can box-zoom by dragging on the chart, pan/scroll zoom through Plotly controls, reset with double-click, or use the explicit reset button. Both Plotly charts synchronize their X range.

## Strategy optimizer

The optimizer supports RSI and MDD Mean Reversion. It keeps the same trading rules as the ordinary strategy calculation, similar to the Tester/Optimizer split in OsEngine.

For RSI these parameters are optimized:

- `rsiPeriod`;
- `buyLevel`;
- `sellLevel`.

`upperLevel`, `lowerLevel`, and `baseline` are not separate RSI optimizer inputs. `upperLevel/lowerLevel` are derived from `sellLevel/buyLevel`.

For MDD these parameters are optimized:

- `entry1..entryN`;
- `weight1..weightN`;
- `exitLevel`.

`N` comes from the UI field `Кол-во входов`; the local lab currently clamps it to 1..10. Optimizer candidates whose total weight exceeds `maxTotalWeight` are skipped before they enter the optimization job. MDD optimizer weights must be non-decreasing by entry number; equal neighboring weights are allowed.

MDD parameter input has two UI modes:

- `simple` — one shared entry range, one shared weight range, `minEntryDelta`, and `maxTotalWeight`;
- `detailed` — separate entry and weight ranges for every entry.

Both modes normalize into the same optimizer candidate shape: `entry1..entryN`, `weight1..weightN`, `exitLevel`. In simple mode entries are sorted and accepted only when every neighboring pair respects `minEntryDelta`.

MDD optimizer has two search modes:

- `random` — default mode for wide ranges. It generates at most `maxCandidates` reproducible candidates from the configured ranges using `seed`, normalizes entry levels into strict ascending order, and does not materialize the full combinatorial grid in memory.
- `full` — full Cartesian search with ordered entries, intended only for small ranges.

The optimizer returns a ranked table of runs with:

- parameter values;
- final `accum`;
- max drawdown;
- buy/sell counts;
- `score`.

During optimization the UI shows progress:

- completed runs / total runs;
- completed parameter combinations / total combinations;
- accepted and filtered-out parameter combinations;
- sample count;
- current parameter set;
- best score found so far.

The user can stop optimization. Stop is soft: the backend finishes the current run chunk, does not start new parameter combinations, and returns the ranked table for the completed runs.

The result table supports client-side sorting by clicking numeric column headers. The first click sorts descending, the next click on the same header sorts ascending.

Each optimization row has a `Построить график` action. It copies the selected run parameters into strategy block 5 and immediately runs the strategy calculation so the comparison chart appears in block 6.

The optimizer can split the selected period into samples before optimization. With `sampleCount = 1`, behavior is the old full-track optimization. With `sampleCount > 1`, the already calculated source rows are split into sequential chunks by point count. Each sample is recalculated from its own `diff` series so its `accum` starts from zero.

For performance, sample preparation happens before the parameter search. RSI is calculated once per `(sample, rsiPeriod)` and cached in memory for the running optimizer job. Buy/sell level combinations then use a metrics-only RSI evaluator. MDD uses a metrics-only evaluator over the sample rows. Both paths produce the same summary values as the full strategy calculation without rebuilding chart rows for every run.

During long searches the backend keeps only the current top `maxResults` runs in memory. Progress counters still reflect the full grid, but completed low-ranked runs are not retained in the optimizer job object.

Optional cutoff filters are applied before a run is retained in top results:

- max drawdown percent, entered as a positive value such as `20` for `MDD >= -20%`;
- minimum total trades, calculated as total buys plus sells across samples;
- minimum profitable samples.

The final table renders only runs that pass the active cutoff filters. If all retained runs are filtered out, the table shows an empty-state row instead of stale results.

For every parameter combination the optimizer runs all samples and aggregates:

- profitable sample count;
- average and worst score;
- average and worst accum;
- compounded accum: `(1 + sample1Accum) * (1 + sample2Accum) * ... - 1`;
- average and worst drawdown;
- per-sample accum/MDD/score details.

The ranking score for sample optimization is stability-oriented:

```text
score = min(sampleScores)
```

This favors parameters whose worst sample still performs acceptably.

The first score is Recovery-style:

```text
score = finalAccum / abs(maxDrawdown)
```

If max drawdown is zero, the score is handled separately to avoid division by zero.
