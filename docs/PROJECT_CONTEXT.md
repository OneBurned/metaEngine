# Agent handoff: MetaEngine local lab

This document is written for a future AI agent that receives the repository with little or no chat history. It explains the current local prototype, product decisions, exact behavior, git workflow expectations, and safe backup/restore practices.

## 1. Current project state

MetaEngine currently contains two parallel parts:

- a **local file-based Node.js calculation lab** for validating formulas and UI;
- an initial **.NET 10 production scaffold** with separate API, Worker, strategy
  abstractions and descriptors for RSI and MDD Mean Reversion.

The local lab implementation is intentionally small:

- runtime: Node.js, no external npm dependencies;
- UI: browser page served locally;
- storage: files under `samples/`;
- tests: Node built-in test runner.

This is not the final production stack. The repository defaults still say production should be:

- ASP.NET Core / C#;
- .NET 10 LTS;
- PostgreSQL;
- async calculations saved to database;
- API responses suitable for frontend JSON contracts and later Plotly-compatible chart payloads.

The Node.js local lab exists because the immediate goal is to let the user manually validate CSV data, preset behavior, and calculation formulas quickly. The .NET scaffold does not calculate strategies yet; descriptors explicitly report that production calculation is unavailable until formula parity is complete.

## Documentation map

```text
README.md                 Human-facing project overview and run guide
AGENTS.md                 Required workflow rules for AI agents
docs/PROJECT_CONTEXT.md   Full project context and product decisions
docs/STRATEGIES.md        Trading strategy modules and saved strategy configs
docs/CSV_EXPORT.md        CSV export behavior and API
docs/TIMEFRAMES.md        Timeframe conversion and histogram chart mode
docs/CALCULATION_CONTRACTS.md
                           Calculation contracts and shared golden fixtures
docs/CALCULATION_ENGINE.md Production base metrics and timeframe engine
docs/PRODUCTION_READINESS.md
                           Production architecture, migration and release gates
docs/PRODUCTION_SCAFFOLD.md
                           Current .NET scaffold, API, Worker and run guide
docs/PORTFOLIO_IMPORT.md   Production portfolio CSV import and version API
docs/PRESETS.md            Production presets, versions, API and calculation core
docs/CALCULATION_RUNS.md   Production base calculation queue, worker and artifacts
docs/QUEUE_RELIABILITY.md  Lease-based recovery, retry and parallel Worker safety
docs/PRODUCTION_OPTIMIZATION.md
                           Production RSI optimization jobs, API and Worker
docs/PRODUCTION_UI.md      Production React UI and local run workflow
docs/PRODUCTION_STRATEGIES.md
                           Production RSI/MDD runs and saved strategy configs
```

Keep documentation updated after functional changes. Update the thematic docs when a module changes instead of growing this file endlessly.

## Production P2c: presets

The production platform now has a versioned preset API and a domain-level
preset calculation engine. Each preset item references an exact immutable
portfolio version; its decimal weight may create leverage and its time range is
`[start, end)` with `null` as open end. The same portfolio version may be used
for rebalancing only when its ranges do not overlap. The engine combines active
weighted `diff` rows, fills a missing native source point with zero, and then
uses the shared base-metrics/timeframe engine. P3 can calculate a saved preset
through a job; P4 UI does not yet expose preset creation or execution. See
`docs/PRESETS.md` for the current API and constraints.

## Production P3: calculation runs

The platform can now queue a base calculation for one immutable portfolio or
preset version. API returns `queued` immediately; the separate Worker claims
the run, calculates the canonical result, saves a `timestamp,diff` artifact and
updates its summary/status. The API exposes list, details and paged canonical
result rows. P3 itself did not include a UI, cancel/retry, strategies or
optimizer jobs; the browser UI for portfolio imports and calculation runs is
added in P4.
See `docs/CALCULATION_RUNS.md` for endpoints and operational behavior.

## Production P4: working UI

`src/MetaEngine.Web` is a separate React/TypeScript client built with TanStack
Router and shadcn/ui. It uses a same-origin development proxy to the API so
cookie/CSRF protections remain unchanged. The user can sign in, import a
portfolio in the **Data** section, inspect saved portfolios/strategies/presets,
queue and observe base calculations, and inspect saved results with interactive
result and comparison charts. The UI also exposes manual RSI/MDD calculations,
strategy presets and production RSI optimization with progress, stop and
result selection.
See `docs/PRODUCTION_UI.md`.

