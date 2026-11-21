# Architecture and design decisions

## 1. Data source: CMake instrumentation

CMake ≥ 4.3 ships *instrumentation* (`cmake-instrumentation(7)`). When a query file exists, the
Makefile/Ninja generators wrap every compile, link and custom command in
`ctest --instrument …`. Each command writes one *snippet* JSON file with the role, target,
source, outputs, start time, duration and exit code. With CMake 4.5 and the `processMetrics`
option, snippets also carry peak RSS and user/system CPU time. CMake *indexes* the snippets
at configured hooks, writes an index file and runs callbacks with the index path as the last
argument. After the callbacks return, CMake deletes the indexed snippets.

The client uses the **file-based query API**. It writes
`<build>/.cmake/instrumentation/v1/query/build-telemetry.json` (project mode) or
`<CMAKE_CONFIG_DIR>/instrumentation/v1/query/build-telemetry.json` (machine mode). It does not
call `cmake_instrumentation()`. Reasons:

* the command's signature changed during the experimental phase, and a wrong call is a *fatal*
  configure error, while a query file CMake does not understand is simply ignored;
* the same mechanism instruments builds without touching the project (machine mode);
* the data version is chosen per CMake version (4.3 → 1.0, 4.4 → 1.1, 4.5+ → 1.2 with
  `processMetrics`). In machine mode a second query file with data version 1.2 adds
  `processMetrics` only where CMake understands it, because queries with unknown data versions
  are ignored.

Hooks: `postBuild` (plain `ninja`/`make`) and `postCMakeBuild` (`cmake --build`). `postBuild`
does not fire under `cmake --build`, so the two never double-count.

Behaviour verified on this repository's test machine (CMake 4.4.5, Ninja 1.13, Windows):

| Observation | Consequence |
|---|---|
| `ninja` adds a `start_instrument` edge that launches a background daemon. The `postBuild` callback runs **after ninja returned** and inherits its environment. | The callback can do all work inline, with no detaching. |
| `cmake --build` runs the `postCMakeBuild` callback **synchronously** and shows its output. | The synchronous path must be tiny and silent. |
| A failing callback (`message(FATAL_ERROR)`) does **not** change the build's exit code. | Errors can never fail the build. The client still avoids them so they don't show up as noise. |
| Snippets are deleted right after the callbacks return. | The data has to be preserved before returning. |

## 2. Client (`BuildTelemetry.cmake`)

A single file with several entry points:

| Entry point | Invoked as | Work |
|---|---|---|
| project mode | `include()` / `CMAKE_PROJECT_TOP_LEVEL_INCLUDES` | checks version, generator, switches and endpoint; writes the query + `settings.txt` and copies itself to `<build>/.cmake/build-telemetry/` |
| callback | `cmake -DBT_MODE=callback -P BuildTelemetry.cmake <index>` | see below |
| worker | `cmake -DBT_MODE=worker -P …` (detached) | staged snapshots → bundles → upload queue |
| management | `cmake -P BuildTelemetry.cmake install\|uninstall\|status\|test\|flush <dir>` | machine mode, connectivity check, manual flush |

Callback algorithm:

1. Return immediately if `BUILD_TELEMETRY=OFF` / `DO_NOT_TRACK=1`, if the index holds only the
   build tool's own snippet ("no work to do"), or if this index was already claimed. Project
   and machine mode may both register a callback; the bundle id is
   `sha256(buildDir | index file name)`, so the second callback sees the claim and the server
   deduplicates as well.
2. **Inline path** (`postBuild` daemon, CI, or `BUILD_TELEMETRY_UPLOAD=sync`): build the bundle
   straight from the data directory, then process the upload queue.
3. **Interactive `cmake --build`**: hard-link every snippet into
   `spool/<id>.staging/`, write the index and a `ready` marker, start a detached worker,
   return.
