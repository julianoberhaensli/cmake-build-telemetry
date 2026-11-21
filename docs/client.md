# Client reference – `BuildTelemetry.cmake`

Requirements for data collection: **CMake ≥ 4.3** and a **Ninja, Makefile or FASTBuild**
generator. These are CMake instrumentation limits. Anything else is harmless: one status line,
no instrumentation.

## Integration modes

### Project mode

```cmake
include(cmake/BuildTelemetry.cmake)      # anywhere in the top-level CMakeLists.txt
```

or, without editing the project:

```bash
cmake … -DCMAKE_PROJECT_TOP_LEVEL_INCLUDES=/path/to/BuildTelemetry.cmake
```

At configure time the module:

1. checks the switches, CMake version, generator and endpoint;
2. copies itself to `<build>/.cmake/build-telemetry/BuildTelemetry.cmake` and writes
   `settings.txt` there;
3. writes `<build>/.cmake/instrumentation/v1/query/build-telemetry.json`.

When telemetry is disabled (or the requirements are not met), the query file is **removed**,
so CMake stops wrapping commands on the next generate. Because that changes every compile
command line, the first build after toggling at configure time recompiles everything once.
The environment switch `BUILD_TELEMETRY=OFF` does not touch the build graph.

### Machine mode

```bash
cmake -DBUILD_TELEMETRY_URL=https://telemetry.example.com [-DBUILD_TELEMETRY_TOKEN=…] \
      [-DBUILD_TELEMETRY_DETAIL=nocommands] [-DBUILD_TELEMETRY_TAGS=team=infra] \
      -P BuildTelemetry.cmake install
cmake -P BuildTelemetry.cmake status       # what is installed, effective settings, machine id
cmake -P BuildTelemetry.cmake test         # GET /api/v1/ingest/ping with the key
cmake -P BuildTelemetry.cmake uninstall
```

`install` copies the module and a `settings.txt` to `<CMAKE_CONFIG_DIR>/build-telemetry/`. It
writes a user-level instrumentation query (data version 1.0, works on every CMake ≥ 4.3) plus
a companion query with data version 1.2 that only adds `processMetrics` and is ignored by
CMake versions that don't know it. `CMAKE_CONFIG_DIR` defaults to `%LOCALAPPDATA%\CMake`
(Windows), `~/Library/Application Support/CMake` (macOS) or `~/.config/cmake` (Linux).

The callback runs with the `cmake` that executed `install`. Re-run `install` after replacing
that CMake installation.

### Utility

```bash
cmake -P BuildTelemetry.cmake flush <build-dir>   # upload everything queued now (ignores back-off)
```

## Settings

All settings can be given as a CMake variable at configure time (`-D…`) and as an
**environment variable of the same name**. The environment wins at build time, so CI can
override or disable without reconfiguring.

| Name | Default | Description |
|---|---|---|
| `BUILD_TELEMETRY` | `ON` | Master switch. `OFF`/`0`/`FALSE`/`NO` disables. As a CMake option it removes the instrumentation; in the environment it is also checked by every callback. |
| `DO_NOT_TRACK` | – | `1` behaves like `BUILD_TELEMETRY=OFF` ([consoledonottrack.com](https://consoledonottrack.com) convention). |
| `BUILD_TELEMETRY_URL` | – | Server base URL. Resolution: CMake variable → environment → user `settings.txt` (machine mode) → default embedded in the downloaded file. |
| `BUILD_TELEMETRY_TOKEN` | – | Ingest API key, sent as `Authorization: Bearer`. Prefer the environment variable. A `-D` value is stored in the build tree's `settings.txt`. |
| `BUILD_TELEMETRY_DETAIL` | `full` | `full`: every step including command lines. `nocommands`: every step, no `command`/`stdout`/`stderr`. `summary`: only configure/generate/build-tool snippets plus per-role totals (`roleStats`). |
| `BUILD_TELEMETRY_ANONYMIZE` | `OFF` | Hash the host name, replace source/build paths with `$SRC`/`$BUILD`, implies at least `nocommands`. |
| `BUILD_TELEMETRY_USER_ID` | `hash` | `hash` (16 hex chars of a SHA-256), `plain` or `none`. |
| `BUILD_TELEMETRY_TAGS` | – | `key=value` pairs separated by commas, stored as JSON for grouping/filtering (`?tag=team:engine`). |
| `BUILD_TELEMETRY_UPLOAD` | `auto` | `auto`: inline for `ninja` (already in CMake's background daemon) and on CI; detached worker for interactive `cmake --build`. `sync`: always inline. `async`: always detached. |
| `BUILD_TELEMETRY_TIMEOUT` | `10` | Total upload timeout per request in seconds (inactivity timeout is 5 s). |
| `BUILD_TELEMETRY_TLS_VERIFY` | `ON` | Set `OFF` only for testing. |
| `BUILD_TELEMETRY_CA_FILE` | – | CA bundle for private PKI. |
| `BUILD_TELEMETRY_MAX_SPOOL` | `50` | Maximum queued bundles per build tree; older ones are dropped. Bundles older than 14 days are always dropped. |
| `BUILD_TELEMETRY_MACHINE_ID` | random | Override the persisted machine id, e.g. with the CI runner name. |
| `BUILD_TELEMETRY_DYNAMIC_SYSINFO` | `OFF` | Ask CMake to sample CPU load and memory before and after every command. Adds per-command overhead. |
| `BUILD_TELEMETRY_QUIET` | `OFF` | Suppress the configure status line. |

Standard `http_proxy`/`https_proxy`/`no_proxy` variables are honoured (libcurl).

## Files in the build tree

```
<build>/.cmake/instrumentation/v1/query/build-telemetry.json   query (project mode)
<build>/.cmake/build-telemetry/BuildTelemetry.cmake            callback copy
<build>/.cmake/build-telemetry/settings.txt                    resolved settings
<build>/.cmake/build-telemetry/spool/                          queued bundles, staging dirs, back-off state
<build>/.cmake/build-telemetry/telemetry.log                   upload log (rotated at 512 KB)
```

## Failure behaviour

| Situation | Behaviour |
|---|---|
| CMake < 3.24 | Module returns after one status line (the rest of the file is never executed). |
| CMake 3.24 – 4.2, VS/Xcode generator, no URL | One status line; query file removed; build unaffected. |
| Server down / DNS failure / TLS error | Bundle queued. Next attempt after 1, 2, 4 … 64 min. The `cmake --build` path never waits for the network. |
| Invalid key (401/403), 429, 5xx | Kept and retried with back-off. |
| Bundle rejected (400/413/415/422) | Dropped and logged in `telemetry.log`. |
| Two instrumentation queries (project + machine) | Each index is handled once (claim file plus server-side idempotency). |
| Disk | Spool capped by count (50) and age (14 days); staging uses hard links (no copies). |
