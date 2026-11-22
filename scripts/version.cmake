# One version for everything: client, server, dashboard, container image and docs.
# The source of truth is the file VERSION in the repository root.
#
#   cmake -P scripts/version.cmake              check that every place matches VERSION (CI runs this)
#   cmake -P scripts/version.cmake set 1.3.0    write 1.3.0 to VERSION and every place below
#
# The server reads VERSION at build time (server/Directory.Build.props). The client file and
# the dashboard's package.json carry a copy because they are used on their own; docs show it in
# examples. A release is the commit that sets the version, tagged v<version>; CI refuses a tag
# that does not match VERSION.
cmake_minimum_required(VERSION 3.16)

get_filename_component(root "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)

# arguments after "-P <this file>"
set(args "")
set(first 0)
math(EXPR last "${CMAKE_ARGC} - 1")
foreach(i RANGE 0 ${last})
  if(CMAKE_ARGV${i} STREQUAL "-P")
    math(EXPR first "${i} + 2")
  endif()
endforeach()
if(first GREATER 0 AND NOT first GREATER last)
  foreach(i RANGE ${first} ${last})
    list(APPEND args "${CMAKE_ARGV${i}}")
  endforeach()
endif()

# file | regex with three groups: (before)(version)(after) | how many matches it must have
set(places
  "client/BuildTelemetry.cmake|(set\\(_BT_CLIENT_VERSION \")([^\"]*)(\"\\))|1"
  "dashboard/package.json|(\n  \"version\": \")([^\"]*)(\")|1"
  "dashboard/package-lock.json|(\"name\": \"build-telemetry-dashboard\",[\r\n\t ]+\"version\": \")([^\"]*)(\")|2"
  "deploy/.env.example|(cmake-build-telemetry:)([0-9][0-9A-Za-z.+-]*)()|1"
  "deploy/docker-compose.yml|(cmake-build-telemetry:)([0-9][0-9A-Za-z.+-]*)()|1"
  "deploy/kubernetes/build-telemetry.yaml|(release tag such as :)([0-9][0-9A-Za-z.+-]*)()|1"
  "docs/bundle-format.md|(\"name\": \"BuildTelemetry.cmake\", \"version\": \")([^\"]*)(\")|1"
)

list(LENGTH args nargs)
if(nargs EQUAL 0 OR (nargs EQUAL 1 AND args STREQUAL "check"))
  set(mode check)
elseif(nargs EQUAL 2 AND "${args}" MATCHES "^set;")
  set(mode set)
  list(GET args 1 new)
  if(NOT new MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$")
    message(FATAL_ERROR "'${new}' is not a version like 1.2.0 or 1.3.0-rc.1")
  endif()
  file(WRITE "${root}/VERSION" "${new}\n")
else()
  message(FATAL_ERROR "usage: cmake -P scripts/version.cmake [check | set <version>]")
endif()

file(STRINGS "${root}/VERSION" version LIMIT_COUNT 1)
string(STRIP "${version}" version)
if(version STREQUAL "")
  message(FATAL_ERROR "VERSION is empty")
endif()

set(errors 0)
foreach(place IN LISTS places)
  string(REPLACE "|" ";" parts "${place}")
  list(GET parts 0 rel)
  list(GET parts 1 regex)
  list(GET parts 2 expected)
  file(READ "${root}/${rel}" text)
  string(REGEX MATCHALL "${regex}" found "${text}")
  list(LENGTH found count)
  if(NOT count EQUAL expected)
    message(SEND_ERROR "${rel}: expected ${expected} version reference(s), found ${count} - update scripts/version.cmake")
    math(EXPR errors "${errors} + 1")
    continue()
  endif()
  if(mode STREQUAL "set")
    string(REGEX REPLACE "${regex}" "\\1${version}\\3" text "${text}")
    file(WRITE "${root}/${rel}" "${text}")
    message(STATUS "${rel}: ${version}")
  else()
    foreach(m IN LISTS found)
      string(REGEX REPLACE "${regex}" "\\2" v "${m}")
      if(NOT v STREQUAL version)
        message(SEND_ERROR "${rel}: version ${v}, VERSION says ${version} - run: cmake -P scripts/version.cmake set ${version}")
        math(EXPR errors "${errors} + 1")
      endif()
    endforeach()
  endif()
endforeach()

if(errors GREATER 0)
  message(FATAL_ERROR "${errors} version mismatch(es)")
endif()
if(mode STREQUAL "set")
  message(STATUS "Version ${version} set everywhere. Commit, then release with: git tag v${version}; git push origin v${version}")
else()
  message(STATUS "All components are at version ${version}")
endif()
