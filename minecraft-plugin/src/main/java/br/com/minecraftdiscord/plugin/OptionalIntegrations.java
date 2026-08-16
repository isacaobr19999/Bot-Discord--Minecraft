package br.com.minecraftdiscord.plugin;

import java.util.UUID;
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

    String resolvePrimaryGroup(Player player) {
        if (!luckPerms) return null;
        try {
            Class<?> provider = Class.forName("net.luckperms.api.LuckPermsProvider");
            Object luckPermsApi = provider.getMethod("get").invoke(null);
            Object userManager = luckPermsApi.getClass().getMethod("getUserManager").invoke(luckPermsApi);
            Object future = userManager.getClass().getMethod("getUser", UUID.class).invoke(userManager, player.getUniqueId());
            Object user = future.getClass().getMethod("getNow", Object.class).invoke(future, new Object[] { null });
            if (user == null) return null;
            Object cachedData = user.getClass().getMethod("getCachedData").invoke(user);
            Object metaData = cachedData.getClass().getMethod("getMetaData").invoke(cachedData);
            Object group = metaData.getClass().getMethod("getPrimaryGroup").invoke(metaData);
            return group instanceof String value && !value.isBlank() ? value : null;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }
}
