# Production UI

P4 adds a separate production client in `src/MetaEngine.Web`. It is a React +
TypeScript application built with TanStack Router, Tailwind and shadcn/ui. The
existing Node.js local lab remains available on port `5173`; this client is the
user interface for the ASP.NET Core / PostgreSQL production workflow.

## Available workflow

After signing in, the user can:

1. select an accessible workspace;
2. use **Data** to import two-column portfolio CSV with or without header, choose whether the second column is `Accum` or `Diff`, and inspect all saved portfolio, strategy and preset versions;
3. choose a portfolio or preset directly in **Calculations**;
4. set an exact calculation period and an allowed target timeframe;
5. queue a base calculation;
6. follow `queued`, `running`, `completed`, `failed` or `interrupted` status in
   the five most recent runs, retry a failed/interrupted run when appropriate,
   and open the full history when needed;
7. open a completed result under its source/type title, inspect summary metrics
   and explore the equity/drawdown chart with the mouse range brush;
8. open the point table only when needed and continue loading rows in batches;
9. select a completed base run, calculate RSI or MDD Mean Reversion, and save
   the resulting strategy configuration.
10. optimize RSI or MDD Mean Reversion across several sequential samples,
    follow, stop or retry the job, compare sortable top results and queue one
    configuration as a normal strategy run before saving it.
11. create a preset from portfolio and saved-strategy sources, then select that
   preset as the source for a base calculation.
12. compare up to five portfolio, saved-strategy or completed-run series in one
   chart; each series starts at 0% on its own first point.

The first accessible workspace is selected automatically. The production API
uses `workspaces[].id` and `workspaces[].name`; all portfolio and calculation
requests use that immutable workspace id. An account without a workspace sees
an explicit access message instead of a perpetual loading state.

The forms fill source start/end automatically. The user may narrow the period.
A `Viewer` can inspect data but does not get active import or calculation
controls.

## Client boundaries

The UI supports RSI and MDD Mean Reversion optimization. Retry actions are
available for failed or interrupted calculation and optimization jobs. User
management and CSV export remain future work or are governed by their API and
domain contracts.

The result API stores canonical `timestamp,diff`. The client derives `accum`,
HWM and drawdown for display. It loads all result pages, then down-samples only
the rendered chart so a long series remains responsive; the summary always
comes from the saved calculation run. The current-result chart has independent
drawdown and accumulated-return axes. The comparison chart can overlay up to
five series and optionally their drawdowns; all axes are displayed as
percentages.

## Authentication and local development

The browser requests `/api/...` on its own origin. Vite proxies that path to
`http://localhost:5080` by default, or to `VITE_API_TARGET` when supplied.
This keeps the existing HttpOnly auth cookie and CSRF model intact during local
development; no permissive CORS policy is added to the API.

For a deployed UI, the reverse proxy must serve the built client and API under
the same public origin, or production CORS/cookie policy must be designed and
reviewed as a dedicated security change.

## Local run

Apply migrations and start PostgreSQL first. Then use three terminals:

```bash
# terminal 1: API
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080

# terminal 2: Worker
dotnet run --project src/MetaEngine.Worker

# terminal 3: production UI
cd src/MetaEngine.Web
npm install
npm run dev
```

Open port `3000` in Codespaces. The Worker must be running for a calculation to
progress beyond `queued`.

## Verification

```bash
cd src/MetaEngine.Web
npx tsc --noEmit
npm test
npm run build
```

The root Node reference suite and the .NET solution remain separate checks:

```bash
npm test
dotnet test MetaEngine.slnx
```
