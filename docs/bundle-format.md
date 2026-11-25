# Bundle format `build-telemetry/bundle@1`

One bundle = one CMake instrumentation index (one build invocation). It is sent as
`PUT /api/v1/ingest` with `Content-Type: application/json` and usually
`Content-Encoding: gzip`. Other producers (custom CI tooling, other build systems) can send
the same document.

```jsonc
{
  "schema": "build-telemetry/bundle@1",               // required
  "bundleId": "640052d0-30f3-fcdb-9eba-d2cedd70c651",  // required, UUID; idempotency key
  "createdAt": "2026-11-21T10:37:53Z",
  "hook": "postBuild",                                 // postBuild | postCMakeBuild | manual
  "dataVersion": { "major": 1, "minor": 1 },           // CMake instrumentation data version
  "client":  { "name": "BuildTelemetry.cmake", "version": "1.3.0", "mode": "project", "detail": "full", "anonymized": false },
  "machine": { "id": "5f3c…", "hostname": "ws-17", "user": "b9dc08f012df6261", "cpuModel": "AMD Ryzen 9 7950X 16-Core Processor", "osPrettyName": "Ubuntu 24.04.3 LTS" },
  "system":  { /* CMake staticSystemInformation verbatim: OSName, OSRelease, numberOfLogicalCPU, totalPhysicalMemory, … */ },
  "project": { "name": "atlas-engine", "sourceDir": "/home/dev/atlas", "buildDir": "/home/dev/atlas/build" },
  "build": {
    "generator": "Ninja", "buildTool": "1.13.1", "buildType": "Release", "configurationTypes": null,
    "cmakeVersion": "4.5.1", "compilerLauncher": "ccache", "linkerType": null, "toolchainFile": null,
    "unityBuild": null, "ipo": null,
    "compilers": { "CXX": { "id": "GNU", "version": "14.2.0", "frontendVariant": "GNU", "architecture": "x86_64",
                            "linkerId": null, "linkerVersion": null, "executable": "g++" }, "C": null }
  },
  "vcs":  { "branch": "main", "commit": "3f2c…" },
  "ci":   { "isCI": true, "provider": "github", "url": "https://github.com/…/actions/runs/1", "job": "ci/build", "runner": "runner-3" },
  "tags": { "team": "engine" },
  "snippets": [ /* CMake instrumentation snippet objects, verbatim (minus stripped fields) */ ],
  "roleStats": { "compile": { "count": 401, "durationMs": 123456, "failed": 0 } },   // only with detail=summary
  "content": [ { "file": "content/cmake-….json", "data": { "project": "…", "targets": { "core": { "type": "STATIC_LIBRARY", "labels": [] } } } } ]
}
```

Snippet fields used by the server (from `cmake-instrumentation(7)`): `role`, `timeStart` (ms
since epoch), `duration` (ms), `result`, `target`, `source`, `outputs`, `outputSizes`,
`language`, `config`, `command` and `processMetrics.{maxRSS,userTime,systemTime}`. Unknown
fields are ignored, so newer CMake data versions are forward compatible.

Server responses:

| Status | Meaning |
|---|---|
| `202 Accepted` | Stored. Body `{ "id", "duplicate": false, "steps" }`. |
| `200 OK` | Bundle id already stored (`duplicate: true`). The client treats it as success. |
| `400` | Not JSON / broken gzip. |
| `401` | Missing or invalid API key. |
| `413` | Larger than `MaxBundleBytes` (decompressed). |
| `422` | Wrong schema or missing/invalid `bundleId`; validation problem details. |
| `429` | Rate limited; the client backs off. |
