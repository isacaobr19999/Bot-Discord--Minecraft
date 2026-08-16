# Bot Discord

O bot Discord é o produto principal desta entrega. Ele consome somente o backend central e não acessa o banco diretamente. O bot registra slash commands, envia embeds, abre componentes de vinculação, consulta perfis e status, enfileira ordens administrativas e publica eventos Minecraft em um canal configurado.

## Variáveis de ambiente

| Variável | Finalidade |
|---|---|
| `DISCORD_BOT_TOKEN` | Token privado da aplicação Discord. |
| `DISCORD_APPLICATION_ID` | ID da aplicação usado para registrar commands. |
| `DISCORD_GUILD_ID` | Opcional; registra comandos em uma guilda específica durante desenvolvimento. |
| `INTEGRATION_API_KEY` | Chave compartilhada com o backend. |
| `BACKEND_URL` | URL da API central. |
| `DISCORD_BRIDGE_CHANNEL_ID` | Canal usado pela bridge bidirecional. |

A aplicação Discord precisa dos intents `Guilds`, `GuildMessages` e `Message Content Intent` para a bridge. O intent de conteúdo deve ser habilitado no Developer Portal somente quando a bridge estiver ativa.

## Comandos

Os comandos públicos incluem `/server`, `/players`, `/player`, `/link`, `/unlink`, `/stats`, `/rank` e `/money`. Os comandos de perfil usam dados vinculados; quando uma integração ainda não possui fonte de dados, o embed informa isso explicitamente e não inventa valores.

Os comandos administrativos usam `/mc status`, `/mc say`, `/mc broadcast`, `/mc kick` e `/mc whitelist`. O bot consulta políticas persistidas de cargos por guilda, falha fechado sem política válida, enfileira a ordem com idempotência e aguarda a confirmação do plugin por até alguns segundos. A resposta do Discord diferencia execução, falha e pendência.

## Bridge

Mensagens do Minecraft são lidas no feed autenticado do backend, deduplicadas por ID e publicadas como embeds. Mensagens do canal Discord configurado são transformadas em ordens `say` com prefixo de origem e rate limiting por usuário. O plugin executa a ordem na thread correta do Paper, enquanto toda comunicação HTTP permanece assíncrona.

## Execução

Na raiz do projeto, use `pnpm --dir discord-bot install` para instalar as dependências do módulo e `node discord-bot/src/index.mjs` para iniciar o bot com as variáveis de ambiente carregadas. O registro dos comandos ocorre no boot.
