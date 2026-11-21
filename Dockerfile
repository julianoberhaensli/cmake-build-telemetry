# syntax=docker/dockerfile:1.7
# BuildTelemetry server image: ASP.NET Core API + React dashboard + CMake client download.
#
#   docker build -t build-telemetry .
#   docker build --build-arg DOTNET_VERSION=10.0 -t build-telemetry .   # .NET 10 LTS (recommended)
#
# .NET 9 is the verified default of this repository; it reached end of support on
# 2026-11-10, so production images should be built with DOTNET_VERSION=10.0.

ARG DOTNET_VERSION=9.0
ARG NODE_VERSION=22

# ---- dashboard (static SPA) -----------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS dashboard
WORKDIR /src/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

# ---- API ---------------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS server
ARG DOTNET_VERSION
WORKDIR /src
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
