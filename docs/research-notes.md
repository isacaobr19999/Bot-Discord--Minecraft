# Notas de pesquisa técnica

## Paper: agendamento e thread principal

A documentação de desenvolvimento do Paper apresenta o agendador Bukkit e diferencia tarefas síncronas na thread principal de tarefas assíncronas fora dela. A arquitetura do plugin deverá usar execução assíncrona para requisições HTTP, serialização de payloads, retentativas e processamento de respostas. Qualquer interação que a API do servidor exija na thread principal deverá retornar a ela somente após a operação de rede ser concluída.

Referências consultadas:

- [Guia de desenvolvimento do Paper](https://docs.papermc.io/paper/dev/)
- [Agendamento de tarefas no Paper](https://docs.papermc.io/paper/dev/scheduler/)

## Discord: comandos e permissões

Os comandos públicos e administrativos serão implementados como application commands. O backend preservará uma camada própria de autorização para as ações do Minecraft, enquanto o bot verificará o contexto do servidor, os cargos autorizados e as permissões efetivas do Discord antes de encaminhar qualquer operação crítica. Isso evita depender de nomes de cargos ou de permissões hardcoded no código.

Referências consultadas:

- [Application Commands do Discord](https://docs.discord.com/developers/interactions/application-commands)
- [Modelo de permissões do Discord](https://docs.discord.com/developers/topics/permissions)
