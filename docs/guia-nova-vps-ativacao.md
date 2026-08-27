# Guia de instalação e ativação em uma nova VPS

**Projeto:** PlayStorCraft — integração Minecraft Paper, Discord e backend

**Escopo:** bot-only, sem painel web e sem substituir o site ou o Pterodactyl existentes.

> Este guia instala três componentes separados: o backend API, o bot Discord e o plugin Paper. O site principal, o painel Pterodactyl, o Wings, o Docker e os servidores Minecraft existentes devem permanecer fora da área de alteração.

## 1. Arquitetura da instalação

| Componente | Local | Acesso | Função |
|---|---|---|---|
| Backend | VPS | `127.0.0.1:3100`, publicado por HTTPS | API, banco, vinculação, eventos e fila de comandos |
| Bot Discord | VPS | Saída HTTPS/WebSocket para o Discord | Slash commands, permissões e bridge |
| Banco | VPS ou serviço privado | Somente rede privada | Persistência do backend |
| Plugin Paper | Servidor Minecraft/Pterodactyl | HTTPS para a API | Heartbeat, eventos, bridge e comandos |
| Nginx | VPS | `api.seudominio.com.br:443` | Proxy reverso isolado para a API |

O backend deve escutar apenas em `127.0.0.1`. A porta `3100` não deve ser liberada publicamente no firewall; somente as portas SSH, HTTP e HTTPS devem ser consideradas para a publicação normal.

## 2. Informações que precisam ser preparadas

Antes de começar, tenha o IPv4 da nova VPS, um subdomínio exclusivo para a API, acesso administrativo ao Discord Developer Portal, o ID da aplicação Discord, o ID da guilda e o ID do canal de bridge. O token do bot deve ser criado ou regenerado no [Discord Developer Portal][4].

O domínio da API precisa apontar para o IPv4 da nova VPS. Confirme a propagação antes de emitir o certificado:

```bash
dig @1.1.1.1 api.seudominio.com.br A +short
```

O resultado esperado é o IPv4 da nova VPS. Não prossiga com o certificado enquanto o DNS público não estiver correto.

## 3. Inspeção de segurança antes de alterar a VPS

Execute uma verificação não destrutiva. Se o site ou o painel não responderem `HTTP 200`, pare e corrija o problema antes de continuar.

```bash
sudo nginx -t
curl -sS -o /dev/null -w 'site: HTTP %{http_code}\n' https://seudominio.com.br
curl -sS -o /dev/null -w 'painel: HTTP %{http_code}\n' https://panel.seudominio.com.br
sudo ss -lntup | grep -E ':(80|443|3100|25565)\\b' || true
df -h /
free -h
sudo systemctl is-active nginx
sudo systemctl is-active wings
sudo systemctl is-active docker
```

Faça também uma cópia da configuração antes de criar o proxy:

```bash
BACKUP="/root/mcbridge-backup-$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "$BACKUP"
sudo nginx -T 2>/dev/null | sudo tee "$BACKUP/nginx-before.txt" >/dev/null
sudo cp -a /etc/nginx "$BACKUP/nginx-before"
sudo cp -a /etc/pterodactyl "$BACKUP/pterodactyl-before" 2>/dev/null || true
echo "$BACKUP"
```

## 4. Instalar dependências sem atualizar o sistema inteiro

Não execute `apt upgrade` durante esta instalação em uma VPS que já hospeda produção. Instale somente os pacotes necessários, depois confirme as versões.

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs openjdk-21-jdk-headless build-essential ca-certificates git curl unzip
sudo npm install --global pnpm@10
node --version
pnpm --version
java -version
```

Crie um usuário e diretórios exclusivos. O usuário de serviço não deve possuir shell interativo.

```bash
if ! getent passwd mcbridge >/dev/null; then
  sudo useradd --system --create-home --home-dir /opt/mcbridge --shell /usr/sbin/nologin mcbridge
fi
sudo install -d -o mcbridge -g mcbridge -m 750 /opt/mcbridge /opt/mcbridge/app
sudo install -d -o root -g mcbridge -m 750 /etc/mcbridge
```

## 5. Clonar e compilar o projeto

Clone a branch `main` do repositório oficial selecionado para este projeto. O repositório não deve conter tokens, senhas ou chaves reais.

```bash
sudo -u mcbridge git clone --branch main \
  https://github.com/isacaobr19999/Bot-Discord--Minecraft.git \
  /opt/mcbridge/app
