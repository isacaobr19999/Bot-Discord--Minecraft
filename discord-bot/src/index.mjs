import { mergeBridgeEvents, shouldPublishBridgeEvent } from "./bridge-worker.mjs";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { formatMinecraftBridgeEvent } from "./bridge-format.mjs";
import { parseEventPayload } from "./event-payload.mjs";

const {
  DISCORD_BOT_TOKEN: token,
  DISCORD_APPLICATION_ID: applicationId,
  DISCORD_GUILD_ID: guildId,
  INTEGRATION_API_KEY: integrationKey,
  BACKEND_URL: backendUrl = "http://localhost:3000",
  DISCORD_ADMIN_ROLE_IDS: adminRoleIds = "",
  DISCORD_BRIDGE_CHANNEL_ID: bridgeChannelId = "",
  DISCORD_LOG_CHANNEL_ID: logChannelId = "",
  DISCORD_EVENT_CHANNELS_JSON: eventChannelsJson = "{}",
} = process.env;

if (!token || !applicationId || !integrationKey) {
  throw new Error("DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID e INTEGRATION_API_KEY são obrigatórios");
}

const configuredAdminRoles = new Set(adminRoleIds.split(",").map(value => value.trim()).filter(Boolean));

const VIP_ROLE_MAPPING = {
  "obsidian": "1542424081981509653",
  "diamante": "1542424544357253161",
  "esmeralda": "1542424679820697651",
  "ouro": "1542424823731453972",
  "ferro": "1542424939787722752",
  "default": "1542425230851444787",
  "membro": "1542425230851444787"
};
const ALL_VIP_ROLE_IDS = new Set(Object.values(VIP_ROLE_MAPPING));

const rest = new REST({ version: "10" }).setToken(token);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const seenMinecraftEvents = new Set();
const bridgeCooldowns = new Map();
let eventChannels = {};
try { eventChannels = JSON.parse(eventChannelsJson); } catch { console.warn("[Discord] DISCORD_EVENT_CHANNELS_JSON inválido; usando canal fallback"); }

