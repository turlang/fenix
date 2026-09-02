# Changelog

Este documento registra **mudanças efetivamente implementadas** no Fênix. Visão, arquitetura resumida, requisitos e modelo de negócio ficam no [`README.md`](README.md); fases futuras e prioridades ficam no [`ROADMAP.md`](ROADMAP.md).

O projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

## [Unreleased]

> Itens desta seção já foram incorporados ao código em `main`, mas ainda não foram consolidados em uma versão estável/tag de release. Objetivos futuros não pertencem ao changelog.

### Adicionado

- Shared Core VTT-agnóstico e adapters Foundry/standalone.
- Autenticação, campanhas, memberships e multiplayer realtime.
- Persistência PostgreSQL com `PostgresFenixRepository`.
- Coordenação distribuída com `CampaignRuntimeRegistry`, leases, fencing e `PostgresStateBus`.
- Roteamento owner-aware para HTTP e WebSocket, incluindo reconexão após mudança de owner.
- Autenticação interna HMAC-SHA256 para comunicação entre réplicas.
- Idempotência distribuída com `PostgresCommandLedger` e implementação em memória para desenvolvimento single-instance.
- Observabilidade de runtime, métricas Prometheus e endpoints `/ready`, `/metrics` e `/v1/runtime/observability`.
- Migração JSON → PostgreSQL e integrações distribuídas no CI.
- Scene Manager standalone com upload de mapas, persistência, pan/zoom e calibração de grade.
- Importação autenticada de battlemap remoto com cópia para storage local e validações SSRF/formato/tamanho.
- Authoring de Walls + Doors com persistência autoritativa por cena.
- `scene-vision` com ray-casting, line-of-sight, células visíveis e memória de exploração por personagem.
- Fog of War por cena, preview do Mestre e visão derivada do token autorizado do jogador.

### Alterado

- `server.js` concentra infraestrutura externa enquanto `SessionDirector` permanece desacoplado dessas implementações.
- Runtimes persistentes validam ownership/lease antes de operações relevantes.
- Comandos realtime com `commandId` são deduplicados antes de reaplicar efeitos; resultados confirmados podem ser reproduzidos por ACK.
- Cliente standalone gera `commandId` para comandos de sessão relevantes.
- Proxy HTTP preserva autenticação e idempotency key; owner reaplica autenticação e membership.
- Mudança de geração invalida owner obsoleto e força recuperação segura da conexão.
- `/health` e `/ready` refletem componentes de routing/idempotência necessários à operação.
- CI cobre Node 20/22/24, PostgreSQL 16, coordenação distribuída, idempotência, routing, autenticação, WebSocket e build standalone.
- Scene Manager suporta arquivo local ou URL importada.
- Cenas autoritativas carregam e sincronizam `walls`.
- Alterações de geometria de grade invalidam memória de exploração quando as células deixam de representar as mesmas posições.
- `SCENE_UPDATED` invalida catálogo local para recarga segura de estado específico da membership.

### Segurança

- Tokens reutilizáveis de sessão/convite permanecem em hash em repouso.
- `generation` atua como fencing token monotônico contra processamento por owner obsoleto.
- Comunicação interna exige assinatura, timestamp recente e hop válido.
- Reutilização incompatível de `commandId` é recusada; resultados ambíguos não são reexecutados automaticamente.
- Ledger armazena hash canônico do request e dados necessários ao replay, sem persistir o body original.
- Métricas públicas evitam expor detalhes internos de owners/sources.
- Importação remota restringe protocolo, redes privadas, redirects, DNS, timeout, tamanho, assinatura e dimensões para reduzir SSRF e abuso.
- Alterações autoritativas de Walls/Doors e Fog permanecem GM-only.
- Geometria é normalizada novamente no Engine com limites e validação de IDs/bounds.
- Memória de exploração é derivada server-side de movimento autorizado e isolada por personagem.
- Ausência de token válido mantém o Fog fechado de forma segura.

### Compatibilidade e limitações atuais

- Regra alpha.24 de correlação por número da sala permanece no adapter Foundry.
- `FENIX_ALLOW_LEGACY_SESSION_HTTP` mantém o caminho legado conforme configuração.
- Chamadas sem idempotency key continuam aceitas, mas não recebem retry automático em timeout ambíguo.
- Driver JSON permanece single-instance e usa ledger em memória.
- Mapas importados por URL tornam-se cópias locais, sem dependência permanente do host remoto.
- Walls + Doors standalone não altera a lógica Foundry alpha.24.
- Fog/LOS ainda não representa colisão física, fontes de luz, darkvision, elevação ou iluminação dinâmica.
- Outbox durável/garantia de entrega de eventos realtime continua fora do conjunto implementado registrado nesta seção.