## Production P5a: strategy runs

RSI and MDD Mean Reversion are now executable production modules. A strategy
run references one completed immutable base run, is processed by the Worker,
and saves a canonical `timestamp,diff` `StrategyResult` artifact. A completed
run can be saved as a versioned strategy configuration. The UI exposes manual
RSI/MDD calculation and saved configurations; optimization and use of saved
strategy artifact points separate from portfolio/preset points, avoiding
cross-product queries on long source series. See `docs/PRODUCTION_STRATEGIES.md`.

## Production P5b: presets with strategy sources

Saved strategy versions can now be used alongside portfolio versions in an
immutable preset. A preset calculation combines their canonical `timestamp,diff`
rows with the configured weights and periods. The production UI exposes a
**Presets** page and allows a saved preset to be chosen for a base calculation.

## Production P6: strategy optimizers

The platform can queue an RSI or MDD Mean Reversion optimization job from a
completed immutable base calculation. The Worker splits that source into
consecutive samples, prepares each strategy independently for every sample,
streams candidates and persists only top-N aggregate metrics. The job exposes
progress, filters and a stop request that finishes the current candidate before
publishing accumulated results. A selected row queues a normal strategy run on
the same base calculation; saving that run creates the usual immutable saved
strategy with a link back to the optimization result. The **Strategies** screen
provides separate manual and optimization tabs, including range/filter controls,
live progress, stop, recent jobs, sortable sample metrics and a command to queue
the chosen candidate as a standard strategy run. See
`docs/PRODUCTION_OPTIMIZATION.md`.

For RSI performance, candidates are enumerated period-first. Each sample keeps
only the current period's prepared RSI series and reuses it for all buy/sell
pairs; it then discards that series when the period changes. Optimizer
evaluations use summary metrics without allocating full candidate result rows.

MDD uses the same bounded result workflow. Its simple mode expands a common DD
and weight range into the chosen number of entries while enforcing the minimum
DD delta and nondecreasing target weights. Detailed mode provides an independent
DD/weight range for every entry. Random search has a finite requested candidate
count; full search remains streamed and intentionally avoids counting the whole
space before running.

## Production P8: reliable queue foundation

Calculation and optimization jobs are claimed with a PostgreSQL row lock and a
unique lease. A second Worker cannot claim the same task, and a late Worker
cannot overwrite a result after its lease has expired. The Worker recovers
expired leases, automatically retries transient database failures with a small
exponential delay, and leaves an `interrupted` task after the configured retry
budget. Failed or interrupted tasks can be retried deliberately from the UI.
A stopping optimization is finalized as `stopped` during recovery. This makes
several Worker processes safe to run against one database; configuring replica
count and production capacity is the next operational stage. See
`docs/QUEUE_RELIABILITY.md`.

## 2. User communication rules

The user is not a coder. Communicate simply. Do not explain implementation details with variable names, object fields, or code-like assignments unless the user explicitly asks for code-level detail. Explain behavior in product/UI terms instead.

Do not say only “pull latest” or “update branch”. Give exact commands.

Preferred format when the user checks an open PR before merge:

```bash
cd /workspaces/metaEngine
# stop server with Ctrl+C if it is running
git fetch
gh pr checkout <PR_NUMBER>
git status
git log --oneline --decorate -5
npm test
npm start
```

Use `main` commands only after the user says the PR has been merged or the task
should be cemented:

```bash
cd /workspaces/metaEngine
# stop server with Ctrl+C if it is running
git switch main
git pull --ff-only
git status
git log --oneline --decorate -5
npm test
npm start
```

Do not ask the user to run `git remote add origin` for normal PR checking. Do
not tell the user to switch to a local sandbox branch such as `work` unless that
branch is confirmed to be the real GitHub PR branch.

Then tell the user to refresh the browser:

```text
Ctrl + Shift + R
```

On Mac:

```text
Cmd + Shift + R
```

When explaining product behavior, use words like “стратегия”, “пресет”, “расчет”, not low-level backend jargon unless needed.

## 3. Repository process rules

Follow `AGENTS.md`:

