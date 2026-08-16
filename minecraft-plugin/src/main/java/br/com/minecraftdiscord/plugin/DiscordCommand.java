package br.com.minecraftdiscord.plugin;

import java.util.List;
import java.util.UUID;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

final class DiscordCommand implements CommandExecutor, TabCompleter {
    private final MinecraftDiscordPlugin plugin;

    DiscordCommand(MinecraftDiscordPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage(ChatColor.RED + "Este comando só pode ser usado por um jogador.");
            return true;
        }
        if (args.length == 0) {
            player.sendMessage(ChatColor.YELLOW + "Use /discord link ou /discord unlink.");
            return true;
        }
        if (args[0].equalsIgnoreCase("link")) {
            player.sendMessage(ChatColor.GRAY + "Gerando um código temporário...");
            plugin.backendClient().createLinkCode(player.getUniqueId(), player.getName())
                    .whenComplete((result, error) -> plugin.getServer().getScheduler().runTask(plugin, () -> {
                        if (error != null) {
                            player.sendMessage(ChatColor.RED + "Não foi possível gerar o código agora. Tente novamente.");
                            return;
                        }
                        player.sendMessage(ChatColor.GREEN + "Código de vinculação: " + ChatColor.WHITE + result.code());
                        player.sendMessage(ChatColor.GRAY + "O código expira em 10 minutos e pode ser usado uma única vez.");
                    }));
            return true;
        }
        if (args[0].equalsIgnoreCase("unlink")) {
            player.sendMessage(ChatColor.YELLOW + "A desvinculação será concluída pelo site ou Discord após confirmação.");
            return true;
        }
        player.sendMessage(ChatColor.YELLOW + "Use /discord link ou /discord unlink.");
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) return List.of("link", "unlink");
        return List.of();
    }
}
