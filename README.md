# Minecraft Discord Bot Platform

Este projeto é uma plataforma de integração **exclusivamente para bot Discord e plugin Paper 1.21.x**. O backend central autentica eventos, gera vínculos Minecraft–Discord, enfileira comandos administrativos, registra auditoria e oferece consultas para o bot.

## Componentes da entrega

| Módulo | Responsabilidade |
|---|---|
| `discord-bot/` | Slash commands, embeds, componentes interativos, permissões por cargo, vinculação e confirmação de comandos. |
| `minecraft-plugin/` | Plugin Paper 1.21.x com eventos, heartbeat, estatísticas, chat, comandos de vinculação e execução assíncrona de ordens. |
| `server/` | API central, persistência, idempotência, auditoria, códigos temporários e fila de comandos. |
| `drizzle/` | Modelo relacional e migrações do backend. |
| `docs/` | Contratos técnicos, operação e referências do Paper/Discord. |

O diretório `client/` permanece somente como infraestrutura do template gerenciado, sem páginas, rotas ou funcionalidades de site entregues. O produto não inclui homepage, painel administrativo web, área de conta, loja ou frontend público.

## Fluxos principais

O jogador usa `/discord link` no Minecraft para gerar um código temporário. No Discord, o comando `/link` abre um componente para informar o código; o backend valida expiração, uso único e identidade. O bot e o plugin nunca acessam o banco diretamente.

Comandos administrativos são autorizados por políticas persistidas de guilda e cargo. O bot enfileira uma ordem idempotente, o plugin consulta a fila fora da thread principal, executa a ação na thread correta do Paper e envia o resultado ao backend. O bot pode devolver ao executor a confirmação final ou indicar que a ordem permaneceu pendente.

Eventos de entrada, saída, chat e snapshots de estatísticas são enviados pelo plugin de forma assíncrona. A bridge de chat deve preservar a origem, aplicar rate limiting e evitar reprocessamento do próprio evento.

## Configuração

Os segredos devem ser fornecidos por ambiente e nunca commitados: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `INTEGRATION_API_KEY`, `BACKEND_URL` e, quando aplicável, `DISCORD_GUILD_ID`. O plugin usa `config.yml` para URL, chave e `server-key`.

## Validação

A base TypeScript é validada com `pnpm check` e `pnpm test`. O bot é validado com `node --check discord-bot/src/index.mjs`. O plugin é compilado com Gradle e Java 21.
