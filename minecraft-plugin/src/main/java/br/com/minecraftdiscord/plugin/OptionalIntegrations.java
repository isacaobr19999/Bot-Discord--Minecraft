package br.com.minecraftdiscord.plugin;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

final class OptionalIntegrations {
    private final boolean luckPerms;
    private final boolean vault;
    private final boolean placeholderApi;
    private final boolean essentials;

    private OptionalIntegrations(boolean luckPerms, boolean vault, boolean placeholderApi, boolean essentials) {
        this.luckPerms = luckPerms;
        this.vault = vault;
        this.placeholderApi = placeholderApi;
        this.essentials = essentials;
    }

    static OptionalIntegrations detect(PluginManager pluginManager) {
        return new OptionalIntegrations(
                isEnabled(pluginManager, "LuckPerms"),
                isEnabled(pluginManager, "Vault"),
                isEnabled(pluginManager, "PlaceholderAPI"),
                isEnabled(pluginManager, "Essentials")
        );
    }

    private static boolean isEnabled(PluginManager manager, String name) {
        Plugin plugin = manager.getPlugin(name);
        return plugin != null && plugin.isEnabled();
    }

    void logTo(MinecraftDiscordPlugin plugin) {
        plugin.getLogger().info("Optional integrations: LuckPerms=" + luckPerms + ", Vault=" + vault + ", PlaceholderAPI=" + placeholderApi + ", Essentials=" + essentials);
    }

    boolean hasLuckPerms() { return luckPerms; }
    boolean hasVault() { return vault; }
    boolean hasPlaceholderApi() { return placeholderApi; }
    boolean hasEssentials() { return essentials; }

    /**
     * Resolve the primary group without blocking the Paper main thread.
     * LuckPerms users are normally cached after login; when they are not,
     * loadUser completes asynchronously. Vault remains a compatibility fallback.
     */
    CompletionStage<String> resolvePrimaryGroupAsync(Player player) {
        if (luckPerms) {
            try {
                Class<?> provider = Class.forName("net.luckperms.api.LuckPermsProvider");
                Object luckPermsApi = provider.getMethod("get").invoke(null);
                Object userManager = luckPermsApi.getClass().getMethod("getUserManager").invoke(luckPermsApi);
                Object user = userManager.getClass().getMethod("getUser", UUID.class).invoke(userManager, player.getUniqueId());
                if (user != null) {
                    String group = primaryGroupFromUser(user);
                    if (group != null) return CompletableFuture.completedFuture(group);
                }

                Object loaded = userManager.getClass().getMethod("loadUser", UUID.class).invoke(userManager, player.getUniqueId());
                if (loaded instanceof CompletionStage<?> stage) {
                    return stage.handle((value, error) -> {
                        if (error == null && value != null) {
                            String group = primaryGroupFromUser(value);
                            if (group != null) return group;
                        }
                        return resolveViaVault(player);
                    });
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Continue to Vault fallback below.
            }
        }
        return CompletableFuture.completedFuture(resolveViaVault(player));
    }

    private String primaryGroupFromUser(Object user) {
        try {
            Object group = user.getClass().getMethod("getPrimaryGroup").invoke(user);
            if (group instanceof String value && !value.isBlank()) return value;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Older API implementations may expose the value only through cached metadata.
        }

        try {
            Object cachedData = user.getClass().getMethod("getCachedData").invoke(user);
            Object metaData = cachedData.getClass().getMethod("getMetaData").invoke(cachedData);
            Object group = metaData.getClass().getMethod("getPrimaryGroup").invoke(metaData);
            return group instanceof String value && !value.isBlank() ? value : null;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    private String resolveViaVault(Player player) {
        if (!vault) return null;
        try {
            Class<?> permissionClass = Class.forName("net.milkbowl.vault.permission.Permission");
            Object services = Bukkit.getServicesManager();
            Object registration = services.getClass().getMethod("getRegistration", Class.class).invoke(services, permissionClass);
            if (registration == null) return null;
            Object provider = registration.getClass().getMethod("getProvider").invoke(registration);
            Object group = provider.getClass().getMethod("getPrimaryGroup", String.class, String.class)
                    .invoke(provider, player.getWorld().getName(), player.getName());
            return group instanceof String value && !value.isBlank() ? value : null;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }
}
