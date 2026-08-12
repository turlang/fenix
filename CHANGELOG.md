# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

## [Unreleased]

### Adicionado

- Shared Core VTT-agnóstico, adapters Foundry/standalone, narração, áudio, autenticação, campanhas e multiplayer realtime.
- `PostgresFenixRepository`, `CampaignRuntimeRegistry`, `PostgresRuntimeLeaseManager` e `PostgresStateBus` para persistência, ownership, fencing, failover e invalidação entre Engines.
- `OwnerAwareRuntimeRouter` para resolver o owner atual e encaminhar comandos HTTP para a réplica correta.
- Proxy WebSocket owner-aware que mantém o browser no endpoint público e cria canal interno para o owner.
- Autenticação interna HMAC-SHA256 com `generation`, timestamp, método, path, hash do body e hop único.
- Retry limitado quando um erro explícito de ownership indica mudança de owner/generation.
- Reconnect limitado do cliente realtime após `1012 Runtime owner changed`.
- Integração real com PostgreSQL e dois Engines provando HTTP/WebSocket enviados ao não-owner e executados no owner correto.
- Testes de assinatura adulterada/expirada, prevenção de proxy em cadeia e headers internos forjados.
- Migração segura JSON → PostgreSQL, integrações HTTP/WebSocket e build standalone no CI.

### Alterado

- `server.js` compõe persistência, leases, invalidation e routing apenas na camada externa; `SessionDirector` continua sem conhecer essas implementações.
- Runtimes persistentes validam lease/fencing antes de operações narrativas e cada comando realtime aberto passa por `assertOwnership()`.
- O proxy HTTP preserva Cookie/Authorization e o owner reaplica autenticação e membership.
- Requests já roteados não criam segundo proxy; mudança de geração retorna `RUNTIME_OWNER_CHANGED`.
- Owner realtime obsoleto encerra a conexão com `1012`; o browser reconecta ao mesmo endpoint público para nova resolução do owner.
- `/health` reporta quando o routing owner-aware está habilitado.
- CI exige matriz Node 20/22/24, PostgreSQL 16, coordenação distribuída, owner-aware routing, auth, WebSocket e build Next.

### Segurança

- Tokens reutilizáveis de sessão/convite permanecem apenas em hash em repouso.
- `generation` é fencing token monotônico para impedir um owner antigo de continuar processando a campanha.
- Roteamento interno exige assinatura, timestamp recente e hop exatamente igual a um; headers forjados são recusados.
- Timeouts de proxy não são repetidos cegamente: sem idempotência distribuída, falha de resposta não prova que uma mutação deixou de ser processada.

### Compatibilidade

- A regra alpha.24 de correlação por número da sala permanece no adapter Foundry.
- `FENIX_ALLOW_LEGACY_SESSION_HTTP` mantém o caminho Foundry conforme configuração.
- JSON continua single-instance sem lease/LISTEN/routing.
- PostgreSQL coordena ownership, cache invalidation, failover e encaminhamento ao owner; a próxima fronteira é idempotência distribuída e observabilidade de comandos.

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
