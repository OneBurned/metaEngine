# Agent handoff: MetaEngine local lab

This document is written for a future AI agent that receives the repository with little or no chat history. It explains the current local prototype, product decisions, exact behavior, git workflow expectations, and safe backup/restore practices.

## 1. Current project state

MetaEngine is currently a **local file-based calculation lab** for validating strategy CSV import, presets, rebalancing, and basic time-series calculations before building the production backend.

The current implementation is intentionally small:

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

The Node.js local lab exists because the immediate goal is to let the user manually validate CSV data, preset behavior, and calculation formulas quickly.

## 2. User communication rules

The user is not a coder. Communicate simply.

Do not say only “pull latest” or “update branch”. Give exact commands.

Preferred format after any code update:

```bash
cd /workspaces/metaEngine
# stop server with Ctrl+C if it is running
git switch <branch>
git pull --ff-only
npm start
```

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
lib/calculations.js               Calculation and CSV normalization logic
public/index.html                 Browser UI markup
public/app.js                     Browser UI behavior
public/styles.css                 Browser UI styling
test/calculations.test.js         Unit tests for calculations
README.md                         Human-facing usage docs
docs/agent-handoff-local-lab.md   This AI-agent handoff document
samples/strategies                Uploaded normalized strategy CSV files
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
```

Use syntax checks:

```bash
node --check server.js && node --check public/app.js && node --check lib/calculations.js
```

Current tests cover:

- timestamp parsing and formatting;
- CSV normalization;
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

Current first trading strategy:

- type: RSI;
- RSI source: equity curve `1 + accum`;
- visible returns still display as `accum = equity - 1`, so the start is shown as `0%`;
- defaults: period `14`, upper `70`, lower `30`, baseline `50`;
- trading rule: `RSI <= buyLevel` buys, `RSI >= sellLevel` sells;
- repeated buy/sell signals are ignored when already in the corresponding position state;
- signal affects the next point, not the same point, to avoid lookahead;
- if the strategy period goes outside the base calculation period, warn and fill missing data by the existing missing-data rule.

The strategy block is hidden by default and appears only after the user enables the “Стратегии” toggle.

Graph layout:

1. base portfolio/preset graph and table;
2. RSI subgraph with level lines when RSI strategy overlay is enabled;
3. separate strategy-result graph and table with strategy diff/accum/HWM/DD/MDD.
