# Demo project used to exercise BuildTelemetry end to end.
# Note the deliberately old minimum version: the module must never break it.
cmake_minimum_required(VERSION 3.16)
project(TelemetryDemo LANGUAGES CXX)

# --- the only line a project needs -------------------------------------------
include(${CMAKE_CURRENT_LIST_DIR}/../../client/BuildTelemetry.cmake)
# ------------------------------------------------------------------------------

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(core STATIC src/core/strings.cpp src/core/hashing.cpp src/core/config.cpp)
target_include_directories(core PUBLIC src)

add_library(text STATIC src/text/regex_rules.cpp src/text/tokenizer.cpp src/text/formatter.cpp)
target_link_libraries(text PUBLIC core)

add_library(numeric STATIC src/numeric/matrix.cpp src/numeric/stats.cpp src/numeric/meta.cpp)
target_link_libraries(numeric PUBLIC core)

add_executable(demo_cli apps/cli.cpp)
target_link_libraries(demo_cli PRIVATE text numeric)

add_executable(demo_bench apps/bench.cpp)
target_link_libraries(demo_bench PRIVATE numeric)