cd /opt/mcbridge/app
sudo -u mcbridge pnpm install --frozen-lockfile
sudo -u mcbridge pnpm --dir discord-bot install --frozen-lockfile
sudo -u mcbridge pnpm build
```

O plugin Paper pode ser compilado em uma máquina de confiança com Java 21. O JAR gerado fica em `minecraft-plugin/build/libs/`. Copie somente o JAR para a pasta `plugins/` do servidor Paper; não copie o repositório inteiro para o diretório do Minecraft.

```bash
cd /opt/mcbridge/app/minecraft-plugin
./gradlew clean build --no-daemon
find build/libs -maxdepth 1 -name '*.jar' -print
```

## 6. Criar banco e migrações

Use um banco e um usuário exclusivos. Gere a senha na própria VPS e salve-a em arquivo root-only. A senha abaixo usa somente caracteres hexadecimais, evitando problemas de escape na URL do MySQL.

```bash
DB_PASS="$(openssl rand -hex 24)"
printf '%s\n' "$DB_PASS" | sudo tee /root/mcbridge-db-password >/dev/null
sudo chmod 600 /root/mcbridge-db-password
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS mcbridge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mcbridge'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'mcbridge'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON mcbridge.* TO 'mcbridge'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

Depois que o arquivo de ambiente estiver criado, aplique as migrações:

```bash
cd /opt/mcbridge/app
set -a
. /etc/mcbridge/backend.env
set +a
sudo -u mcbridge env DATABASE_URL="$DATABASE_URL" pnpm drizzle-kit migrate
```

Não use comandos destrutivos como `DROP DATABASE` para corrigir uma migração. Investigue o erro e mantenha o banco existente.

## 7. Criar os ambientes sem revelar segredos

Gere uma chave nova para cada instalação. A mesma chave deve ser usada pelo backend, pelo bot e pelo `config.yml` do plugin daquela instalação.

```bash
umask 077
INTEGRATION_API_KEY="$(openssl rand -hex 32)"
JWT_SECRET="$(openssl rand -hex 48)"
printf '%s\n' "$INTEGRATION_API_KEY" | sudo tee /root/mcbridge-integration-key >/dev/null
sudo chmod 600 /root/mcbridge-integration-key
```

Crie `/etc/mcbridge/backend.env` com o conteúdo abaixo, substituindo somente os valores gerados localmente:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
DATABASE_URL=mysql://mcbridge:SENHA_DO_ARQUIVO@127.0.0.1:3306/mcbridge
JWT_SECRET=SEGREDO_JWT_GERADO_NA_VPS
INTEGRATION_API_KEY=CHAVE_HEX_GERADA_NA_VPS
```

Crie `/etc/mcbridge/bot.env`:

```ini
NODE_ENV=production
DISCORD_BOT_TOKEN=TOKEN_DO_BOT
DISCORD_APPLICATION_ID=ID_DA_APLICACAO
DISCORD_GUILD_ID=ID_DA_GUILDA
INTEGRATION_API_KEY=EXATAMENTE_A_MESMA_CHAVE_DO_BACKEND
BACKEND_URL=https://api.seudominio.com.br
DISCORD_BRIDGE_CHANNEL_ID=ID_DO_CANAL_DE_BRIDGE
DISCORD_LOG_CHANNEL_ID=ID_DO_CANAL_DE_LOGS
```

Proteja os arquivos:

```bash
sudo chown root:mcbridge /etc/mcbridge/backend.env /etc/mcbridge/bot.env
sudo chmod 640 /etc/mcbridge/backend.env /etc/mcbridge/bot.env
```

Nunca envie esses arquivos por chat, commit, print ou anexo. Se um token Discord aparecer em algum lugar público, use **Reset Token** no Developer Portal imediatamente.

## 8. Configurar o Nginx sem interferir no site e no painel

Crie um arquivo exclusivo para a API. Não edite os blocos existentes do site ou do painel.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.seudominio.com.br;

    location /.well-known/acme-challenge/ {
        root /var/www/mcbridge-acme;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name api.seudominio.com.br;

    ssl_certificate /etc/letsencrypt/live/api.seudominio.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.seudominio.com.br/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Valide antes de recarregar:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -sS -o /dev/null -w 'api_sem_chave: HTTP %{http_code}\n' \
  https://api.seudominio.com.br/api/integration/health
```

