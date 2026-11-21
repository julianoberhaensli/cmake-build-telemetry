#!/usr/bin/env bash
# End-to-end test: real CMake build -> CMake instrumentation -> BuildTelemetry.cmake
# -> running server -> query API. Expects a server at $BT_URL (default
# http://127.0.0.1:8080) with ingest key $BT_KEY, and cmake >= 4.3, ninja, a C++
# compiler on PATH.
set -euo pipefail

BT_URL="${BT_URL:-http://127.0.0.1:8080}"
BT_KEY="${BT_KEY:-e2e-key}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${BT_E2E_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

export CMAKE_CONFIG_DIR="$WORK/userconfig"   # never touch the real user config
export BUILD_TELEMETRY_TOKEN="$BT_KEY"

echo "== server health"
curl -fsS "$BT_URL/healthz/ready" && echo

echo "== client connectivity check"
cmake -DBUILD_TELEMETRY_URL="$BT_URL" -P "$ROOT/client/BuildTelemetry.cmake" test

echo "== configure + build (ninja: background upload)"
cmake -S "$ROOT/samples/demo-project" -B "$WORK/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TELEMETRY_URL="$BT_URL"
ninja -C "$WORK/build"

echo "== incremental rebuild via cmake --build (synchronous upload)"
touch "$ROOT/samples/demo-project/src/core/hashing.cpp"
BUILD_TELEMETRY_UPLOAD=sync cmake --build "$WORK/build"

echo "== disabled build must not upload"
touch "$ROOT/samples/demo-project/src/core/hashing.cpp"
BUILD_TELEMETRY=OFF cmake --build "$WORK/build"

echo "== waiting for uploads"
for i in $(seq 1 30); do
  n=$(curl -fsS "$BT_URL/api/v1/builds?project=TelemetryDemo&kind=all&pageSize=1" | sed -E 's/.*"total":([0-9]+).*/\1/')
  [ "$n" -ge 2 ] && break
  sleep 1
done
echo "builds stored for TelemetryDemo: $n"
[ "$n" -eq 2 ] || { echo "expected exactly 2 builds (the disabled one must be skipped)"; exit 1; }

id=$(curl -fsS "$BT_URL/api/v1/builds?project=TelemetryDemo&kind=all&pageSize=1&sort=startedAt&dir=asc" | sed -E 's/.*"items":\[\{"id":"([^"]+)".*/\1/')
curl -fsS "$BT_URL/api/v1/builds/$id" | grep -q '"compileCount":11' || { echo "first build should have compiled 11 TUs"; exit 1; }
curl -fsS "$BT_URL/api/v1/builds/$id/steps" | grep -q '"source":"src/numeric/meta.cpp"' || { echo "relative source paths expected"; exit 1; }
echo "E2E OK"