const commands = [
  new SlashCommandBuilder().setName("server").setDescription("Mostra o status do servidor Minecraft."),
  new SlashCommandBuilder().setName("players").setDescription("Mostra a ocupação atual do servidor."),
  new SlashCommandBuilder().setName("player").setDescription("Mostra o perfil público de um jogador.").addStringOption(option => option.setName("nome").setDescription("Nome Minecraft").setRequired(true)),
  new SlashCommandBuilder().setName("link").setDescription("Vincula sua conta Discord ao Minecraft."),
  new SlashCommandBuilder().setName("unlink").setDescription("Desvincula sua conta Discord do Minecraft."),
  new SlashCommandBuilder().setName("stats").setDescription("Mostra os dados públicos da sua conta vinculada."),
  new SlashCommandBuilder().setName("rank").setDescription("Mostra o rank da sua conta vinculada."),
  new SlashCommandBuilder().setName("money").setDescription("Mostra o saldo quando uma economia estiver conectada."),
  new SlashCommandBuilder().setName("mc").setDescription("Operações administrativas do Minecraft.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(sub => sub.setName("status").setDescription("Consulta o status do servidor."))
    .addSubcommand(sub => sub.setName("say").setDescription("Envia uma mensagem ao servidor.").addStringOption(option => option.setName("mensagem").setDescription("Mensagem").setRequired(true)))
    .addSubcommand(sub => sub.setName("broadcast").setDescription("Envia um anúncio ao servidor.").addStringOption(option => option.setName("mensagem").setDescription("Mensagem").setRequired(true)))
    .addSubcommand(sub => sub.setName("kick").setDescription("Solicita expulsão de jogador.").addStringOption(option => option.setName("jogador").setDescription("Jogador").setRequired(true)))
    .addSubcommand(sub => sub.setName("whitelist").setDescription("Gerencia whitelist.").addStringOption(option => option.setName("acao").setDescription("Ação").setRequired(true).addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" })).addStringOption(option => option.setName("jogador").setDescription("Jogador").setRequired(true))),
].map(command => command.toJSON());

async function registerCommands() {
  const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
  await rest.put(route, { body: commands });
}

async function backendRequest(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-integration-key": integrationKey, ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Backend responded with ${response.status}`);
  return body;
}

const backendGet = path => backendRequest(path);
const backendPost = (path, body) => backendRequest(path, { method: "POST", body: JSON.stringify(body) });

async function waitForCommandResult(commandId, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await backendGet(`/api/integration/admin/commands/status?commandId=${encodeURIComponent(commandId)}`);
    if (["processed", "failed"].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return { status: "received" };
}

async function hasAdminRole(interaction, permission) {
  if (!interaction.inGuild()) return false;
  try {
    const result = await backendGet(`/api/integration/discord-permissions?guildId=${encodeURIComponent(interaction.guildId)}`);
    const allowedPolicies = result.policies.filter(policy => policy.enabled && policy.permission === permission);
    return allowedPolicies.some(policy => interaction.member.roles.cache.has(policy.roleId));
  } catch (error) {
    console.error("[Discord] Permission lookup failed", error);
    return false;
  }
}

function statusEmbed(status) {
  const snapshot = status.snapshot;
  return new EmbedBuilder()
    .setColor(status.online ? 0x35d07f : 0xe05d5d)
    .setTitle(status.online ? "Servidor online" : "Servidor offline")
    .addFields(
      { name: "Jogadores", value: snapshot ? `${snapshot.playersOnline}/${snapshot.playerLimit}` : "—", inline: true },
      { name: "TPS", value: snapshot?.tps ?? "—", inline: true },
      { name: "Versão", value: snapshot?.minecraftVersion ?? "—", inline: true },
    )
    .setTimestamp();
}

function linkActionRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("link:open").setLabel("Informar código").setStyle(ButtonStyle.Success));
}

async function publishRoleSyncLog({ username, rank, added = false, removedCount = 0, error = null, unmapped = false }) {
  if (!logChannelId) return;
  try {
    const channel = await client.channels.fetch(logChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const failed = Boolean(error);
    const description = failed
      ? `Falha ao sincronizar o cargo de **${username}**.`
      : unmapped
        ? `O rank de **${username}** não possui cargo Discord configurado.`
        : `Sincronização LuckPerms concluída para **${username}**.`;
    const details = failed
      ? `Erro: ${String(error).slice(0, 240)}`
      : unmapped
        ? `Rank **${rank}** recebido, mas ele não está no mapa de cargos VIP.`
        : `${added ? `Cargo **${rank}** adicionado.` : `Cargo **${rank}** já estava aplicado.`} ${removedCount > 0 ? `${removedCount} cargo(s) VIP antigo(s) removido(s).` : "Nenhum cargo VIP antigo removido."}`;
    await channel.send({ embeds: [new EmbedBuilder()
      .setColor(failed ? 0xe05d5d : unmapped ? 0xf2c14e : 0x8ce0b8)
      .setTitle(failed ? "Falha na sincronização de cargo" : unmapped ? "Rank sem cargo mapeado" : "Sincronização de cargo")
      .setDescription(`${description}\n${details}`)
      .addFields({ name: "Rank LuckPerms", value: String(rank || "não informado"), inline: true })
      .setTimestamp()] });
  } catch (logError) {
    console.error("[Discord] Role audit log failed", logError.message);
  }
}

async function syncDiscordRoles() {
  if (!guildId) return;
  try {
    const { events } = await backendGet("/api/integration/discord-roles/pending");
    for (const event of events) {
      const payload = parseEventPayload(event.payload);
      if (!payload.rank || !payload.username) {
        console.warn(`[Discord] Ignoring role event ${event.id}: payload missing rank or username`);
        continue;
      }

      try {
        const profile = await backendGet(`/api/integration/player?username=${encodeURIComponent(payload.username)}`);
        if (profile.link?.discordUserId) {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          const member = guild ? await guild.members.fetch(profile.link.discordUserId).catch(() => null) : null;
          
          if (member) {
            const targetRoleId = VIP_ROLE_MAPPING[payload.rank.toLowerCase()];
            if (targetRoleId) {
              const rolesToRemove = [...member.roles.cache.keys()].filter(id => ALL_VIP_ROLE_IDS.has(id) && id !== targetRoleId);
              if (rolesToRemove.length > 0) {
                await member.roles.remove(rolesToRemove);
                console.log(`[Discord] Removed VIP roles from ${payload.username}: ${rolesToRemove.join(", ")}`);
              }
              const added = !member.roles.cache.has(targetRoleId);
              if (added) {
                await member.roles.add(targetRoleId);
                console.log(`[Discord] Added VIP role ${payload.rank} to ${payload.username}`);
              }
              await publishRoleSyncLog({ username: payload.username, rank: payload.rank, added, removedCount: rolesToRemove.length });
            } else {
              console.warn(`[Discord] No VIP role mapped for LuckPerms rank ${payload.rank} (${payload.username})`);
              await publishRoleSyncLog({ username: payload.username, rank: payload.rank, unmapped: true });
            }
          }
        }
        await backendPost("/api/integration/discord-feed/delivery", { eventId: event.id, eventType: event.type, channelId: "discord-roles", success: true });
      } catch (error) {
        console.error(`[Discord] Role sync failed for ${payload.username}:`, error.message);
        await publishRoleSyncLog({ username: payload.username, rank: payload.rank, error: error.message });
        await backendPost("/api/integration/discord-feed/delivery", { eventId: event.id, eventType: event.type, channelId: "discord-roles", success: false, error: error.message }).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[Discord] Role sync worker failed:", error.message);
  }
}

async function publishMinecraftEvents() {
  const targetChannels = [...new Set(Object.values(eventChannels).filter(Boolean).concat(bridgeChannelId).filter(Boolean))];
  if (targetChannels.length === 0) return;

  for (const channelId of targetChannels) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const [feed, pending] = await Promise.all([
      backendGet(`/api/integration/discord-feed?limit=50&channelId=${encodeURIComponent(channelId)}`), 
      backendGet(`/api/integration/discord-feed/pending?channelId=${encodeURIComponent(channelId)}`)
    ]);
    const events = mergeBridgeEvents(feed.events, pending.events);

    for (const event of [...events].reverse()) {
      if (!["player.joined", "player.left", "chat.minecraft"].includes(event.type)) continue;
      if (!shouldPublishBridgeEvent(event, channelId, { ...eventChannels, fallback: bridgeChannelId }, seenMinecraftEvents)) continue;
      
      const text = formatMinecraftBridgeEvent(event);
      
      try {
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x8ce0b8).setDescription(text).setFooter({ text: "Minecraft · bridge" })] });
        seenMinecraftEvents.add(`${event.id}:${channelId}`);
        await backendPost("/api/integration/discord-feed/delivery", { eventId: event.id, eventType: event.type, channelId, success: true });
      } catch (error) {
        await backendPost("/api/integration/discord-feed/delivery", { eventId: event.id, eventType: event.type, channelId, success: false, error: error.message }).catch(() => {});
      }
    }
  }
  if (seenMinecraftEvents.size > 500) seenMinecraftEvents.clear();
}