1. Discuss the task first.
2. State the task condition or short plan.
3. Ask: “Устраивает ли такое условие?”
4. Code only after user confirmation.
5. After implementation, show what changed and how it was checked.
6. Push/deploy only after explicit user approval.

Do not use destructive git commands such as `git reset --hard` unless the user explicitly asks and understands the impact.

## 4. Current file map

```text
server.js                         Node HTTP server and API
MetaEngine.slnx                   .NET 10 production solution
src/MetaEngine.Api               ASP.NET Core API scaffold
src/MetaEngine.Worker            Separate background Worker scaffold
src/MetaEngine.Web               React/TanStack Router production client
src/MetaEngine.Domain/Calculations
                                 Production base calculation engine
src/MetaEngine.Strategies.*      Strategy contracts and module descriptors
tests/MetaEngine.ContractTests   .NET architecture and fixture tests
tests/MetaEngine.DomainTests     .NET base calculation unit/golden tests
lib/calculations.js               Calculation and CSV normalization logic
public/index.html                 Browser UI markup
public/app.js                     Browser UI behavior
public/styles.css                 Browser UI styling
test/calculations.test.js         Unit and UI contract tests
docs/TIMEFRAMES.md                Timeframe conversion rules
README.md                         Human-facing usage docs
docs/PROJECT_CONTEXT.md           Project context for future AI agents
samples/strategies                Saved trading strategy JSON configs
samples/presets                   Saved preset JSON files
samples/runs                      Saved calculation run JSON files
```

The `samples/` data files are working user data. Be careful with them. Do not delete or overwrite user data unless explicitly asked.

## 5. How to run

In GitHub Codespaces:

```bash
cd /workspaces/metaEngine
npm start
```

Production scaffold commands:

```bash
cp -n .env.example .env
docker compose up -d postgres
dotnet tool restore
dotnet ef database update --project src/MetaEngine.Infrastructure --startup-project src/MetaEngine.Infrastructure
dotnet build MetaEngine.slnx
dotnet test MetaEngine.slnx
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
```

Port `5080` exposes health endpoints and `/api/v1/strategy-types`.
`/health/ready` requires PostgreSQL connectivity and an up-to-date migration
history. The production scaffold is not yet a replacement for the Node.js
calculation API.

Production authentication has no public registration. The initial owner and
personal workspace are created once through `--bootstrap-admin` with email and
password supplied through environment variables. Auth uses an HttpOnly cookie,
state-changing auth requests require a CSRF token, and workspace endpoints only
return memberships of the authenticated active user. Roles are `Admin`,
`Researcher` and `Viewer`; details are in `docs/PRODUCTION_AUTH.md`.

The platform CI uses PostgreSQL 16 and runs migration parity/application,
NuGet security audit, all .NET tests, the Node.js reference suite, and a real
PostgreSQL bootstrap/login/workspace integration test. The integration test is
conditionally skipped on developer machines without a dedicated test database,
but is mandatory in GitHub Actions. See `docs/PRODUCTION_CI.md`.

The first production calculation-engine slice is portfolio persistence. The API
accepts only canonical UTF-8 `timestamp,diff` CSV at this stage, normalizes UTC
ordering, rejects duplicate timestamps, reports gaps, and stores immutable
versions with raw and normalized-series SHA-256 checksums. Re-importing the same
file or semantic series returns the existing version. This intentionally does
not yet replace the local lab's broader `timestamp,value` plus `diff/accum`
upload. See `docs/PORTFOLIO_IMPORT.md`.

The second calculation-engine slice is the pure C# base calculation core. It
builds the selected source grid, applies `missing diff = 0`, calculates
`accum/hwm/dd/mdd`, and converts only to the same or a larger timeframe through
UTC checkpoints. It reads the same base golden fixture as the Node.js reference.
Returns below `-100%` are rejected; exactly `-100%` leaves equity at zero and is
handled without non-finite values during timeframe conversion. The core has no
HTTP endpoint or persistence workflow yet. See `docs/CALCULATION_ENGINE.md`.

The server prints:

```text
MetaEngine local lab: http://localhost:5173
```

Open the port:

```text
Ports → 5173 → Open in Browser
```

If the port is not shown:

```text
Ctrl + Shift + P → Forward a Port → 5173
```

