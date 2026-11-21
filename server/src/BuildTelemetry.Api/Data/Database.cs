using Dapper;
using Npgsql;

namespace BuildTelemetry.Api.Data;

public static class DatabaseServiceCollectionExtensions
{
    public static IServiceCollection AddTelemetryDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.AddTypeHandler(new DateTimeOffsetHandler());

        var connectionString = configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException(
                "Connection string 'ConnectionStrings:Postgres' is not configured " +
                "(environment variable ConnectionStrings__Postgres).");

        var csb = new NpgsqlConnectionStringBuilder(connectionString);
        csb.Timezone ??= "UTC";
        if (string.IsNullOrEmpty(csb.ApplicationName))
        {
            csb.ApplicationName = "build-telemetry";
        }

        services.AddSingleton(_ =>
        {
            var builder = new NpgsqlDataSourceBuilder(csb.ConnectionString);
            return builder.Build();
        });
        services.AddSingleton(new DatabaseConnectionString(csb.ConnectionString));
        services.AddSingleton<MigrationRunner>();
        services.AddSingleton<DatabaseReadiness>();
        services.AddHostedService<DatabaseInitializer>();
        return services;
    }
}

/// <summary>Npgsql returns timestamptz as UTC DateTime; expose it as DateTimeOffset.</summary>
internal sealed class DateTimeOffsetHandler : SqlMapper.TypeHandler<DateTimeOffset>
{
    public override void SetValue(System.Data.IDbDataParameter parameter, DateTimeOffset value)
        => parameter.Value = value.UtcDateTime;

    public override DateTimeOffset Parse(object value) => value switch
    {
        DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
        DateTimeOffset dto => dto,
        _ => throw new InvalidCastException($"Cannot convert {value.GetType()} to DateTimeOffset"),
    };
}
