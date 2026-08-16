# Plugin Paper

O plugin é compatível com Paper 1.21.x e funciona como cliente autenticado do backend. Ele envia heartbeat, entradas, saídas, chat e snapshots de estatísticas; gera códigos de vinculação; consulta ordens administrativas e chat Discord; e executa ações somente na thread correta do servidor.

## Build

O módulo exige Java 21 e Gradle. A partir de `minecraft-plugin/`, execute `gradle build`. O artefato final fica em `build/libs/`. Copie o JAR para `plugins/` do servidor Paper e reinicie o servidor para a primeira instalação.

## Configuração

Após iniciar uma vez, edite `plugins/MinecraftDiscordPlatform/config.yml`:

```yaml
backend-url: "https://seu-backend.example"
integration-api-key: "chave-gerada-fora-do-repositorio"
server-key: "primary"
```

A chave deve ser a mesma `INTEGRATION_API_KEY` configurada no backend. Nunca publique `config.yml` com a chave preenchida. O plugin não requer que LuckPerms, Vault, PlaceholderAPI ou Essentials estejam instalados; quando presentes, são detectados sem tornar a inicialização dependente deles.

## Operação

O jogador usa `/discord link` para gerar um código temporário e `/discord unlink` para revogar o vínculo. As chamadas HTTP são assíncronas. O heartbeat é coletado em tarefa do servidor, enquanto o envio de rede utiliza `HttpClient.sendAsync`; nenhuma chamada externa bloqueia a thread principal.

O polling de comandos ocorre fora da thread principal. A execução de `say`, `broadcast`, `kick` e whitelist retorna à thread do Paper e o resultado é enviado ao backend. Eventos repetidos são protegidos por idempotência no backend.

## Diagnóstico

Se o plugin iniciar, mas o status não aparecer, confirme `backend-url`, `integration-api-key` e conectividade de saída HTTPS. Se o bot informar que o comando está pendente, verifique se o servidor está online e se o backend possui eventos `admin.command.requested` ou `chat.discord` em estado `received`. Se a bridge estiver silenciosa, confirme `DISCORD_BRIDGE_CHANNEL_ID`, `DISCORD_EVENT_CHANNELS_JSON` e o Message Content Intent da aplicação Discord.