To make the app accessible to another person, change port visibility to `Public`. Warn the user: there is no authentication, so anyone with the link can upload/delete strategies, create/delete presets, and run calculations.

## 6. Tests and checks

Use:

```bash
npm test
dotnet test MetaEngine.slnx
```

Use syntax checks:

```bash
node --check server.js && node --check public/app.js && node --check lib/calculations.js
```

Current tests cover:

- timestamp parsing and formatting;
- CSV normalization;
- timeframe boundary generation and safe aggregation;
- `accum → diff` conversion;
- `accum`, `hwm`, `dd`, `mdd` series;
- overlap validation for rebalance periods;
- missing strategy file behavior in presets.

## 7. CSV strategy rules

The current input CSV format is two columns, no header required:

```csv
1734606000000,0
1734609600000,0.0001422356863014
1734613200000,-0.0005010288408471
```

Meaning:

```text
timestamp,value
```

The user chooses whether `value` is:

- `diff`; or
- `accum`.

After upload, the strategy is always saved as normalized:

```csv
timestamp,diff
...
```

If input was `accum`, convert to `diff` before saving.

## 8. Timestamp and date rules

UI date format:

```text
YYYY-MM-DD HH:MM
```

Examples:

```text
2026-04-30 14:00
2025-04-09 23:00
2021-10-03 23:00
```

Timestamp values are Unix timestamps in milliseconds.

The user explicitly said not to shift displayed hours. Current implementation formats with UTC getters, so the timestamp is displayed consistently as the intended `YYYY-MM-DD HH:MM` value.

## 9. diff and accum rules

### diff

`diff` is the return for one time step.

Example:

```text
0.01 = +1%
-0.005 = -0.5%
```

### accum

`accum` is accumulated return.

If an input file is `accum`, convert to `diff` with:

```text
diff_t = (1 + accum_t) / (1 + accum_previous) - 1
```

The first point must have:

```text
diff = 0
```

For any selected calculation period, the resulting `accum` starts from zero at the first point of that selected period.

## 10. Missing data rule

The user made this rule explicit and universal:

```text
IF DATA IS MISSING:
- for diff: use 0
- for accum: use previous known accum value
```

Because stored strategies are normalized to `timestamp,diff`, missing calculation points normally become:

```text
diff = 0
```

Example for `diff`:

Input:

```csv
timestamp,diff
2024-01-06 00:00,0
2024-01-06 01:00,-0.0003
2024-01-06 03:00,0.0002
```

Calculation behavior:

```csv
timestamp,diff
2024-01-06 00:00,0
2024-01-06 01:00,-0.0003
2024-01-06 02:00,0
2024-01-06 03:00,0.0002
```

Example for `accum` before normalization:

Input:

```csv
timestamp,accum
2024-01-06 00:00,0.1
2024-01-06 01:00,0.2
2024-01-06 03:00,0.3
```

Logical fill:

```csv
timestamp,accum
2024-01-06 00:00,0.1
2024-01-06 01:00,0.2
2024-01-06 02:00,0.2
2024-01-06 03:00,0.3
```

Then convert to `diff`.

The UI should warn about gaps and provide a way to show gap logs.

## 11. Step detection

Current code infers a time step from data. Known useful steps:

- 5 minutes;
- 1 hour;
- 1 day.

Initially, the user expected mostly hourly data. 5-minute support may become important later.

If step detection finds gaps, do not silently hide this. Surface warnings/logs.

## 12. Strategy behavior

A strategy is a normalized CSV file in:

```text
samples/strategies
```

User-visible behavior:

- upload strategy;
- choose `diff` or `accum`;
- view point count, period, inferred step, gap count;
- delete strategy.

If uploading another strategy with the same name, do not silently overwrite. Current behavior uses a unique suffix such as `_2`.

If a strategy is deleted while used by a preset:

- do not delete the preset;
- the missing strategy contributes zero diffs during preset calculation;
- if the user later uploads a strategy with the same filename, it participates again.

This behavior is important and should not be changed without asking the user.

## 13. Preset behavior

A preset is a recipe with:

- name;
- strategy rows;
- weight percent;
- active period from;
- active period to, or “until end”.

Presets are JSON files in:

```text
samples/presets
```