4. Building a bundle: snippet file names come from a regex over the index, which is O(n).
   Iterating with `string(JSON GET … i)` would re-parse the whole index for every element, which
   is O(n²). Snippets are concatenated in chunks of 200 into a `.partial` file, because
   `string(APPEND)` on one huge string is quadratic in CMake. The file is renamed to `.json`
   and then gzip-compressed with `file(ARCHIVE_CREATE FORMAT raw)`. If compression ever fails,
   the plain `.json` stays queued and is sent without `Content-Encoding`.
5. Enrichment, all without spawning processes except one `ninja --version`: selected
   `CMakeCache.txt` entries; compiler id/version from `CMakeFiles/<ver>/CMake<LANG>Compiler.cmake`;
   git branch/commit read directly from `.git` (worktrees and packed refs handled); CI provider,
   job and URL from environment variables (GitHub, GitLab, Azure, Jenkins, Buildkite, TeamCity,
   CircleCI, Bitbucket); the real CPU model (from the registry, `/proc/cpuinfo` or `sysctl`,
   because CMake's own `processorName` mis-identifies modern CPUs, e.g. "Pentium III" for an
   i9-13900K); OS pretty name; a random machine id persisted in the user config dir.
6. Upload with `file(UPLOAD)` (HTTP PUT, `Authorization: Bearer`, gzip, TLS verification,
   timeouts). `2xx`/`409` → delete. `400/413/415/422` → drop (logged). Anything else →
   exponential back-off persisted in `spool/backoff`. A non-blocking `file(LOCK)` keeps one
   uploader per build tree.

Detaching on Windows. Every child inherits the handles of a pipe the parent's output is
captured into (IDEs, CI). `cmd /c start /b` is fast (~35 ms) but keeps such a pipe open until
the worker finishes. `Start-Process` uses ShellExecute without handle inheritance, which
releases the pipe, but costs about 0.6 s. The client uses `start /b` for small batches
(≤ 150 steps, worker lifetime ≈ upload time) and `Start-Process` for large ones. On Unix the
worker runs under `setsid`/`nohup` with its stdio redirected.

Robustness details that cost real debugging time:

* `if(off)` tests the **constant** OFF, not a variable named `off`. Variables are never called
  off/on/yes/no/y/n/true/false.
* Policy **CMP0213** (CMake 4.4, UTF-8 archive header charset) breaks
  `file(ARCHIVE_CREATE FORMAT raw)` with *"Undefined option: raw:hdrcharset"*. The module
  therefore pins its policy range to `3.24...4.3`.
* Everything after the version gate needs CMake ≥ 3.24 to parse and run. Older CMake only
  executes the first lines, prints one status line and returns.

## 3. Performance

Measured on Windows 11 with Defender real-time protection, i9-13900K, MinGW g++ 13, CMake 4.4.5:

| Scenario | Number |
|---|---|
| Reading 5 000 freshly written snippet files from CMake script | ~25 s (≈ 5 ms/file, antivirus scan on first open); ~0.4 s when already cached |
| Hard-linking 5 000 fresh snippet files | ~4.7 s (≈ 0.9 ms/file); real 408-step build: 0.3 s |
| Synchronous part of `cmake --build` callback, 408 steps | ≈ 0.3 s staging + 0.6 s detached spawn |
| `ninja` (postBuild) | 0 s added – callback runs after ninja returned |
| Bundle size, 5 000 compile steps with command lines | 3.3 MB JSON → 111 KB gzip |
| End-to-end overhead of instrumentation, `ninja`, 3 runs each | 96 heavy TUs: 34.6 s → 36.5 s (**+5–6 %**). 400 tiny TUs: 10.5 s → 12.2 s (+17 %). A no-op build: +50 ms. |
| Where that time goes | Almost entirely CMake's own `ctest --instrument` wrapper around every command (process start + snippet write, slow on Windows with antivirus). The BuildTelemetry client adds **0 s** to a `ninja` build and < 1 s to a `cmake --build` of 400 steps. Linux/macOS were not measured here; process creation is much cheaper there, so expect less. |

