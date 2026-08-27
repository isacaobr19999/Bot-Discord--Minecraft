package br.com.minecraftdiscord.plugin;

import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.PluginCommand;
import org.bukkit.entity.Player;
import org.bukkit.Statistic;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class MinecraftDiscordPlugin extends JavaPlugin implements Listener {
    private BackendClient backendClient;
    private String serverKey;
    private long startedAt;
    private OptionalIntegrations optionalIntegrations;
    private final Set<String> inFlightCommands = ConcurrentHashMap.newKeySet();
    private final Map<UUID, String> recentChatMessages = new ConcurrentHashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.startedAt = System.currentTimeMillis();
        this.serverKey = getConfig().getString("server-key", "primary");
        String backendUrl = getConfig().getString("backend-url", "http://localhost:3000");
        String apiKey = getConfig().getString("integration-api-key", "");
        this.backendClient = new BackendClient(backendUrl, apiKey);
        this.optionalIntegrations = OptionalIntegrations.detect(Bukkit.getPluginManager());
        this.optionalIntegrations.logTo(this);

        Bukkit.getPluginManager().registerEvents(this, this);
        PluginCommand discordCommand = Objects.requireNonNull(getCommand("discord"), "discord command missing from plugin.yml");
        discordCommand.setExecutor(new DiscordCommand(this));
        discordCommand.setTabCompleter(new DiscordCommand(this));

        Bukkit.getScheduler().runTaskTimer(this, this::sendHeartbeat, 20L, 20L * 60L);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollAdminCommands, 40L, 20L * 10L);
        getLogger().info("Minecraft Discord Platform enabled for server " + serverKey);
    }

    @Override
    public void onDisable() {
        getLogger().info("Minecraft Discord Platform disabled");
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Map<String, Object> payload = new HashMap<>(Map.of(
                "serverKey", serverKey,
                "uuid", player.getUniqueId().toString(),
                "username", player.getName()
        ));
        optionalIntegrations.resolvePrimaryGroupAsync(player).whenComplete((rank, error) -> {
            if (error != null) {
                getLogger().warning("LuckPerms group lookup failed for " + player.getName() + ": " + error.getMessage());
            } else if (rank != null) {
                getLogger().info("LuckPerms group resolved for " + player.getName() + ": " + rank);
                payload.put("rank", rank);
            } else {
                getLogger().warning("LuckPerms group unresolved for " + player.getName());
            }
            backendClient.postEvent("player.joined", "minecraft", payload);
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        backendClient.postEvent("player.left", "minecraft", Map.of(
                "serverKey", serverKey,
                "uuid", player.getUniqueId().toString(),
                "username", player.getName()
        ));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onChat(AsyncChatEvent event) {
        publishChat(event.getPlayer(), PlainTextComponentSerializer.plainText().serialize(event.message()));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    @SuppressWarnings("deprecation")
    public void onLegacyChat(AsyncPlayerChatEvent event) {
        publishChat(event.getPlayer(), event.getMessage());
    }

    private void publishChat(Player player, String message) {
        String fingerprint = message + "@" + System.currentTimeMillis() / 2000;
        if (fingerprint.equals(recentChatMessages.put(player.getUniqueId(), fingerprint))) return;
        getLogger().info("Chat bridge event queued: " + player.getName());
        backendClient.postEvent("chat.minecraft", "minecraft", Map.of(
                "serverKey", serverKey,
                "uuid", player.getUniqueId().toString(),
                "username", player.getName(),
                "message", message,
                "bridgeOrigin", "minecraft"
        )).whenComplete((response, error) -> {
            if (error != null) {
                getLogger().warning("Chat bridge event failed: " + error.getMessage());
            } else if (response.statusCode() >= 300) {
                getLogger().warning("Chat bridge event rejected: HTTP " + response.statusCode());
            } else {
                getLogger().info("Chat bridge event accepted: HTTP " + response.statusCode());
            }
        });
    }

    private void sendHeartbeat() {
        int online = Bukkit.getOnlinePlayers().size();
        int maximum = Bukkit.getMaxPlayers();
        double tps = Bukkit.getTPS().length > 0 ? Bukkit.getTPS()[0] : 20.0;
        for (Player player : Bukkit.getOnlinePlayers()) {
            postPlayerStatsSnapshot(player);
        }
        backendClient.postEvent("server.heartbeat", "minecraft", Map.of(
                "serverKey", serverKey,
                "online", true,
                "playersOnline", online,
                "playerLimit", maximum,
                "tps", String.format(java.util.Locale.ROOT, "%.2f", tps),
                "minecraftVersion", Bukkit.getMinecraftVersion(),
                "uptimeSeconds", TimeUnit.MILLISECONDS.toSeconds(System.currentTimeMillis() - startedAt)
        ));
    }

    private void postPlayerStatsSnapshot(Player player) {
        Map<String, Object> snapshot = new HashMap<>(Map.of(
                "uuid", player.getUniqueId().toString(),
                "username", player.getName(),
                "playtimeSeconds", player.getStatistic(Statistic.PLAY_ONE_MINUTE) / 20,
                "blocksBroken", sumBlockStatistic(player, Statistic.MINE_BLOCK),
                "blocksPlaced", sumBlockStatistic(player, Statistic.USE_ITEM),
                "kills", player.getStatistic(Statistic.PLAYER_KILLS),
                "deaths", player.getStatistic(Statistic.DEATHS),
                "achievementsCount", countCompletedAdvancements(player)
        ));
        optionalIntegrations.resolvePrimaryGroupAsync(player).whenComplete((rank, error) -> {
            if (error != null) {
                getLogger().warning("LuckPerms group lookup failed for " + player.getName() + ": " + error.getMessage());
            } else if (rank != null) {
                getLogger().info("LuckPerms group resolved for " + player.getName() + ": " + rank);
                snapshot.put("rank", rank);
            } else {
                getLogger().warning("LuckPerms group unresolved for " + player.getName());
            }
            backendClient.postEvent("player.stats.snapshot", "minecraft", snapshot);
        });
    }

    private void pollAdminCommands() {
        backendClient.getPendingCommands(serverKey).thenAccept(response -> response.commands().forEach(command -> {
            if (!inFlightCommands.add(command.id())) return;
            Bukkit.getScheduler().runTask(this, () -> executeAdminCommand(command));
        })).exceptionally(error -> null);
    }

    private void executeAdminCommand(BackendClient.PendingCommand command) {
        boolean success = false;
        String message = "";
        try {
            var payload = command.payload();
            String action = payload.has("action") ? payload.get("action").getAsString() : "chat.discord";
            String commandLine;
            if ("chat.discord".equals(command.type())) {
                commandLine = "say [Discord] " + payload.get("message").getAsString();
            } else {
                var parameters = payload.getAsJsonObject("parameters");
                commandLine = switch (action) {
                    case "say" -> "say " + parameters.get("mensagem").getAsString();
                    case "broadcast" -> "broadcast " + parameters.get("mensagem").getAsString();
                    case "kick" -> "kick " + parameters.get("jogador").getAsString();
                    case "whitelist.add" -> "whitelist add " + parameters.get("jogador").getAsString();
                    case "whitelist.remove" -> "whitelist remove " + parameters.get("jogador").getAsString();
                    default -> throw new IllegalArgumentException("Unknown admin action: " + action);
                };
            }
            success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), commandLine);
            message = success ? "Executed " + action : "Minecraft rejected " + action;
        } catch (Exception error) {
            message = error.getMessage() == null ? "COMMAND_FAILED" : error.getMessage();
        }
        boolean finalSuccess = success;
        backendClient.reportCommandResult(command.id(), success, message).whenComplete((ignored, error) -> inFlightCommands.remove(command.id()));
        getLogger().info("Admin command " + command.id() + " completed: " + finalSuccess + " - " + message);
    }

    private int sumBlockStatistic(Player player, Statistic statistic) {
        int total = 0;
        for (Material material : Material.values()) {
            if (!material.isBlock()) continue;
            try {
                total += player.getStatistic(statistic, material);
            } catch (IllegalArgumentException ignored) {
                // Paper does not expose every material/statistic pair.
            }
        }
        return total;
    }

    private int countCompletedAdvancements(Player player) {
        int total = 0;
        var advancements = Bukkit.advancementIterator();
        while (advancements.hasNext()) {
            var advancement = advancements.next();
            var progress = player.getAdvancementProgress(advancement);
            if (progress.isDone()) total++;
        }
        return total;
    }

    BackendClient backendClient() {
        return backendClient;
    }
}