client.once("ready", readyClient => {
  console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
  if (!logChannelId) console.warn("[Discord] DISCORD_LOG_CHANNEL_ID não configurado; auditoria de cargos ficará somente no journalctl");
  if (bridgeChannelId) setInterval(() => publishMinecraftEvents().catch(error => console.error("[Discord] Bridge poll failed", error)), 5000);
  setInterval(() => syncDiscordRoles().catch(error => console.error("[Discord] Role sync poll failed", error)), 10000);
});

client.on("messageCreate", async message => {
  if (message.author.bot || !bridgeChannelId || message.channelId !== bridgeChannelId || !message.guildId) return;
  const now = Date.now();
  const lastMessageAt = bridgeCooldowns.get(message.author.id) ?? 0;
  if (now - lastMessageAt < 1500) return;
  bridgeCooldowns.set(message.author.id, now);
  try {
    await backendPost("/api/integration/chat/discord", { messageId: message.id, authorId: message.author.id, guildId: message.guildId, message: message.content, bridgeOrigin: "discord" });
  } catch (error) {
    console.error("[Discord] Minecraft bridge send failed", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === "link:open") {
      const modal = new ModalBuilder().setCustomId("link:submit").setTitle("Vincular Minecraft");
      const code = new TextInputBuilder().setCustomId("code").setLabel("Código de 6 dígitos").setPlaceholder("000000").setMinLength(6).setMaxLength(6).setRequired(true).setStyle(TextInputStyle.Short);
      modal.addComponents(new ActionRowBuilder().addComponents(code));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "link:submit") {
      const result = await backendPost("/api/integration/link-codes/redeem-discord", {
        code: interaction.fields.getTextInputValue("code"),
        discordUserId: interaction.user.id,
        username: interaction.user.username,
        globalName: interaction.user.globalName,
      });
      await interaction.reply({ content: `Conta vinculada com sucesso. ID do jogador: ${result.minecraftPlayerId}`, ephemeral: true });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "server" || (interaction.commandName === "mc" && interaction.options.getSubcommand() === "status")) {
      const status = await backendGet("/api/integration/server-status");
      await interaction.reply({ embeds: [statusEmbed(status)], ephemeral: interaction.commandName === "mc" });
      return;
    }

    if (interaction.commandName === "players") {
      const status = await backendGet("/api/integration/server-status");
      const count = status.snapshot?.playersOnline ?? 0;
      const limit = status.snapshot?.playerLimit ?? 0;
      await interaction.reply({ content: status.online ? `Há **${count}** jogador(es) online de ${limit} vaga(s).` : "O servidor está offline ou sem heartbeat recente.", ephemeral: false });
      return;
    }

    if (interaction.commandName === "player") {
      const name = interaction.options.getString("nome", true);
      const profile = await backendGet(`/api/integration/player?username=${encodeURIComponent(name)}`);
      const player = profile.player;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8ce0b8).setTitle(player.username).addFields(
        { name: "UUID", value: player.uuid },
        { name: "Rank", value: player.lastKnownRank ?? "Não informado", inline: true },
        { name: "Último login", value: new Date(player.lastSeenAt).toLocaleString("pt-BR"), inline: true },
      )] });
      return;
    }

    if (interaction.commandName === "link") {
      console.log(`[Discord] /link received from ${interaction.user.id}`);
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ content: "Use `/discord link` no Minecraft para gerar seu código e depois informe-o aqui.", components: [linkActionRow()] });
      return;
    }

    if (interaction.commandName === "unlink") {
      const result = await backendPost("/api/integration/unlink-discord", { discordUserId: interaction.user.id });
      await interaction.reply({ content: result.unlinked ? "Sua conta Discord foi desvinculada." : "Nenhum vínculo Discord ativo foi encontrado.", ephemeral: true });
      return;
    }

    if (["stats", "rank", "money"].includes(interaction.commandName)) {
      const linked = await backendGet(`/api/integration/discord-profile?discordUserId=${encodeURIComponent(interaction.user.id)}`);
      if (!linked.profile) {
        await interaction.reply({ content: "Nenhuma conta Minecraft está vinculada a este usuário.", ephemeral: true });
        return;
      }
      const profile = linked.profile;
      if (interaction.commandName === "rank") {
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8ce0b8).setTitle(`Rank de ${profile.player.username}`).addFields({ name: "Rank atual", value: profile.player.lastKnownRank ?? "Membro" }, { name: "Discord", value: "Vinculado" })], ephemeral: true });
        return;
      }
      if (interaction.commandName === "money") {
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xd9aa55).setTitle(`Economia de ${profile.player.username}`).setDescription("Nenhum provedor de economia está conectado. O bot não exibe saldo estimado ou inventado.")], ephemeral: true });
        return;
      }
      const stats = profile.stats;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8ce0b8).setTitle(`Estatísticas de ${profile.player.username}`).addFields({ name: "Playtime", value: `${Math.floor((stats?.playtimeSeconds ?? 0) / 3600)}h`, inline: true }, { name: "Kills", value: String(stats?.kills ?? 0), inline: true }, { name: "Deaths", value: String(stats?.deaths ?? 0), inline: true }, { name: "Blocos quebrados", value: String(stats?.blocksBroken ?? 0), inline: true }, { name: "Blocos colocados", value: String(stats?.blocksPlaced ?? 0), inline: true }, { name: "Conquistas", value: String(stats?.achievementsCount ?? 0), inline: true })], ephemeral: true });
      return;
    }

    if (interaction.commandName === "mc") {
      if (!(await hasAdminRole(interaction, `minecraft.${interaction.options.getSubcommand()}`))) {
        await interaction.reply({ content: "Você não possui um cargo configurado para esta operação.", ephemeral: true });
        return;
      }
      const subcommand = interaction.options.getSubcommand();
      const action = subcommand === "whitelist" ? `whitelist.${interaction.options.getString("acao", true)}` : subcommand;
      const parameters = subcommand === "kick" ? { jogador: interaction.options.getString("jogador", true) } : { mensagem: interaction.options.getString("mensagem") ?? "" };
      const commandId = crypto.randomUUID();
      const result = await backendPost("/api/integration/admin/commands", { commandId, action, actorId: interaction.user.id, guildId: interaction.guildId, roleIds: [...interaction.member.roles.cache.keys()], parameters });
      const finalResult = result.accepted ? await waitForCommandResult(commandId) : { status: "failed" };
      const embed = new EmbedBuilder().setTitle(finalResult.status === "processed" ? "Comando executado" : finalResult.status === "failed" ? "Comando rejeitado" : "Comando pendente").setColor(finalResult.status === "processed" ? 0x35d07f : finalResult.status === "failed" ? 0xe05d5d : 0xd9aa55).setDescription(finalResult.status === "processed" ? "O servidor confirmou a execução." : finalResult.status === "failed" ? (finalResult.failureReason ?? "O servidor não executou o comando.") : "O comando ficou enfileirado e será reconciliado pelo painel.");
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error("[Discord] Interaction failed", error);
    const content = "Não foi possível concluir a operação agora.";
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true });
    else await interaction.reply({ content, ephemeral: true });
  }
});

await registerCommands();
await client.login(token);