User inputs weights as percentages:

```text
100 = 100%
25 = 25%
-20 = -20%
150 = 150%
```

Internally use fractions:

```text
100% -> 1.0
25% -> 0.25
-20% -> -0.2
150% -> 1.5
```

`date_to = null` means “until end”.

The UI should use a clear checkbox such as “До конца”, not ask the user to type `0`.

## 14. Rebalancing rules

The same strategy may appear multiple times in one preset if periods do not overlap.

Allowed:

```text
strategy_a: 100%, 2024-01-01 00:00 — 2025-01-01 00:00
strategy_a: 10%,  2025-01-01 00:00 — до конца
```

Not allowed:

```text
strategy_a: 100%, 2024-01-01 00:00 — 2025-01-01 00:00
strategy_a: 10%,  2024-06-01 00:00 — 2025-06-01 00:00
```

Reason: overlapping periods for the same strategy make the active weight ambiguous.

## 15. Calculation rules

All final calculations must be based on `diff`.

For one strategy:

1. Build grid for selected period.
2. Fill missing diff with `0`.
3. Calculate `accum`, `hwm`, `dd`, `mdd`.

For preset:

1. Build grid for selected period.
2. For every active preset row, get strategy diff at timestamp.
3. If missing, use `0`.
4. Apply weight.
5. Sum weighted diffs:

```text
preset_diff = sum(strategy_diff * weight)
```

6. Calculate `accum`, `hwm`, `dd`, `mdd` from `preset_diff`.

## 16. DD and MDD rules

`dd` is current drawdown at each point.

`mdd` is not only one final number. It is a series showing the worst drawdown observed up to each point.

Example:

```text
DD:
0
-0.02
-0.05
-0.01
-0.08
-0.03

MDD:
0
-0.02
-0.05
-0.05
-0.08
-0.08
```

This is required so MDD can be plotted as a line.

## 17. Chart/UI rules

The result should show:

- summary table;
- detailed table by timestamp;
- SVG chart;
- toggles for `diff`, `accum`, `hwm`, `dd`, `mdd`.

Toggle colors should match chart line colors.

Preset row inputs must not overlap visually. Use responsive grid behavior.

Use date picker fields for date/time inputs.

## 18. API endpoints

Current API:

```http
GET /api/strategies
POST /api/strategies
DELETE /api/strategies/{file}
GET /api/presets
POST /api/presets
DELETE /api/presets/{name}
POST /api/calculate
```

Upload strategy uses multipart form-data:

```text
file
name
valueType = diff | accum
```

Create preset uses JSON body with:

```json
{
  "name": "preset_1",
  "overwrite": false,
  "items": [
    {
      "strategy": "strategy_a.csv",
      "weightPercent": 100,
      "date_from": "2024-01-01 00:00",
      "date_to": "2025-01-01 00:00",
      "untilEnd": false
    }
  ]
}
```

Calculate uses JSON body:

```json
{
  "targetType": "preset",
  "targetName": "preset_1",
  "periodFrom": "2024-01-01 00:00",
  "periodTo": "2025-01-01 00:00"
}
```

or:

```json
{
  "targetType": "strategy",
  "targetName": "strategy_a.csv",
  "periodFrom": "2024-01-01 00:00",
  "periodTo": "2025-01-01 00:00"
}
```

## 19. Known limitation: decimal vs percent input

Current upload parsing accepts numeric values as decimal returns.

This means:

```text
0.015 = 1.5%
```

But:

```text
1.5 = 150%
```

This is dangerous if the user meant `1.5%`.

A future fix should add an explicit value-scale selector:

```text
Decimal: 0.015 means 1.5%
Percent: 1.5 means 1.5%
```

Until then, warn that naked numeric `1.5` is treated as `150%`.

## 20. Git and branch model for this project

The user initially expected to work only in `main`, but Codex/PR workflow creates additional branches.

Explain it simply:

```text
main = stable main version
origin/codex/... = remote PR branch created for agent changes
test-* = local Codespaces branch created by the user to test a PR branch
backup/* = safety copy of a known good state
```

A PR branch becomes `main` only after the PR is merged into `main` on GitHub.

Running:

```bash
git fetch
git switch test-latest
git pull --ff-only
```

