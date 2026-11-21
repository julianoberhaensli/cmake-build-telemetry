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

# On GitHub Actions, failures also become annotations (readable without signing in).
fail() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error title=e2e::$*"; fi
  echo "FAIL: $*" >&2
  exit 1
}

echo "== server health"
curl -fsS "$BT_URL/healthz/ready" || fail "server not reachable at $BT_URL"
echo

echo "== client connectivity check"
cmake -DBUILD_TELEMETRY_URL="$BT_URL" -P "$ROOT/client/BuildTelemetry.cmake" test || fail "client connectivity check failed"

echo "== configure + build (ninja: background upload)"
cmake -S "$ROOT/samples/demo-project" -B "$WORK/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TELEMETRY_URL="$BT_URL" \
  || fail "configure of the demo project failed"
ninja -C "$WORK/build" || fail "ninja build of the demo project failed"

echo "== incremental rebuild via cmake --build (synchronous upload)"
touch "$ROOT/samples/demo-project/src/core/hashing.cpp"
BUILD_TELEMETRY_UPLOAD=sync cmake --build "$WORK/build" || fail "cmake --build failed"

echo "== disabled build must not upload"
touch "$ROOT/samples/demo-project/src/core/hashing.cpp"
BUILD_TELEMETRY=OFF cmake --build "$WORK/build" || fail "cmake --build with BUILD_TELEMETRY=OFF failed"

echo "== waiting for uploads"
n=0
for i in $(seq 1 30); do
  n=$(curl -fsS "$BT_URL/api/v1/builds?project=TelemetryDemo&kind=all&pageSize=1" | sed -E 's/.*"total":([0-9]+).*/\1/') \
    || fail "build list query failed"
  [ "$n" -ge 2 ] && break
  sleep 1
done
echo "builds stored for TelemetryDemo: $n"
if [ "$n" -ne 2 ]; then
  log="$WORK/build/.cmake/build-telemetry/telemetry.log"
  fail "expected exactly 2 builds, got $n. Client log: $(tail -n 5 "$log" 2>/dev/null | tr '\n' '|')"
fi

id=$(curl -fsS "$BT_URL/api/v1/builds?project=TelemetryDemo&kind=all&pageSize=1&sort=startedAt&dir=asc" | sed -E 's/.*"items":\[\{"id":"([^"]+)".*/\1/')
curl -fsS "$BT_URL/api/v1/builds/$id" | grep -q '"compileCount":11' || fail "first build should have compiled 11 TUs"
curl -fsS "$BT_URL/api/v1/builds/$id/steps" | grep -q '"source":"src/numeric/meta.cpp"' || fail "relative source paths expected"
echo "E2E OK"
