# Production Compose deployment

The root `compose.yml` provides the first production-like deployment shape for
MetaEngine. It runs one PostgreSQL service, a one-time migration container, one
API container and a configurable number of Worker containers.

This is separate from the local lab (`npm start`) and from the three-process
development workflow in `docs/PRODUCTION_UI.md`.

## Services

- `postgres` persists the database in the named `metaengine-postgres` volume.
- `migrations` uses the API image with `--migrate`, applies pending EF Core
  migrations, then exits successfully. The API itself never migrates at start.
- `api` starts on container port `8080` and is published only to local server
  port `API_PORT` (default `5080`).
- `worker` has no public port. Compose starts the requested number of identical
  replicas against the same PostgreSQL queue.

The lease claim rules in `docs/QUEUE_RELIABILITY.md` ensure that two Worker
replicas do not execute the same queued task.

## Configuration

Copy `.env.example` to `.env` on the server and replace all development
passwords before the first start. Do not put the server `.env` in Git.

```text
POSTGRES_DB=metaengine
POSTGRES_USER=metaengine
POSTGRES_PASSWORD=replace-with-a-secret
POSTGRES_PORT=5432
API_PORT=5080
METAENGINE_ENVIRONMENT=Development
METAENGINE_WORKER_REPLICAS=2
METAENGINE_WORKER_CPU_LIMIT=1.0
METAENGINE_WORKER_MEMORY_LIMIT=2G
```

`METAENGINE_WORKER_REPLICAS` defaults to `2`. CPU and memory limits apply to
each Worker replica. Increase replicas only after checking that the server has
enough total CPU and RAM for every Worker plus PostgreSQL and API.

`METAENGINE_ENVIRONMENT=Development` makes the Compose setup usable for local
and staging checks without a TLS certificate. Before an internet-facing launch,
set it to `Production` and provide the Data Protection PFX through a private
Compose override that is not committed to Git:

```yaml
services:
  api:
    environment:
      ASPNETCORE_ENVIRONMENT: Production
      MetaEngine__DataProtection__CertificatePath: /run/secrets/metaengine-dp.pfx
      MetaEngine__DataProtection__CertificatePassword: ${METAENGINE_DATA_PROTECTION_CERTIFICATE_PASSWORD}
    volumes:
      - /secure/metaengine/metaengine-dp.pfx:/run/secrets/metaengine-dp.pfx:ro
```

The separate `migrations` service does not load authentication or need the PFX.

## Start and verify

On a Linux host with Docker Compose v2:

```bash
cd /path/to/metaEngine
cp -n .env.example .env
# Edit .env and set a real database password.
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5080/health/ready
docker compose logs --tail=100 worker
```

`migrations` should show `exited (0)`. `api` should be running and
`/health/ready` should return `status: ready`. There should be two `worker`
containers by default. Worker logs are JSON and include `workerId`, which makes
the container handling a task visible.

To change capacity, edit `METAENGINE_WORKER_REPLICAS`,
`METAENGINE_WORKER_CPU_LIMIT` or `METAENGINE_WORKER_MEMORY_LIMIT` in `.env`,
then apply the new shape:

```bash
docker compose up -d --build
docker compose ps
```

To inspect all Worker logs while an optimization runs:

```bash
docker compose logs --follow worker
```

## First owner and UI

After migrations complete, bootstrap the initial owner once:

```bash
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD; echo
docker compose run --rm --no-deps \
  -e MetaEngine__BootstrapAdmin__Email="$ADMIN_EMAIL" \
  -e MetaEngine__BootstrapAdmin__Password="$ADMIN_PASSWORD" \
  api --bootstrap-admin
unset ADMIN_EMAIL ADMIN_PASSWORD
```

The password policy and full authentication rules are documented in
`docs/PRODUCTION_AUTH.md`.

The current production web client is deployed separately from this Compose
stack. During development it still runs with Vite on port `3000` and proxies
its API requests to port `5080`.

## Scope and next operations

This Compose setup establishes reproducible API/Worker images and parallel
Worker capacity. It does not yet provide TLS, reverse proxy, backups, alerts,
centralized metrics or a web-client container. Those remain production release
work and must be completed before public deployment.