O resultado `401` sem a chave é esperado e confirma que o backend está online e protegido. Não abra a porta `3100` publicamente.

## 9. Criar serviços persistentes

Crie `/etc/systemd/system/mcbridge-backend.service`:

```ini
[Unit]
Description=MCBridge Backend API
After=network-online.target mysql.service mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=mcbridge
Group=mcbridge
WorkingDirectory=/opt/mcbridge/app
EnvironmentFile=/etc/mcbridge/backend.env
ExecStart=/usr/bin/node /opt/mcbridge/app/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Crie `/etc/systemd/system/mcbridge-discord.service`:

```ini
[Unit]
Description=MCBridge Discord Bot
After=network-online.target mcbridge-backend.service
Wants=network-online.target

[Service]
Type=simple
User=mcbridge
Group=mcbridge
WorkingDirectory=/opt/mcbridge/app/discord-bot
EnvironmentFile=/etc/mcbridge/bot.env
ExecStart=/usr/bin/node /opt/mcbridge/app/discord-bot/src/index.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Ative primeiro o backend e valide sua porta local. Depois ative o bot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mcbridge-backend mcbridge-discord
sudo systemctl start mcbridge-backend
sleep 5
sudo systemctl is-active mcbridge-backend
sudo ss -lntup | grep ':3100'
sudo systemctl start mcbridge-discord
sudo systemctl is-active mcbridge-discord
```

A porta esperada é `127.0.0.1:3100`, nunca `0.0.0.0:3100`. Para acompanhar logs:

```bash
sudo journalctl -u mcbridge-backend -f
sudo journalctl -u mcbridge-discord -f
```

## 10. Configurar o Discord

No [Discord Developer Portal][4], ative **Message Content Intent** em **Bot → Privileged Gateway Intents**, porque a bridge precisa ler mensagens do canal Discord. Convide o bot para a guilda com os escopos `bot` e `applications.commands`. Para auditoria de cargos, configure também `DISCORD_LOG_CHANNEL_ID` com o ID do canal de logs. O bot precisa de **View Channel**, **Send Messages**, **Embed Links** e **Manage Roles**; o cargo do bot deve estar acima dos cargos VIP que ele gerencia.

Quando o serviço iniciar, o bot deve registrar os comandos na guilda informada. O resultado esperado no log é uma mensagem de login/ready. Se aparecer `401 Unauthorized`, o token está incorreto ou foi regenerado. Se aparecer `Used disallowed intents`, ative e salve o **Message Content Intent**.

## 11. Instalar e configurar o plugin Paper

Copie o JAR compilado para `plugins/` e reinicie somente o servidor Minecraft pelo Pterodactyl. O plugin deve aparecer na lista de plugins como `MinecraftDiscordPlatform`.

Depois da primeira inicialização, edite `plugins/MinecraftDiscordPlatform/config.yml`:

```yaml
backend-url: "https://api.seudominio.com.br"
integration-api-key: "A_MESMA_CHAVE_DO_BACKEND"
server-key: "primary"
```

Reinicie o Paper pelo Pterodactyl. A mensagem esperada é semelhante a `Minecraft Discord Platform enabled for server primary`. Se aparecer `Backend unavailable: ConnectException`, verifique se `backend-url` não está usando `localhost` e se o container consegue alcançar o domínio HTTPS. Se aparecer `401`, a chave do plugin não é a mesma chave do backend; copie exatamente a mesma `INTEGRATION_API_KEY` para `integration-api-key`, sem publicar a chave em logs ou no GitHub.

Após o reinício, faça um jogador vinculado entrar no servidor e aguarde até 70 segundos. O plugin atualizado resolve o grupo LuckPerms de forma assíncrona e registra somente o tipo/status do evento, sem exibir a chave. Confirme o resultado pela API, sem imprimir a credencial:

```bash
curl -sS -H "x-integration-key: $(sudo awk -F= '$1==\"INTEGRATION_API_KEY\"{print $2; exit}' /etc/mcbridge/backend.env)" \
  'https://api.seudominio.com.br/api/integration/player?username=Jogador' \
  | grep -Eo '"(username|lastKnownRank|discordUserId)"[[:space:]]*:[[:space:]]*"?[A-Za-z0-9_ -]*"?'