updates the local test branch, but it does not automatically make `main` contain those changes.

To check current branch:

```bash
git status --short --branch
```

or:

```bash
git branch --show-current
```

To check whether main has the latest PR changes:

```bash
git switch main
git pull
git log --oneline -5
```

If the PR is merged, the relevant commit should appear in `main` history.

## 21. Backup process before risky changes

Before larger changes, create a backup branch and tag from the known working state.

Recommended commands in Codespaces:

```bash
cd /workspaces/metaEngine
git status
git branch backup/working-local-lab-YYYY-MM-DD
git tag working-local-lab-v1
git push origin backup/working-local-lab-YYYY-MM-DD
git push origin working-local-lab-v1
```

The user can view the backup on GitHub by selecting the backup branch or tag.

Do not restore with destructive commands unless the user explicitly asks. If a restore is needed, prefer explaining options first:

1. create PR from backup branch back to `main`;
2. or use reset/force-push only with explicit permission.

## 22. Recommended workflow going forward

The least confusing workflow for this user:

1. Keep `main` as the only stable working line.
2. Use PR branches only for review.
3. After PR is accepted, merge it into `main`.
4. Delete the PR branch after merge.
5. User runs from `main`:

```bash
cd /workspaces/metaEngine
git switch main
git pull
npm start
```

6. Before risky work, create backup branch/tag.

If the user asks to work directly in `main`, clarify that direct commits to `main` are possible in a local repo, but PR workflow is safer. If using PRs, explicitly tell the user when a PR must be merged before `main` has the changes.

## 23. What not to lose

Do not lose these product decisions:

- use the word `strategy`, not `return`;
- CSV upload is `timestamp,value`;
- user chooses `diff` or `accum`;
- normalize and store only `timestamp,diff`;
- missing diff = `0`;
- missing accum = previous known accum;
- first diff from accum input = `0`;
- selected period accum starts at `0`;
- presets contain weights and periods;
- same strategy can be repeated for rebalancing if periods do not overlap;
- deleted strategy in a preset contributes zero diffs;
- re-uploading a strategy with the same filename makes it active again;
- MDD is a series, not only one scalar;
- user wants simple language and exact commands after updates.

## 24. Conflict cleanup workflow

If an older PR becomes hard to merge because GitHub shows many conflicts in core files, do not ask the user to resolve those conflicts manually in the GitHub web editor.

Preferred approach:

1. Keep the current working `main` safe.
2. Preserve user data under `samples/`.
3. Create a clean PR branch from the current `main`.
4. Re-apply the intended final local-lab files in one coherent patch.
5. Run tests and syntax checks.
6. Open a new clean PR.
7. After the clean PR is merged, close the old conflicted PR.

Explain this to the user as:

```text
старый PR конфликтует;
мы не чиним его руками в GitHub;
делаем новый чистый PR поверх main;
после merge нового PR старый можно закрыть.
```

## 25. Portfolio naming and trading strategies update

CSV return files are now called `portfolios`, not `strategies`.

Use:

```text
samples/portfolios   normalized CSV portfolios
samples/presets      preset JSON files built from portfolios
samples/strategies   trading strategy JSON configs
samples/runs         calculation runs
```

The UI must use “Портфолио” for uploaded CSV return series.

The word “Стратегии” is reserved for trading rules applied on top of the already selected and calculated portfolio/preset from the calculation block.

Current trading strategies include RSI and MDD Mean Reversion.

RSI:

- type: RSI;
- RSI source: equity curve `1 + accum`;
- visible returns still display as `accum = equity - 1`, so the start is shown as `0%`;
- defaults: period `14`, upper `70`, lower `30`, baseline `50`;
- long-only trading rule: buy on a downward cross of `buyLevel` (`previous RSI > buyLevel && current RSI <= buyLevel`), sell on an upward cross of `sellLevel` (`previous RSI < sellLevel && current RSI >= sellLevel`);
- the first strategy-period point is not signalable, and repeated buy/sell signals are ignored when already in the corresponding position state;
- signal execution starts on the next point, not the same point, to avoid lookahead;
- if the strategy period goes outside the base calculation period, warn and fill missing data by the existing missing-data rule.

The strategy block is hidden by default and appears only after the user enables the “Стратегии” toggle.

