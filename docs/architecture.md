# Arquitetura da plataforma

## Objetivo

A plataforma centraliza a integração entre Minecraft Paper e Discord sem permitir que o plugin ou o bot acessem o banco diretamente. O backend é a autoridade de integração e aplica autenticação, autorização, validação, auditoria e idempotência antes de aceitar qualquer alteração de estado.

## Componentes

| Componente | Responsabilidade | Comunicação permitida |
|---|---|---|
| Plugin Paper | Publicar eventos, reportar status, oferecer vinculação e executar ordens confirmadas | API autenticada do backend |
| Bot Discord | Executar comandos, validar contexto Discord, publicar eventos e solicitar ações autorizadas | API autenticada do backend |
| Backend | Regras de negócio, vínculos, status, permissões, auditoria e fan-out de eventos | Banco de dados e clientes autenticados |
| Contratos internos | Tipos, envelopes e estados compartilhados entre backend, plugin e bot | Código versionado e APIs autenticadas |
| Banco relacional | Persistir identidades, eventos, estados e auditoria | Somente backend |

## Princípios operacionais

O plugin nunca realiza I/O de rede na thread principal. Chamadas HTTP, serialização, retentativas e consultas remotas ocorrem em tarefas assíncronas; efeitos que dependam da API do Paper voltam à thread apropriada depois de concluídos.

O Discord é uma camada de experiência e transporte, não a autoridade de autorização. O bot valida o contexto da guilda e os cargos efetivos; o backend avalia a política configurada e registra a decisão antes de solicitar uma ação ao Minecraft.

Operações críticas devem ser idempotentes. Cada solicitação ou evento possui um identificador único, uma origem, um tipo, uma versão e um estado de processamento. Repetições por timeout ou reconexão não podem criar dois vínculos, duas recompensas ou duas execuções administrativas.

## Fluxo de comunicação

```text
Plugin Paper ── eventos e heartbeat ──> Backend <── comandos e consultas ── Bot Discord
     ^                                          ^                                  |
     └──── ordens confirmadas e idempotentes ───┘                                  |
                                                ^                                  v
                                            Eventos, comandos, vínculos e auditoria Discord
```

## Fonte de verdade inicial

| Dado | Autoridade inicial | Regra |
|---|---|---|
| Identidade Discord | Backend | O ID imutável do Discord é associado ao UUID Minecraft por código temporário. |
| Jogador Minecraft | UUID do Minecraft | O nome é atributo de exibição e nunca chave de vínculo. |
| Usuário Discord | ID imutável do Discord | Nome e apelido são atributos de exibição. |
| Vínculo de contas | Backend | Um vínculo ativo é único por par de identidade. |
| Status do servidor | Plugin Paper | O backend guarda snapshots e considera timeout configurável. |
| Rank | Integração de permissões configurada | A primeira versão trata o rank como dado sincronizado, não como valor editável pelo bot. |
| Ação administrativa | Backend + confirmação do plugin | Só é concluída após resposta de execução do servidor. |

## Hospedagem e tempo real

A API e os clientes de integração podem operar de forma stateless para consultas e mutações convencionais. Recursos que dependam de uma conexão contínua do bot, canal WebSocket persistente ou worker de fila deverão utilizar uma instância única persistente dentro da infraestrutura gerenciada, mantendo todo estado durável no banco. Nenhuma regra essencial pode depender exclusivamente de memória de processo.

## Referências

- [Documentação de desenvolvimento do Paper](https://docs.papermc.io/paper/dev/)
- [Agendamento no Paper](https://docs.papermc.io/paper/dev/scheduler/)
- [Application Commands do Discord](https://docs.discord.com/developers/interactions/application-commands)
- [Permissões do Discord](https://docs.discord.com/developers/topics/permissions)

