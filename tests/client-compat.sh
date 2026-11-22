#!/usr/bin/env bash
# The client with the cmake on PATH: project mode and machine mode must configure, build and
# collect a bundle. CI runs this with older CMake releases, because the instrumentation query
# has to be accepted by every CMake >= 4.3 (4.3.0-4.3.2 reject formats that later ones accept).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
# Windows cmake does not understand Git Bash paths (/c/...)
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
CLIENT="$(native "$ROOT/client/BuildTelemetry.cmake")"
VERSION="$(cmake --version | head -n1)"

fail() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error title=client-compat ($VERSION)::$*"; fi
  echo "FAIL: $*" >&2
  exit 1
}

# the callback runs after ninja has returned: wait for its bundle in the spool
wait_bundle() {
  for _ in $(seq 1 30); do
    [ -n "$(find "$1" -name '*.json.gz' 2>/dev/null | head -n1)" ] && return 0
    sleep 1
  done
  return 1
}

mkdir -p "$W/src"
cat > "$W/src/CMakeLists.txt" <<EOF
cmake_minimum_required(VERSION 3.20)
project(compat CXX)
if(WITH_CLIENT)
  include("$CLIENT")
endif()
add_executable(hello main.cpp)
EOF
echo 'int main() { return 0; }' > "$W/src/main.cpp"
SRC="$(native "$W/src")"
echo "$VERSION"

# project mode (unreachable server on purpose: the bundle stays in the spool)
cmake -S "$SRC" -B "$(native "$W/p")" -G Ninja -DWITH_CLIENT=ON -DBUILD_TELEMETRY_URL=http://127.0.0.1:9 > "$W/p.log" 2>&1 \
  || { cat "$W/p.log"; fail "project mode: configure failed"; }
ninja -C "$W/p" >> "$W/p.log" 2>&1 || { cat "$W/p.log"; fail "project mode: build failed"; }
wait_bundle "$W/p/.cmake/build-telemetry/spool" || { cat "$W/p.log"; fail "project mode: no bundle collected"; }
echo "project mode: ok"

# opt-in: the project defaults the option to OFF, the environment switches it on and off
# (before machine mode: its user-level query would instrument every build)
mkdir -p "$W/optin" && cp "$W/src/main.cpp" "$W/optin/"
cat > "$W/optin/CMakeLists.txt" <<EOF
cmake_minimum_required(VERSION 3.20)
project(optin CXX)
option(BUILD_TELEMETRY "Upload build telemetry" OFF)
include("$CLIENT")
add_executable(hello main.cpp)
EOF
configure_optin() { # [VAR=value ...]: reconfigure the same build tree with exactly this environment
  env -u BUILD_TELEMETRY -u DO_NOT_TRACK "$@" cmake -S "$(native "$W/optin")" -B "$(native "$W/o")" -G Ninja \
    -DBUILD_TELEMETRY_URL=http://127.0.0.1:9 >> "$W/o.log" 2>&1 || { cat "$W/o.log"; fail "opt-in: configure failed ($*)"; }
}
instrumented() { grep -q -- '--instrument' "$W/o/build.ninja"; }
configure_optin
! instrumented || fail "opt-in: instrumented without BUILD_TELEMETRY=ON"
configure_optin BUILD_TELEMETRY=ON
instrumented || fail "opt-in: BUILD_TELEMETRY=ON did not enable it"
ninja -C "$W/o" >> "$W/o.log" 2>&1 || { cat "$W/o.log"; fail "opt-in: build failed"; }
wait_bundle "$W/o/.cmake/build-telemetry/spool" || { cat "$W/o.log"; fail "opt-in: no bundle collected"; }
configure_optin BUILD_TELEMETRY=ON DO_NOT_TRACK=1
! instrumented || fail "opt-in: DO_NOT_TRACK=1 did not win over BUILD_TELEMETRY=ON"
configure_optin
! instrumented || fail "opt-in: still instrumented after BUILD_TELEMETRY was unset"
echo "opt-in: ok"

# machine mode (own CMAKE_CONFIG_DIR, project without include)
export CMAKE_CONFIG_DIR="$(native "$W/cfg")"
cmake -DBUILD_TELEMETRY_URL=http://127.0.0.1:9 -P "$CLIENT" install > "$W/m.log" 2>&1 \
  || { cat "$W/m.log"; fail "machine mode: install failed"; }
cmake -S "$SRC" -B "$(native "$W/m")" -G Ninja >> "$W/m.log" 2>&1 || { cat "$W/m.log"; fail "machine mode: configure failed"; }
ninja -C "$W/m" >> "$W/m.log" 2>&1 || { cat "$W/m.log"; fail "machine mode: build failed"; }
wait_bundle "$W/m/.cmake/build-telemetry/spool" || { cat "$W/m.log"; fail "machine mode: no bundle collected"; }
echo "machine mode: ok"
rm -rf "$W" 2>/dev/null || true  # the background uploader may still hold files