Server side, on a 30-day demo fleet (11 machines, 1 650 builds, ~380 k steps, embedded
PostgreSQL 17): overview/trend/build list 5–20 ms, hotspots 0.2–0.3 s, machines with speed
index 0.6 s. Ingesting a 408-step bundle takes ≈ 70 ms (binary `COPY`).

Practical consequences:

* Toggling telemetry **at configure time** (`-DBUILD_TELEMETRY=ON/OFF`) adds or removes the
  wrapper in every compile command, so the next build recompiles everything once. Disabling
  through the **environment** (`BUILD_TELEMETRY=OFF`) changes nothing in the build graph: no
  rebuild, but the wrapper cost remains.
* If the wrapper cost matters (very large Windows builds), instrument where the data is
  needed most, for example CI runners and a sample of developer machines in machine mode.

## 4. Server

* **ASP.NET Core minimal API.** Stateless, so any number of replicas run behind a load
  balancer. Embedded SQL migrations run at startup under a PostgreSQL advisory lock. The
  database is created if missing and the role is allowed to create it.
* **Ingestion** (`PUT|POST /api/v1/ingest`): named API keys (constant-time SHA-256 compare),
  per key/IP rate limit, request decompression (gzip/br), a size limit applied to the
  *decompressed* body, schema validation → `422`, idempotent by bundle id (`202` first time,
  `200 duplicate` afterwards). One transaction upserts the project and machine, inserts the
  build and bulk-loads the steps with binary `COPY`.
* **Normalization.** Paths are made relative to the project's source/build dirs, so the same
  file is comparable across machines. The timing window is the build-tool snippet; aggregates
  (counts, sums, parallelism = Σ step time / wall) are computed per build. *Full* versus
  *incremental* is classified relative to the project's largest recent build and re-evaluated
  hourly.
* **Speed index.** For each (project, source) seen on ≥ 2 machines, take the fleet median
  compile time. Every compile step becomes a ratio to that median, and a machine's index is
  `100 / median(ratio)`. This compares hardware fairly even when machines build different file
  mixes or projects.
* **Storage** – PostgreSQL 17: `projects`, `machines`, `builds` (one row per build), `build_steps`
  (one row per command, cascading delete). Retention (default 180 days) and command-line
  purging (default 30 days) run in a background service under an advisory lock.
* **Security.** Ingest keys are separate from dashboard access. The dashboard can require OIDC
  (cookie + code flow with PKCE, optional required role). Forwarded headers are supported. The
  pre-configured client download only embeds URLs that pass a strict allow-list, so Host
  header injection can't smuggle CMake code into it. Containers run chiseled, as non-root and
  read-only capable.
* **Observability.** OpenTelemetry traces and metrics (ASP.NET Core, Npgsql, runtime, and
  custom `buildtelemetry.ingest.*` counters) over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is
  set. JSON console logs. `/healthz/live` and `/healthz/ready`. OpenAPI document at
  `/openapi/v1.json` with a Scalar UI at `/api/docs`.

## 5. Dashboard

React 19 + TypeScript, Mantine 8 components, TanStack Query (caching, previous data kept
during refetch), React Router (all filters live in the URL, so every view is a shareable
link), and ECharts with canvas rendering (the timeline draws thousands of bars). The chart
palette is a validated categorical set, checked for CVD separation and contrast in light and
dark mode. Colours follow the role (compile/link/custom/configure), never the rank. Failures
use the reserved status red together with a text label. Every trend chart has a table view.

## 6. Scaling path

* Up to tens of thousands of builds per day, one PostgreSQL instance is plenty. Add read
  replicas for the dashboard if needed.
* Beyond that, partition `build_steps` by month (retention becomes `DROP PARTITION`). The
  hotspot and speed-index aggregations can be pre-computed into daily rollup tables or
  materialized views.
* Ingestion is already idempotent, so a queue (Kafka/NATS/Service Bus) can be placed in front
  of `IngestService` without changing the client.
