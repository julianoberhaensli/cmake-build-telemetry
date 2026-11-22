# syntax=docker/dockerfile:1.7
# BuildTelemetry server image: ASP.NET Core API + React dashboard + CMake client download.
#
# CI publishes this image to ghcr.io/julianoberhaensli/cmake-build-telemetry
# (linux/amd64 + linux/arm64). To build it yourself:
#
#   docker build -t build-telemetry .
#   docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/build-telemetry .
#
# The image targets .NET 10 LTS. DOTNET_VERSION=9.0 also builds, but .NET 9 is out of
# support since 2026-11-10.

ARG DOTNET_VERSION=10.0
ARG NODE_VERSION=22

# The dashboard and the server are built once on the build machine's own platform: the
# SPA is static files and the server is published framework-dependent (portable IL, no
# native assets), so the same output runs on every target architecture. Only the runtime
# stage is per-platform, and it contains no RUN steps, so no emulation is needed.

# ---- dashboard (static SPA) -----------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS dashboard
WORKDIR /src/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

# ---- API ---------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS server
ARG DOTNET_VERSION
WORKDIR /src
# VERSION is the single version of client, server and dashboard (see scripts/version.cmake)
COPY VERSION ./
COPY server/Directory.Build.props server/Directory.Packages.props server/
COPY server/src/BuildTelemetry.Api/BuildTelemetry.Api.csproj server/src/BuildTelemetry.Api/
RUN dotnet restore server/src/BuildTelemetry.Api/BuildTelemetry.Api.csproj -p:BtTargetFramework=net${DOTNET_VERSION}
COPY client/ client/
COPY server/src/ server/src/
RUN dotnet publish server/src/BuildTelemetry.Api/BuildTelemetry.Api.csproj \
      -c Release -o /app --no-restore \
      -p:BtTargetFramework=net${DOTNET_VERSION} -p:UseAppHost=false
COPY --from=dashboard /src/dashboard/dist /app/wwwroot
# empty, app-owned directory for data-protection keys (the chiseled image has no shell)
RUN mkdir -p /keys

# ---- runtime: distroless-style, non-root ---------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}-noble-chiseled AS runtime
WORKDIR /app
COPY --from=server /app ./
COPY --from=server --chown=1654:1654 /keys /keys
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true \
    Logging__Console__FormatterName=json
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "BuildTelemetry.Api.dll"]