Strategy calculation UX is documented in `docs/STRATEGIES.md`. In short: the strategy calculation button is disabled until block “3. Расчет” has a current base result, the disabled button explains why via tooltip, and the button shows animated “Рассчитывается...” text while the strategy is running. Timeframe handling is split: blocks 3 and 5 choose **ТФ для расчета**, while blocks 4 and 6 choose **ТФ для отображения** for summary/chart/table aggregation. Display and strategy calculation timeframes can only stay on the same timeframe or move to a larger one; MetaEngine never silently creates smaller timeframe data.

MDD Mean Reversion:

- type: `mdd_mean_reversion`;
- calculates local MDD for the current drawdown cycle and resets it when base DD returns to `0`;
- default grid: `-10% → 10%`, `-20% → 20%`, `-30% → 30%`, `-40% → 40%`, `-50% → 50%`;
- grid weights are target total weights, can exceed `100%`, and cannot be negative;
- all weight changes execute on the next point;
- after DD recovers to `0`, TP waits for base-asset movement after recovery; `TP 1%` with `10%` weight adds about `0.1%` during the TP leg;
- the MDD result table includes `Local Accum`, which starts at `0%` on DD recovery and makes the TP trigger visible when it reaches the configured TP;
- `TP 0%` closes after recovery from the next point;
- if DD returns below `0` before TP, TP waiting is cancelled and grid logic resumes.

Strategy tables and current-strategy CSV export follow the IN/OUT table convention: `IN ...` columns are input values from the base calculation, while `OUT ...` columns are the strategy result. Saved strategy configs can be applied back into block 5 with **Применить**; CSV exports the current calculated strategy result table, not saved JSON configs.

Strategy optimizer:

- lives in block “5. Стратегии” and follows the selected strategy type;
- supports RSI and MDD Mean Reversion;
- can split the selected track into multiple sequential samples before optimization;
- ranks candidates by Recovery score and shows per-sample accum/MDD/score, compounded sample accum, worst MDD and trade counts;
- supports stop: the current candidate finishes, then no new candidates are taken and current best results are shown;
- result rows can be sorted and applied back to block 5 to calculate and plot the strategy.

RSI optimizer varies `rsiPeriod`, `buyLevel` and `sellLevel`; `baseline` is not part of optimization, and UI upper/lower levels mirror sell/buy levels. MDD optimizer varies level count, DD levels, target weights and TP. MDD weights are target total position weights, not incremental buys; weights must be nondecreasing, equality is allowed, and “Макс. общий вес” limits the maximum target weight level rather than the sum of all levels.

Graph layout:

1. base portfolio/preset graph and table;
2. strategy indicator subgraph: RSI levels for RSI or DD/local MDD/grid levels for MDD Mean Reversion;
3. separate strategy-result graph and table with strategy diff/accum/HWM/DD/MDD.
## Экспорт CSV

В local lab есть отдельный блок **“Экспорт CSV”**. Кнопка открывает popup-окно в стиле кастомного date-picker.

В popup выбирается источник экспорта:

- сохраненное портфолио;
- текущий исходный результат расчета;
- текущий результат торговой стратегии.

Колонка `timestamp` / дата всегда включена и не отключается. Остальные колонки выбираются независимыми тумблерами:

- `diff`;
- `accum`;
- `hwm`;
- `dd`;
- `mdd`.

Можно экспортировать любые комбинации, например `timestamp,mdd`, `timestamp,accum` или `timestamp,diff,accum,hwm,dd,mdd`. Для текущего исходного результата и текущего результата торговой стратегии CSV собирается в браузере из уже рассчитанных строк.

Для сохраненного портфолио frontend вызывает backend endpoint с параметром `columns`, например:

```text
GET /api/portfolios/portfolio_a.csv/export?columns=timestamp,mdd
```

Сохраненные портфолио лежат как `timestamp,diff`, поэтому сервер при экспорте пересчитывает полный ряд портфолио и отдает только выбранные колонки: `accum`, `hwm`, `dd`, `mdd` строятся из сохраненного `diff`.

Имена скачиваемых файлов отражают источник и выбранные колонки, например:

```text
portfolio_timestamp_mdd.csv
base_result_timestamp_accum.csv
strategy_result_timestamp_diff_accum_mdd.csv
```