## [0.1.0-alpha.24] - 2026-07-21

### Alterado

- Transições passam a usar exclusivamente o número da sala como chave de correlação.
- O Journal é escolhido pela relação com o nome da cena e pela seção numerada encontrada em suas páginas.
- O vínculo individual do marcador com página ou Journal não participa mais da busca.
- O fallback para o primeiro read-aloud foi removido das transições para impedir a narração da sala errada.

## [0.1.0-alpha.23] - 2026-07-21

### Corrigido

- Sessão ativa é recuperada automaticamente ao recarregar o Foundry.
- Salas amplas usam a Note numerada mais próxima quando o token não toca o ícone.
- Distância máxima de detecção passa a acompanhar a escala da grade.
- Logs de verificação de transição ficam visíveis no nível padrão do console.

## [0.1.0-alpha.22] - 2026-07-21

### Corrigido

- Geometria de Notes passa a considerar `x/y` como centro do ícone no Foundry.
- Área mínima de detecção ampliada para duas células, cobrindo a entrada da sala.
- O cliente do GM agora processa movimentos iniciados pelos jogadores.
- Detecção também é reagendada em `canvasReady` e `updateNote`.
- CORS permite Foundry em endereços privados de rede local na porta `30000`.
- Logs indicam quantidade de tokens, Notes e ausência de read-aloud correspondente.

## [0.1.0-alpha.21] - 2026-07-21

### Corrigido

- O botão de início consulta o status do Engine antes de abrir uma sessão.
- Sessões já ativas são reconectadas sem nova chamada a `/v1/session/start` e sem abertura duplicada.
- O rastreamento de salas e ações volta a ser ativado após atualizar o navegador ou recarregar o módulo.

## [0.1.0-alpha.20] - 2026-07-21

### Corrigido

- CORS agora permite por padrão o Foundry local em `localhost:30000` e `127.0.0.1:30000`.
- O preflight de `/v1/session/start`, `/room-entry` e `/action` volta a receber o cabeçalho de origem permitido.

## [0.1.0-alpha.19] - 2026-07-21

### Adicionado

- Captura automática de ações enviadas por jogadores no chat do Foundry.
- Verificação da sessão ativa e proteção contra flood de requisições.
- Classificação de intenções sociais, combate, investigação, movimento e ações gerais.
- Extração de alvos e nível de confiança da classificação.
- Resolução básica de dificuldade, efeito e relacionamento com NPCs.
- Cinco testes de resolução em `test/action-resolution.test.js`.

### Alterado

- Prompt de resolução passou a usar atores presentes, alvo, regras e disposição do NPC.
- Módulo usa o evento de mensagem criada para capturar com segurança mensagens enviadas pelos clientes dos jogadores.

## [0.1.0-alpha.18] - 2026-07-21

### Adicionado

- Detecção automática de entrada de tokens em Notes de salas.
- Correlação de Notes com páginas de Journal por número, nome ou conteúdo.
- Endpoint `POST /v1/session/room-entry`.
- Narração curta de salas com SafetyGuard, QualityGuard e NoveltyGuard.
- Histórico independente por combinação de cena e sala.
- Reprodução TTS local e transmissão por socket nas transições.
- Cinco cenários automatizados em `test/room-entry.test.js`.

### Alterado

- `NarrationQualityGuard` agora permite configurar encerramento, quantidade mínima de parágrafos e limite mínimo crítico por contexto.
- Engine e módulo Foundry atualizados para a versão alpha.18.

## [0.1.0-alpha.17] - 2026-07-21

### Adicionado

- Configuração centralizada e validada.
- Testes da configuração operacional.
- CI para Node.js 20, 22 e 24.
- Dependabot para npm e GitHub Actions.
- Templates de issues e pull requests.
- Guias de segurança e contribuição.

### Alterado

- CORS passou a aceitar apenas origens configuradas.
- API passou a validar ações e limitar entradas.
- Tratamento de erros passou a ocultar detalhes internos em produção.
- Servidor passou a realizar encerramento controlado.

### Segurança

- Arquivos sensíveis, dependências instaladas e dados gerados foram excluídos da distribuição.