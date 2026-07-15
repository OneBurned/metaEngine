# MetaEngine Web

Production browser client for MetaEngine. It uses React, TypeScript, TanStack
Router, Tailwind and shadcn/ui, while the API and calculations remain in the
ASP.NET Core services.

## Run locally

The API and Worker must already be running from the repository root:

```bash
dotnet run --project src/MetaEngine.Api --urls http://0.0.0.0:5080
dotnet run --project src/MetaEngine.Worker
```

In a third terminal, from this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Vite proxies `/api` to `http://localhost:5080`.
Set `VITE_API_TARGET` when the API uses a different local address.

## Checks

```bash
npx tsc --noEmit
npm test
npm run build
```

See `docs/PRODUCTION_UI.md` in the repository root for supported workflows and
deployment boundaries.
