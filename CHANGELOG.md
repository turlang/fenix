# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

## [Unreleased]

### Adicionado

- Contratos VTT-agnósticos para snapshot, ações de jogador e entrada de sala.
- `NarrationOutput` genérico e compatibilidade com o publisher do Foundry.
- System Prompt versionado da IA Narradora com política de agência, grounding e marcadores emocionais opcionais.
- Fila de áudio in-memory com prioridade e deduplicação para a futura síntese neural.
- Parser de segmentos emocionais que remove marcadores do texto falado pelo Browser-TTS.
- `StandaloneVttAdapter`, `MapRendererPort`, renderer headless e baseline WebGL2.
- Aplicação `apps/fenix-vtt` executável com Next.js 15, React 19 e Tailwind CSS 4.
- `FenixApiClient`, store standalone, Browser-TTS e vertical slice `ROOM_ENTERED` pelo mesmo Shared Core.
- `RealtimeSessionHub` e `RealtimeSessionGateway` com presença, cena/tokens autoritativos, broadcast de narração/áudio e WebSocket real.
- Autenticação standalone com `AuthService`, senha derivada por `scrypt`, sessão opaca e cookie HttpOnly.
- `CampaignService` com campanhas, memberships GM/Player, `actorId` autoritativo e convites expirantes de uso único.
- `JsonFileFenixRepository` com escrita atômica como fallback local/single-instance.
- `PostgresFenixRepository` com pool, advisory lock de schema, transações e `SELECT ... FOR UPDATE` para mutações concorrentes.
- `CampaignRuntimeRegistry` com runtime isolado por campanha, índice `campaignId ↔ sessionId` e restauração coordenada de mesas ativas.
- `PostgresRuntimeLeaseManager` com TTL, heartbeat, owner por campanha, takeover e fencing token por `generation`.
- `PostgresStateBus` com conexão dedicada `LISTEN/NOTIFY`, reconexão e eventos de invalidação entre Engines.
- Refresh de caches de `AuthService` e `CampaignService` após mudança persistida em outra instância.
- Reconciliação periódica de campanhas/leases para convergência mesmo quando uma notificação for perdida.
- Migração segura `npm run migrate:postgres`, que só importa JSON quando o estado PostgreSQL está vazio.
- Integração PostgreSQL real no CI com duas instâncias concorrentes do repository.
- Integração distribuída real com dois Engines, disputa de lease, expiração, takeover da mesma `sessionId`, fencing e cache invalidation.
- `PersistentSessionService` e `SessionDirector.restore()` para recuperar sessão após restart sem repetir a abertura.
- Gate visual `AuthCampaignGate` com bootstrap do primeiro GM, login, criação/seleção de campanha e aceite de convite.
- Testes de segredo em repouso, bootstrap concorrente, convite one-time, anti-escalation, restauração, hidratação realtime e start concorrente por campanha.
- Integrações reais HTTP de autenticação/campanha e WebSocket Fastify no CI.
- Validação arquitetural que impede a UI standalone de importar regras, Groq, `SessionDirector` ou código Foundry.
- Normalizador/check de `package-lock.json` para impedir URLs de registry privado na distribuição.

### Alterado

- `SessionDirector` depende exclusivamente de `contextPort` e `narrationOutput`, sem dependência nominal do Foundry ou de coordenação distribuída no domínio.
- `server.js` compõe `CampaignRuntimeRegistry`, `PostgresStateBus` e `PostgresRuntimeLeaseManager` apenas nas camadas externas.
- Endpoints `/v1/session/status`, `/action`, `/room-entry` e `/end` são escopados por campanha/sessão no standalone autenticado.
- Cada conexão realtime é roteada ao runtime local correspondente à própria `sessionId` sem alterar o contrato do `RealtimeSessionGateway`.
- Runtimes persistentes validam lease/fencing antes de action, room entry, end e persistência realtime.
- Startup restaura somente campanhas cujo lease a instância consegue adquirir; campanhas já pertencentes a outra réplica ficam marcadas como remotas.
- Após expiração do owner, outra instância pode adquirir o lease e restaurar a mesma `sessionId` sem repetir a abertura.
- `PostgresFenixRepository` publica invalidação best-effort somente após `COMMIT` e liberação do client transacional.
- Shutdown fecha o ingress Fastify antes de liberar leases distribuídos.
- `/health` usa a versão centralizada do Engine e reporta auth/persistence/realtime quando configurados.
- Foundry Adapter continua normalizando estado pelo contrato universal.
- O cliente realtime não transporta `role`, `userId` e `actorId` na URL; o servidor deriva autoridade da sessão autenticada e membership.
- Jogadores têm `actorId` reescrito/autorizado no servidor e não podem iniciar/encerrar sessão ou trocar cena como GM.
- O mundo realtime persiste cena, tokens, salas, revisão e histórico recente; presença continua efêmera.
- Produção fecha o HTTP legado de sessão por padrão; desenvolvimento preserva compatibilidade alpha.24 do Foundry.
- Cookies usam `SameSite=Lax` em desenvolvimento e `None + Secure` por padrão em produção, com configuração explícita disponível.
- Persistência seleciona PostgreSQL quando configurada, mantendo JSON e memória como adapters alternativos.
- CI passa a exigir PostgreSQL 16 real, concorrência do repository, coordenação distribuída de dois Engines, auth/campaign HTTP, WebSocket real e build Next, além da matriz Node.js 20/22/24.

### Segurança

- Tokens reutilizáveis de sessão e convite não são persistidos em texto puro; somente hashes SHA-256 ficam em repouso.
- Bootstrap do primeiro usuário possui trava contra corrida concorrente.
- Registro por convite remove a conta recém-criada caso a reserva do convite falhe antes de concluir a membership.
- `CampaignRuntimeRegistry` bloqueia duas inicializações concorrentes da mesma campanha.
- `generation` aumenta em toda retomada de lease expirado, inclusive pelo mesmo `owner_id`, impedindo reutilização de fencing token antigo.
- Instância que perde o lease recebe `RUNTIME_LEASE_LOST` antes de executar novas operações narrativas persistentes.
- Upgrade WebSocket continua validando `Origin`, tamanho de payload e rate limit por peer.

### Compatibilidade

- `foundryApi` e `publishChat` permanecem como aliases de transição no `session-runtime`, e `postNarration()` permanece como alias no publisher para consumidores alpha.24.
- A regra alpha.24 de correlação por número da sala permanece no adapter Foundry.
- `FENIX_ALLOW_LEGACY_SESSION_HTTP` mantém o caminho HTTP atual do Foundry durante a transição; em produção exige ativação explícita.
- JSON continua operando sem lease/LISTEN para desenvolvimento single-instance.
- PostgreSQL coordena ownership, cache invalidation e failover entre Engines, mas ainda não existe proxy/redirect transparente para encaminhar uma requisição que chegou à réplica não-owner.

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
