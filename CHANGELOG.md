# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

## [Unreleased]

### Adicionado

- Shared Core VTT-agnóstico, adapters Foundry/standalone, narração, áudio, autenticação, campanhas e multiplayer realtime.
- `PostgresFenixRepository`, `CampaignRuntimeRegistry`, `PostgresRuntimeLeaseManager` e `PostgresStateBus` para persistência, ownership, fencing, failover e invalidação entre Engines.
- `OwnerAwareRuntimeRouter` para resolver o owner atual e encaminhar comandos HTTP para a réplica correta.
- Proxy WebSocket owner-aware que mantém o browser no endpoint público e cria canal interno para o owner.
- Autenticação interna HMAC-SHA256 com `generation`, timestamp, método, path, hash do body e hop único.
- Reconnect limitado do cliente realtime após `1012 Runtime owner changed`.
- `PostgresCommandLedger` com estados `IN_PROGRESS`, `COMPLETED` e `UNKNOWN`, chave distribuída por scope/`commandId` e replay do resultado confirmado.
- `InMemoryCommandLedger` para desenvolvimento JSON/single-instance com o mesmo contrato lógico.
- SHA-256 canônico do request para detectar reutilização incompatível de `commandId` sem persistir o body original no ledger.
- Retry de timeout/unreachability somente para mutações com `commandId`/idempotency key, preservando fail-closed para chamadas legadas.
- `RuntimeObservability` com contadores, latência, logs estruturados e exportação Prometheus.
- Endpoints `/ready`, `/metrics` e `/v1/runtime/observability`; o endpoint JSON expõe apenas agregados.
- Integração PostgreSQL real com duas instâncias do ledger provando execução única, replay em outra réplica, conflito de payload e bloqueio de outcome desconhecido.
- Advisory transaction lock na criação de `fenix_command_ledger`, evitando corrida de schema durante boot simultâneo de réplicas.
- Migração segura JSON → PostgreSQL, integrações HTTP/WebSocket e build standalone no CI.
- Scene Manager do standalone com upload de PNG/JPG/WEBP, cenas persistentes, background real, pan/zoom e calibração de grade por cena.
- `RemoteMapImporter` e endpoint autenticado para importar battlemap diretamente de URL HTTP/HTTPS e copiar o resultado para o `AssetStorage` local.
- Detecção server-side de formato e dimensões para mapas remotos, preservando o mesmo pipeline de cena usado por upload local.

### Alterado

- `server.js` compõe persistência, leases, invalidation, routing, idempotência, observabilidade, assets e importação remota apenas na camada externa; `SessionDirector` continua sem conhecer essas implementações.
- Runtimes persistentes validam lease/fencing antes de operações narrativas e cada comando realtime passa por `assertOwnership()`.
- Comandos realtime com `commandId` são deduplicados antes de tocar no gateway/hub; replay confirmado emite ACK sem reaplicar o efeito.
- O cliente standalone gera `commandId` para start, action, room-entry e end.
- O proxy HTTP preserva Cookie/Authorization e `X-Idempotency-Key`; o owner reaplica autenticação e membership.
- Requests já roteados não criam segundo proxy; mudança de geração retorna `RUNTIME_OWNER_CHANGED`.
- Owner realtime obsoleto encerra a conexão com `1012`; o browser reconecta ao mesmo endpoint público.
- `/health` reporta routing e driver de idempotência; `/ready` verifica disponibilidade do ledger.
- CI exige matriz Node 20/22/24, PostgreSQL 16, coordenação distribuída, idempotência, owner-aware routing, auth, WebSocket e build Next.
- Validator arquitetural passa a exigir command ledger/observability/routing/importador remoto e impede que essas implementações apareçam no `SessionDirector`.
- O Scene Manager permite escolher `Arquivo` ou `URL`; o modo URL usa dimensões detectadas pelo Engine e não depende de CORS/hotlink depois da importação.

### Segurança

- Tokens reutilizáveis de sessão/convite permanecem apenas em hash em repouso.
- `generation` continua como fencing token monotônico para impedir owner antigo de processar a campanha.
- Roteamento interno exige assinatura, timestamp recente e hop exatamente igual a um; headers forjados são recusados.
- Mesmo `commandId` com payload diferente é recusado com `COMMAND_ID_CONFLICT`.
- Resultado que não pode ser confirmado é marcado `UNKNOWN`; `COMMAND_OUTCOME_UNKNOWN` bloqueia reexecução automática.
- O ledger persiste o hash do request e o resultado necessário ao replay, não o conteúdo original do comando.
- Métricas HTTP públicas não expõem lista recente de owners/sources; esses detalhes ficam somente em logs estruturados.
- Importação remota aceita somente HTTP/HTTPS, bloqueia localhost/redes privadas, fixa o IP após DNS validado e revalida cada redirect para reduzir SSRF/DNS rebinding.
- Mapas remotos obedecem timeout, limite de tamanho, assinatura PNG/JPEG/WEBP e limite de dimensões; a URL completa, query strings e tokens temporários não são persistidos.

### Compatibilidade

- A regra alpha.24 de correlação por número da sala permanece no adapter Foundry.
- `FENIX_ALLOW_LEGACY_SESSION_HTTP` mantém o caminho Foundry conforme configuração.
- Chamadas legadas sem idempotency key continuam aceitas, porém não recebem retry automático de timeout ambíguo.
- JSON continua single-instance sem lease/LISTEN/routing e usa ledger apenas em memória.
- PostgreSQL coordena ownership, cache invalidation, failover, encaminhamento e idempotência de execução; a próxima fronteira distribuída continua sendo outbox durável/garantia de entrega de eventos realtime.
- Mapas por URL são importados como cópia local; não existe dependência permanente do host remoto.

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
