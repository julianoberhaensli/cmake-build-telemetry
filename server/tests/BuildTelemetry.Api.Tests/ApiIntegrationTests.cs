using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;

namespace BuildTelemetry.Api.Tests;

/// <summary>
/// End-to-end tests against a real PostgreSQL. Set BT_TEST_POSTGRES to an admin connection
/// string (a fresh database is created per run), e.g.
/// <c>Host=localhost;Port=5432;Username=postgres;Password=postgres</c>. Skipped otherwise.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    public WebApplicationFactory<Program>? Factory { get; private set; }
    public string? SkipReason { get; private set; }
    private string? _adminCs;
    private string? _db;

    public async Task InitializeAsync()
    {
        _adminCs = Environment.GetEnvironmentVariable("BT_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(_adminCs))
        {
            SkipReason = "BT_TEST_POSTGRES not set";
            return;
        }

        _db = "bt_test_" + Guid.NewGuid().ToString("N")[..12];
        await using (var conn = new NpgsqlConnection(_adminCs))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"create database {_db}", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        var cs = new NpgsqlConnectionStringBuilder(_adminCs) { Database = _db }.ConnectionString;
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Postgres", cs);
            b.UseSetting("Telemetry:Ingest:ApiKeys:ci", "secret-ci-key");
            b.UseSetting("Telemetry:Ingest:AllowAnonymous", "false");
        });

        // wait for migrations (readiness probe)
        var client = Factory.CreateClient();
        for (var i = 0; i < 100; i++)
        {
            if ((await client.GetAsync("/healthz/ready")).IsSuccessStatusCode)
            {
                return;
            }

            await Task.Delay(100);
        }

        throw new InvalidOperationException("API did not become ready");
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null)
        {
            await Factory.DisposeAsync();
        }

        if (_db is not null && _adminCs is not null)
        {
            NpgsqlConnection.ClearAllPools();
            await using var conn = new NpgsqlConnection(_adminCs);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"drop database if exists {_db} with (force)", conn);
            await cmd.ExecuteNonQueryAsync();
        }
    }
}

