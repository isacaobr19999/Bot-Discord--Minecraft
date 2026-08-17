package br.com.minecraftdiscord.plugin;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

final class BackendClient {
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Gson gson = new Gson();
    private final String baseUrl;
    private final String apiKey;

    BackendClient(String baseUrl, String apiKey) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.apiKey = apiKey;
    }

    CompletableFuture<HttpResponse<String>> postEvent(String type, String origin, Map<String, Object> payload) {
        Map<String, Object> event = Map.of("id", UUID.randomUUID().toString(), "idempotencyKey", UUID.randomUUID().toString(), "type", type, "origin", origin, "version", 1, "occurredAt", java.time.Instant.now().toString(), "payload", payload);
        return sendPost("/api/integration/events", gson.toJson(event), response -> {
            if (response.statusCode() >= 300) System.err.println("[MinecraftDiscord] Event " + type + " rejected: " + response.statusCode());
        });
    }

    CompletableFuture<LinkCodeResponse> createLinkCode(UUID uuid, String username) {
        Map<String, Object> body = Map.of("uuid", uuid.toString(), "username", username, "target", "discord");
        return sendPost("/api/integration/link-codes", gson.toJson(body), response -> {}).thenApply(response -> {
            if (response.statusCode() != 201) throw new IllegalStateException("Backend rejected link code: " + response.statusCode());
            return gson.fromJson(response.body(), LinkCodeResponse.class);
        });
    }

    CompletableFuture<PendingCommandsResponse> getPendingCommands(String serverKey) {
        return sendGet("/api/integration/admin/commands/pending?serverKey=" + serverKey).thenApply(response -> {
            if (response.statusCode() >= 300) throw new IllegalStateException("Backend rejected command polling: " + response.statusCode());
            return gson.fromJson(response.body(), PendingCommandsResponse.class);
        });
    }

    CompletableFuture<Void> reportCommandResult(String eventId, boolean success, String message) {
        return sendPost("/api/integration/admin/commands/result", gson.toJson(Map.of("eventId", eventId, "success", success, "message", message == null ? "" : message)), response -> {}).thenApply(response -> null);
    }

    private CompletableFuture<HttpResponse<String>> sendGet(String path) {
        HttpRequest request = HttpRequest.newBuilder().uri(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(5)).header("x-integration-key", apiKey).GET().build();
        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).whenComplete((response, error) -> logError(error));
    }

    private CompletableFuture<HttpResponse<String>> sendPost(String path, String body, Consumer<HttpResponse<String>> observer) {
        HttpRequest request = HttpRequest.newBuilder().uri(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(5)).header("content-type", "application/json").header("x-integration-key", apiKey).POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).whenComplete((response, error) -> {
            if (error != null) logError(error); else observer.accept(response);
        });
    }

    private void logError(Throwable error) {
        if (error != null) System.err.println("[MinecraftDiscord] Backend unavailable: " + error.getMessage());
    }

    record LinkCodeResponse(boolean created, String code, String expiresAt) {}
    record PendingCommandsResponse(List<PendingCommand> commands) {}
    record PendingCommand(String id, String type, JsonObject payload) {}
}
