# Server and operations

One container image: ASP.NET Core API + static dashboard + the downloadable CMake client.
State lives only in PostgreSQL (≥ 14; tested with 17).

## Configuration

Standard ASP.NET Core configuration: `appsettings.json`, then environment variables. Nested keys
use `__`, e.g. `Telemetry__Ingest__ApiKeys__ci`.

| Key | Default | Description |
|---|---|---|
| `ConnectionStrings__Postgres` | – (required) | Npgsql connection string. The database is created on first start when the role may create databases. |
| `Telemetry__PublicUrl` | request host | URL embedded in `/api/v1/client/BuildTelemetry.cmake` and shown on the setup page. Set it behind proxies. |
| `Telemetry__TrustAllProxies` | `false` | Accept `X-Forwarded-*` from any proxy (containers behind an ingress). |
| `Telemetry__Ingest__ApiKeys__<name>` | – | One or more named ingest keys. The name is stored with every build (`ingestKey`). |
| `Telemetry__Ingest__AllowAnonymous` | `true` | Only relevant when no key is configured. The Compose and Kubernetes files set `false`. |
| `Telemetry__Ingest__MaxBundleBytes` | 128 MiB | Limit on the decompressed request body. |
| `Telemetry__Ingest__MaxStepsPerBundle` | 250 000 | |
| `Telemetry__Ingest__RateLimitPerMinute` | 600 | Per key + client IP. |
| `Telemetry__Ingest__StoreCommands` | `true` | `false` drops command lines server-side regardless of the client detail level. |
| `Telemetry__Retention__Days` | 180 | Builds older than this are deleted (`0` = keep). |
| `Telemetry__Retention__CommandDays` | 30 | Command lines are cleared after this many days (`0` = keep). |
| `Telemetry__Auth__Mode` | `None` | `Oidc` protects dashboard and query API with OpenID Connect (code flow + PKCE). |
| `Telemetry__Auth__Authority` / `ClientId` / `ClientSecret` | – | OIDC provider settings. Redirect URI: `<PublicUrl>/signin-oidc`. |
| `Telemetry__Auth__RequiredRole` | – | Optional role required to see the dashboard (claim type `Telemetry__Auth__RoleClaimType`, default `roles`). |
| `Telemetry__DataProtectionKeysPath` | – | Shared directory for cookie encryption keys (multiple replicas with OIDC). |
| `Telemetry__Demo__Seed` | `false` | Seed 30 days of synthetic fleet data into an empty database. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | – | Enables OpenTelemetry traces + metrics export. |

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `PUT/POST /api/v1/ingest` | ingest key | Upload one bundle (`Content-Encoding: gzip` optional). `202` created, `200` duplicate, `401`, `413`, `422`, `429`. |
| `GET /api/v1/ingest/ping` | ingest key | Connectivity check (`cmake -P BuildTelemetry.cmake test`). |
| `GET /api/v1/overview, /trend, /builds, /builds/{id}, /builds/{id}/steps, /builds/{id}/steps/{seq}, /builds/{id}/trace, /compare, /machines, /machines/{id}, /hardware, /hotspots/files, /hotspots/targets, /filters` | dashboard | Analytics. Common filters: `from, to, project, machine, branch, ci, kind, buildType, compiler, success, tag=key:value`. |
| `GET /api/v1/client/BuildTelemetry.cmake`, `/api/v1/client/info` | public | Pre-configured client, onboarding facts. |
| `GET /healthz/live`, `/healthz/ready` | public | Probes (ready = migrations applied and DB reachable). |
| `GET /openapi/v1.json`, `/api/docs` | public | OpenAPI document and reference UI. |

`/api/v1/builds/{id}/trace` returns Chrome trace JSON. Open it in
[ui.perfetto.dev](https://ui.perfetto.dev) or `chrome://tracing`.

## Deployment

**Image**: CI publishes `ghcr.io/julianoberhaensli/cmake-build-telemetry` for linux/amd64 and
linux/arm64 after all tests pass, including an end-to-end run against the built image itself.

| Tag | Points to |
|---|---|
| `latest` | newest commit on `main` |
| `sha-<commit>` | one exact commit |
| `1.2.3`, `1.2` | git tag `v1.2.3` |

Pin `sha-…` or a release tag in production. Build it yourself with `docker build -t build-telemetry .`
(`--build-arg DOTNET_VERSION=9.0` for .NET 9; the default is .NET 10 LTS). In a fork, the
first publish creates a *private* GHCR package. Make it public once under
*Package settings → Change visibility* so servers can pull it without logging in.

**Docker Compose** (single host): `deploy/docker-compose.yml` pulls the image, so a server only
needs that file and an `.env` (see the README quick start). `deploy/docker-compose.build.yml`
builds from source instead. Updating: `docker compose pull && docker compose up -d`; migrations
run on start. PostgreSQL data lives in the `pgdata` volume. Back it up with
`docker compose exec db pg_dump -U buildtelemetry buildtelemetry > backup.sql`.

**Kubernetes**: `deploy/kubernetes/build-telemetry.yaml` (Deployment with probes, restricted
security context, read-only root filesystem, Service, Ingress). Use a managed PostgreSQL. The
API is stateless, so scale replicas freely. With OIDC and several replicas, share
`DataProtectionKeysPath` (RWX volume) or enable sticky sessions.

**TLS** terminates at the ingress or reverse proxy. Set `Telemetry__PublicUrl` to the external
https URL.

**Request size behind a proxy.** Bundles are gzip-compressed on the wire: a build of 10 000
steps with command lines is about 2–3 MB compressed and 40–50 MB decompressed. The server limit
(`MaxBundleBytes`, 128 MiB) applies to the decompressed body. A reverse proxy limits the
compressed one. Set it to at least 64 MB: nginx `client_max_body_size 64m;` (default 1 MB).
The Kubernetes Ingress in this repository already sets `proxy-body-size: 64m`.

## Operations

* Database migrations run automatically at start (advisory-locked, safe with many replicas).
* Housekeeping runs hourly: retention, command purge, re-classification of full and
  incremental builds.
* Metrics (OTLP): `buildtelemetry.ingest.bundles`, `.steps`, `.duplicates`,
  `.store.duration`, plus ASP.NET Core and runtime metrics.
* Logs: JSON to stdout in containers. Every stored build is logged with its id, project,
  machine, kind, step count and wall time.
* Rotating an ingest key: add the new key under a new name, roll the clients, then remove the
  old one.