public class ApiIntegrationTests(ApiFixture fx) : IClassFixture<ApiFixture>
{
    private static byte[] Gzip(string text)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true))
        {
            gz.Write(Encoding.UTF8.GetBytes(text));
        }

        return ms.ToArray();
    }

    private static HttpRequestMessage Upload(string json, string? key, bool gzip = true)
    {
        var content = new ByteArrayContent(gzip ? Gzip(json) : Encoding.UTF8.GetBytes(json));
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (gzip)
        {
            content.Headers.ContentEncoding.Add("gzip");
        }

        var req = new HttpRequestMessage(HttpMethod.Put, "/api/v1/ingest") { Content = content };
        if (key is not null)
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        }

        return req;
    }

    private static string FixtureText(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));

    [Fact]
    public async Task Ingest_then_query_roundtrip()
    {
        if (fx.Factory is null)
        {
            return; // BT_TEST_POSTGRES not configured
        }

        var client = fx.Factory.CreateClient();
        var json = FixtureText("bundle-full-postCMakeBuild.json");
        var id = JsonDocument.Parse(json).RootElement.GetProperty("bundleId").GetGuid();

        // auth is enforced
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Upload(json, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Upload(json, "wrong"))).StatusCode);

        // gzip PUT exactly like CMake's file(UPLOAD)
        var created = await client.SendAsync(Upload(json, "secret-ci-key"));
        Assert.Equal(HttpStatusCode.Accepted, created.StatusCode);

        // idempotent: same bundle again is acknowledged, not duplicated
        var dup = await client.SendAsync(Upload(json, "secret-ci-key", gzip: false));
        Assert.Equal(HttpStatusCode.OK, dup.StatusCode);
        Assert.True((await dup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("duplicate").GetBoolean());

        foreach (var f in new[] { "bundle-full-postBuild.json", "bundle-nocommands-postCMakeBuild.json", "bundle-summary-postCMakeBuild.json" })
        {
            Assert.True((await client.SendAsync(Upload(FixtureText(f), "secret-ci-key"))).IsSuccessStatusCode, f);
        }

        var range = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&kind=all";
        var build = await client.GetFromJsonAsync<JsonElement>($"/api/v1/builds/{id}");
        Assert.Equal("Exp3", build.GetProperty("project").GetString());
        Assert.Equal(401, build.GetProperty("compileCount").GetInt32());
        Assert.Equal("secret-ci-key".Length > 0 ? "ci" : null, build.GetProperty("ingestKey").GetString());
        Assert.Equal(JsonValueKind.Object, build.GetProperty("systemInfo").ValueKind);

        var steps = await client.GetFromJsonAsync<JsonElement>($"/api/v1/builds/{id}/steps");
        Assert.True(steps.GetArrayLength() >= 401);
        Assert.Contains(steps.EnumerateArray(), s => s.GetProperty("lane").GetInt32() > 0);

        var step = await client.GetFromJsonAsync<JsonElement>($"/api/v1/builds/{id}/steps/{steps[5].GetProperty("seq").GetInt32()}");
        Assert.True(step.TryGetProperty("command", out _));

        var trace = await client.GetFromJsonAsync<JsonElement>($"/api/v1/builds/{id}/trace");
        Assert.True(trace.GetProperty("traceEvents").GetArrayLength() > 400);

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/v1/builds?{range}&pageSize=10");
        Assert.True(list.GetProperty("total").GetInt64() >= 3);

        var overview = await client.GetFromJsonAsync<JsonElement>($"/api/v1/overview?{range}");
        Assert.True(overview.GetProperty("builds").GetInt64() >= 3);

        var trend = await client.GetFromJsonAsync<JsonElement>($"/api/v1/trend?{range}&bucket=day");
        Assert.True(trend.GetArrayLength() >= 1);

        var machines = await client.GetFromJsonAsync<JsonElement>($"/api/v1/machines?{range}");
        Assert.True(machines.GetArrayLength() >= 1);

        var hardware = await client.GetFromJsonAsync<JsonElement>($"/api/v1/hardware?{range}");
        Assert.True(hardware.GetArrayLength() >= 1);

        var files = await client.GetFromJsonAsync<JsonElement>($"/api/v1/hotspots/files?{range}&project=Exp3&limit=5");
        Assert.Equal(5, files.GetArrayLength());

        var targets = await client.GetFromJsonAsync<JsonElement>($"/api/v1/hotspots/targets?{range}");
        Assert.True(targets.GetArrayLength() >= 1);

        var filters = await client.GetFromJsonAsync<JsonElement>("/api/v1/filters");
        Assert.Contains(filters.GetProperty("projects").EnumerateArray(), p => p.GetProperty("name").GetString() == "Exp3");

        var other = JsonDocument.Parse(FixtureText("bundle-full-postBuild.json")).RootElement.GetProperty("bundleId").GetGuid();
        var compare = await client.GetFromJsonAsync<JsonElement>($"/api/v1/compare?a={id}&b={other}");
        Assert.True(compare.GetProperty("files").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Invalid_payloads_are_rejected_cleanly()
    {
        if (fx.Factory is null)
        {
            return;
        }

        var client = fx.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Upload("{not json", "secret-ci-key", gzip: false))).StatusCode);
        Assert.Equal((HttpStatusCode)422, (await client.SendAsync(Upload("""{"schema":"x"}""", "secret-ci-key"))).StatusCode);

        var ping = new HttpRequestMessage(HttpMethod.Get, "/api/v1/ingest/ping");
        ping.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "secret-ci-key");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(ping)).StatusCode);
    }

    [Fact]
    public async Task MaxBundleBytes_limits_the_decompressed_body_with_413()
    {
        if (fx.Factory is null)
        {
            return;
        }

        // 296 KB of JSON, 14 KB on the wire: only the decompressed size is over the limit.
        // The decompression middleware used to apply the server default here (Kestrel: 30 MB),
        // so real bundles above that failed with 500 even below MaxBundleBytes.
        await using var limited = fx.Factory.WithWebHostBuilder(b => b.UseSetting("Telemetry:Ingest:MaxBundleBytes", "100000"));
        var client = limited.CreateClient();
        var json = FixtureText("bundle-full-postBuild.json");
        var tooLarge = await client.SendAsync(Upload(json, "secret-ci-key"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooLarge.StatusCode);

        // the same bundle within the limit: accepted (202, or 200 if another test stored it first)
        await using var roomy = fx.Factory.WithWebHostBuilder(b => b.UseSetting("Telemetry:Ingest:MaxBundleBytes", "400000"));
        var ok = await roomy.CreateClient().SendAsync(Upload(json, "secret-ci-key"));
        Assert.True(ok.IsSuccessStatusCode, ok.StatusCode.ToString());
    }

    [Fact]
    public async Task Client_download_is_preconfigured_with_server_url()
    {
        if (fx.Factory is null)
        {
            return;
        }

        var client = fx.Factory.CreateClient();
        var text = await client.GetStringAsync("/api/v1/client/BuildTelemetry.cmake");
        Assert.Contains("set(_BT_DEFAULT_URL \"http://localhost\")", text);
        Assert.Contains("_bt_project_main", text);
    }
}
