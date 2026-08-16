# Contrato de integração inicial

## Envelope de evento

Todo evento entre plugin, bot e backend deverá seguir um envelope versionado. O payload específico do evento deve ser mínimo e validado no receptor.

```ts
type IntegrationEvent<TPayload> = {
  id: string;
  type: string;
  version: 1;
  origin: "minecraft" | "discord" | "backend";
  occurredAt: string;
  correlationId?: string;
  idempotencyKey: string;
  payload: TPayload;
};
```

## Eventos da primeira versão

| Tipo | Origem | Finalidade | Recuperável |
|---|---|---|---|
| `server.heartbeat` | Minecraft | Atualiza conectividade, TPS, uptime e jogadores online. | Sim |
| `player.joined` | Minecraft | Registra entrada e atualiza presença. | Sim |
| `player.left` | Minecraft | Registra saída e finaliza presença. | Sim |
| `link.code.created` | Minecraft ou Discord | Registra código temporário de vinculação. | Não |
| `link.completed` | Backend | Notifica plataformas sobre vínculo confirmado. | Sim |
| `admin.command.requested` | Discord | Solicita uma operação administrativa autorizada. | Sim |
| `admin.command.completed` | Minecraft | Confirma resultado de execução administrativa. | Sim |

## Regras de segurança

Cada cliente de integração recebe uma credencial própria, revogável e limitada ao ambiente. Tokens do Discord, credenciais de pagamento e segredos de plugin não entram nos clientes, nos logs ou no repositório.

Solicitações administrativas devem carregar um correlation ID, o ID imutável do executor no Discord, a guilda, os cargos avaliados, o escopo de permissão solicitado e parâmetros validados. A trilha de auditoria registra a solicitação, a decisão e o resultado, sem armazenar valores secretos.

## Código de vinculação

O código é gerado pelo backend, armazenado apenas como hash, associado à identidade de origem e expirado por tempo. Sua confirmação deve ocorrer em transação: o código é marcado como consumido e os vínculos são criados no mesmo fluxo. Uma tentativa posterior, mesmo com o mesmo valor, falha de forma segura.

## Estratégia de falhas

Em caso de indisponibilidade do backend, o plugin mantém o funcionamento do servidor e não bloqueia comandos de jogo. Eventos configurados como recuperáveis podem ser mantidos em uma fila local limitada e reenviados com backoff. Ordens administrativas não confirmadas permanecem pendentes ou falham de forma explícita; nunca devem ser tratadas como concluídas apenas porque foram encaminhadas.

