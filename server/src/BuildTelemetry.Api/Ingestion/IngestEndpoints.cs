using System.Text.Json;
using BuildTelemetry.Api.Options;
using BuildTelemetry.Api.Security;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;

namespace BuildTelemetry.Api.Ingestion;

public static class IngestEndpoints
{
    public const string Policy = "ingest";
    public const string RateLimitPolicy = "ingest";

    public static IEndpointRouteBuilder MapIngestEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ingest")
            .WithTags("Ingestion")
            .RequireAuthorization(Policy)
            .RequireRateLimiting(RateLimitPolicy);

        // CMake's file(UPLOAD) issues PUT; POST is accepted for other clients.
        group.MapMethods("", [HttpMethods.Put, HttpMethods.Post], IngestAsync)
            .WithName("IngestBundle")
            .WithSummary("Ingest one build-telemetry bundle (JSON, optionally Content-Encoding: gzip)")
            .Accepts<JsonElement>("application/json")
            .Produces<IngestResponse>(StatusCodes.Status202Accepted)
            .Produces<IngestResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);

        group.MapGet("/ping", (HttpContext ctx) => Results.Ok(new
            {
                ok = true,
                key = ctx.User.FindFirst(IngestKeyAuthenticationHandler.KeyNameClaim)?.Value,
                serverTime = DateTimeOffset.UtcNow,
            }))
            .WithName("IngestPing")
            .WithSummary("Connectivity and API key check used by `cmake -P BuildTelemetry.cmake test`");

        return app;
    }

    private static async Task<IResult> IngestAsync(
        HttpContext ctx,
        IngestService service,
        IOptionsSnapshot<TelemetryOptions> options,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        var ingest = options.Value.Ingest;
        if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } size)
        {
            size.MaxRequestBodySize = ingest.MaxBundleBytes;
        }

        JsonDocument doc;
        try
        {
            doc = await JsonDocument.ParseAsync(ctx.Request.Body, new JsonDocumentOptions { MaxDepth = 256 }, ct);
        }
        catch (JsonException ex)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid JSON", detail: ex.Message);
        }
        catch (InvalidDataException ex)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid content encoding", detail: ex.Message);
        }

        using (doc)
        {
            NormalizedBundle bundle;
            try
            {
                bundle = BundleNormalizer.Normalize(doc.RootElement, ingest.StoreCommands, ingest.MaxStepsPerBundle);
            }
            catch (BundleValidationException ex)
            {
                return Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["bundle"] = [ex.Message] },
                    statusCode: StatusCodes.Status422UnprocessableEntity);
            }

            bundle.Build.IngestKey = ctx.User.FindFirst(IngestKeyAuthenticationHandler.KeyNameClaim)?.Value;
            var result = await service.StoreAsync(bundle, ct);
            var body = new IngestResponse(result.Id, result.Outcome == IngestOutcome.Duplicate, result.Steps);
            if (result.Outcome == IngestOutcome.Duplicate)
            {
                loggers.CreateLogger("Ingest").LogInformation("Duplicate bundle {BundleId} ignored", result.Id);
                return Results.Ok(body);
            }

            return Results.Accepted($"/api/v1/builds/{result.Id}", body);
        }
    }

    public sealed record IngestResponse(Guid Id, bool Duplicate, int Steps);
}
