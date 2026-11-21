using BuildTelemetry.Api.Data;
using Npgsql;
using Xunit;

namespace BuildTelemetry.Api.Tests;

public class MigrationRunnerTests
{
    private const string Configured = "Host=db;Port=5432;Database=buildtelemetry;Username=bt;Password=s3cret-pw";

    [Fact]
    public void DataSourceConnectionStringOmitsPassword()
    {
        // The reason MigrationRunner keeps its own copy of the configured connection string.
        using var dataSource = NpgsqlDataSource.Create(Configured);
        Assert.DoesNotContain("s3cret-pw", dataSource.ConnectionString);
    }

    [Fact]
    public void CreateTargetKeepsPasswordAndSwitchesToMaintenanceDatabase()
    {
        var target = MigrationRunner.CreateTarget(Configured);

        Assert.NotNull(target);
        Assert.Equal("buildtelemetry", target.Value.Database);
        var admin = new NpgsqlConnectionStringBuilder(target.Value.AdminConnectionString);
        Assert.Equal("postgres", admin.Database);
        Assert.Equal("s3cret-pw", admin.Password);
        Assert.Equal("bt", admin.Username);
        Assert.Equal("db", admin.Host);
    }

    [Fact]
    public void CreateTargetWithoutDatabaseIsNull()
    {
        Assert.Null(MigrationRunner.CreateTarget("Host=db;Username=bt;Password=x"));
    }
}