```

O rank deve aparecer como `lastKnownRank` com o nome do grupo LuckPerms. Depois confirme no Discord o cargo correspondente e o embed no `DISCORD_LOG_CHANNEL_ID`. Uma consulta com rank `null` significa que o jogador ainda não gerou um evento de entrada/heartbeat com grupo válido; verifique se ele entrou após o reinício e se `LuckPerms=true` aparece no log.

## 12. Ativar e desativar quando quiser

Para ativar o backend e o bot depois de uma parada planejada:

```bash
sudo systemctl start mcbridge-backend
sleep 5
sudo systemctl start mcbridge-discord
sudo systemctl is-active mcbridge-backend mcbridge-discord
```

Para desativar somente o bot e o backend, sem tocar no Minecraft, no Pterodactyl, no site ou no painel:

```bash
sudo systemctl stop mcbridge-discord mcbridge-backend
```

Para impedir que iniciem automaticamente no boot:

```bash
sudo systemctl disable mcbridge-discord mcbridge-backend
```

Para reativar o início automático:

```bash
sudo systemctl enable mcbridge-backend mcbridge-discord
```

O plugin Paper é controlado pelo ciclo do servidor Minecraft no Pterodactyl. Para desativá-lo, pare o servidor, remova ou renomeie o JAR em `plugins/` e inicie novamente. Não remova o JAR enquanto o Paper estiver em execução.

## 13. Atualizar uma instalação existente

Faça backup e valide o repositório antes de atualizar:

```bash
cd /opt/mcbridge/app
sudo -u mcbridge git status --short
sudo -u mcbridge git pull --ff-only origin main
sudo -u mcbridge pnpm install --frozen-lockfile
sudo -u mcbridge pnpm --dir discord-bot install --frozen-lockfile
sudo -u mcbridge pnpm build
sudo systemctl restart mcbridge-backend
sudo systemctl restart mcbridge-discord
```

Atualize o plugin Paper copiando um novo JAR, mas mantenha uma cópia do JAR anterior e do `config.yml`. Nunca substitua as chaves por valores de exemplo.

## 14. Validação final

| Teste | Comando ou ação | Resultado esperado |
|---|---|---|
| Backend local | `systemctl is-active mcbridge-backend` | `active` |
| Porta segura | `ss -lntup \\| grep ':3100'` | `127.0.0.1:3100` |
| API pública | `curl ... /api/integration/health` sem chave | `401 Unauthorized` |
| Bot | `systemctl is-active mcbridge-discord` | `active` e login no log |
| Paper | Console do Minecraft | plugin habilitado |
| Discord | `/server` e `/players` no Discord | resposta com status e jogadores |
| Bridge | mensagem no chat Minecraft | mensagem no canal configurado |
| Sincronização LuckPerms | alterar grupo de jogador vinculado | cargo VIP atualizado e log no canal de auditoria |
| Site e painel | `curl -I` nos domínios existentes | continuam respondendo normalmente |

Os comandos `/server`, `/players`, `/link` e `/mc status` devem ser executados no **Discord**, não no console do Paper. O console do Minecraft aceita comandos Paper/Minecraft, enquanto os slash commands são registrados pelo bot no Discord.

## 15. Diagnóstico rápido

| Sintoma | Causa provável | Ação |
|---|---|---|
| API retorna `502` | Backend parado ou proxy apontando para porta errada | Verifique `systemctl status mcbridge-backend` e `proxy_pass` |
| API retorna `401` sem chave | Comportamento esperado | Teste com o bot ou plugin, que enviam a chave |
| Bot retorna `401` no Discord | Token inválido ou antigo | Gere **Reset Token** e atualize apenas `bot.env` |
| Bot retorna `Used disallowed intents` | Message Content Intent desativado | Ative o intent no Developer Portal |
| Plugin retorna `ConnectException` | URL errada, DNS ou rede do container | Use o domínio HTTPS, nunca `localhost` |
| Plugin retorna `401` | Chave diferente entre backend e plugin | Gere ou copie a mesma chave sem expô-la |
| Site ou painel pararam após Nginx | Configuração conflitante | Restaure o backup do Nginx e não altere os blocos existentes |

## Referências

[1]: https://github.com/isacaobr19999/Bot-Discord--Minecraft "Repositório oficial do projeto"

[2]: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html "systemd.service — documentação oficial"

[3]: https://docs.papermc.io/paper/ "PaperMC — documentação oficial"

[4]: https://discord.com/developers/docs/topics/gateway#privileged-intents "Discord — Privileged Gateway Intents"

[5]: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/ "NGINX — reverse proxy"
