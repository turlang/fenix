# Fênix — Autenticação, Campanhas, Persistência, Coordenação, Idempotência e Ingress

## Objetivo

A infraestrutura standalone mantém identidade, campanhas, convites e estado realtime fora do navegador, recupera sessões após reinício e permite múltiplas campanhas simultâneas. Com PostgreSQL, o Engine coordena ownership por lease, invalida caches por `LISTEN/NOTIFY`, encaminha HTTP/WebSocket para o owner atual e deduplica comandos distribuídos por `commandId`, sem acoplar essa infraestrutura ao Shared Core.

## Fluxo de identidade

```text
Browser
  → POST /v1/auth/bootstrap | /login | /invites/register
  → token opaco aleatório de 256 bits
  → cookie HttpOnly
  → servidor persiste apenas SHA-256(token)
  → AuthService resolve userId
  → CampaignService resolve membership
  → role + actorId autoritativos
  → Runtime ingress / RealtimeSessionGateway
```

A URL WebSocket transporta somente `sessionId` e `clientId`. `role`, `actorId` e `userId` nunca são aceitos como autoridade do navegador no servidor standalone.

## Credenciais

- Senhas são derivadas com `scrypt`, salt aleatório e comparação em tempo constante.
- O token de sessão é gerado com `randomBytes(32)`.
- O token reutilizável não é gravado em repouso; somente seu hash SHA-256 é persistido.
- O cookie é `HttpOnly` e `Secure` em produção.
- Desenvolvimento usa `SameSite=Lax` por padrão.
- Produção usa `SameSite=None` por padrão para frontend/API em sites distintos; deployments same-site podem escolher `Lax` ou `Strict`.

## Campanhas e papéis

Uma campanha possui proprietário, membros, papel `gm/player`, `actorId` de jogador e sessão narrativa ativa opcional. O GM pode controlar cena e sessão; o jogador só pode mover e agir como o ator atribuído à sua membership. Essa regra é aplicada no servidor HTTP e no gateway realtime.

## Convites

Convites são criados pelo GM, reservam um `actorId`, usam token aleatório, persistem somente seu hash, expiram e são one-time. O cliente transporta o segredo no fragmento `#invite=...` e o troca por POST explícito de inspeção/aceite.

## Adapters de persistência

### JSON — fallback local

`JsonFileFenixRepository` permanece disponível para desenvolvimento e instalações alpha single-instance.

```env
FENIX_PERSISTENCE_DRIVER=json
FENIX_STATE_FILE=./data/fenix-state.json
```

JSON não ativa leases, `LISTEN/NOTIFY` nem proxy distribuído. O command ledger usa memória neste modo e, portanto, idempotência não sobrevive ao restart.

### PostgreSQL — persistência compartilhada

`PostgresFenixRepository` implementa o mesmo contrato `snapshot/read/mutate`, portanto `AuthService` e `CampaignService` não conhecem o driver concreto.

```env
FENIX_PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@host:5432/fenix
FENIX_POSTGRES_POOL_MAX=10
FENIX_POSTGRES_CONNECT_TIMEOUT_MS=5000
FENIX_POSTGRES_IDLE_TIMEOUT_MS=30000
```

O adapter usa pool reutilizável, advisory lock na criação de schema, transação com client dedicado, `SELECT ... FOR UPDATE`, `COMMIT/ROLLBACK` explícitos e publicação de invalidação somente depois do commit.

### Migração JSON → PostgreSQL

```bash
npm run migrate:postgres
```

O script importa JSON somente quando o estado PostgreSQL está vazio.

## CampaignRuntimeRegistry

O Engine mantém um runtime independente por campanha:

```text
campaign-a → runtime A → session A
campaign-b → runtime B → session B
campaign-c → runtime C → session C
```

O registry restaura campanhas cujo lease consegue adquirir, indexa `campaignId ↔ sessionId`, roteia operações ao runtime correto, impede starts concorrentes da mesma campanha, reconcilia estado distribuído e expõe `assertOwnership()` para a borda realtime aplicar fencing sem conhecer PostgreSQL.

## Runtime lease distribuído

`PostgresRuntimeLeaseManager` usa `fenix_runtime_leases` com:

- `campaign_id`;
- `owner_id`;
- `owner_url`;
- `session_id`;
- `generation`;
- `lease_until`;
- `updated_at`.

Configuração típica:

```env
FENIX_INSTANCE_ID=engine-a
FENIX_INSTANCE_PUBLIC_URL=https://engine-a.internal.example.com
FENIX_RUNTIME_LEASE_TTL_MS=15000
FENIX_RUNTIME_HEARTBEAT_MS=5000
FENIX_RUNTIME_RECONCILE_MS=5000
```

`generation` é fencing token monotônico. Quando um lease expirado é retomado, a geração aumenta. Antes de operações persistentes e de cada comando realtime, a camada apropriada valida a ownership atual.

### Failover

```text
Engine A perde lease
        ↓
Engine B reconcilia
        ↓
acquire generation N+1
        ↓
restore mesma sessionId
        ↓
hidrata estado realtime
```

`SessionDirector.restore()` não executa nova abertura. O owner antigo passa a falhar por fencing e sockets obsoletos são encerrados com `1012`.

## Postgres LISTEN/NOTIFY

`PostgresStateBus` mantém `LISTEN fenix_state_changed`. Depois de uma mutação confirmada, outras réplicas atualizam repository/cache de auth/campaign e reconciliam runtimes. A reconciliação periódica continua sendo a recuperação caso uma notificação seja perdida.

## Owner-Aware Runtime Routing

`OwnerAwareRuntimeRouter` consulta o lease e classifica a rota como `local`, `remote` ou `unowned`.

### Configuração

```env
FENIX_INTERNAL_ROUTING_SECRET=troque-por-segredo-aleatorio-com-32-ou-mais-caracteres
FENIX_RUNTIME_ROUTING_TIMEOUT_MS=5000
FENIX_RUNTIME_ROUTING_MAX_RETRIES=1
```

O mesmo secret é compartilhado somente entre Engines autorizados.

### Autenticação Engine → Engine

Headers internos:

- `x-fenix-route-hop`;
- `x-fenix-route-source`;
- `x-fenix-route-generation`;
- `x-fenix-route-timestamp`;
- `x-fenix-route-signature`.

A assinatura HMAC-SHA256 cobre origem, geração, timestamp, método, path e SHA-256 do body canônico. O receptor exige timestamp recente, assinatura válida e `hop === 1`. A assinatura interna nunca substitui autenticação/membership do usuário.

### HTTP

```text
Client
  ↓
Load Balancer
  ↓
Engine B
  ↓ resolve lease
owner = Engine A
  ↓ HMAC proxy
Engine A
  ↓ auth + membership + fence
Command Ledger
  ↓
CampaignRuntime
```

Erros explícitos de ownership permitem re-resolução do lease. Timeout/unreachability só pode ser repetido automaticamente quando há `commandId`/`X-Idempotency-Key`, pois o owner consegue deduplicar o replay.

### WebSocket

```text
Browser
   ⇅
Engine B / ingress
   ⇅ proxy WS assinado
Engine A / owner
   ⇅
Command Ledger → RealtimeSessionGateway
```

O browser permanece no endpoint público. O proxy possui buffer e retry limitados. Se a ownership mudar depois de a conexão estar aberta, o owner antigo fecha com `1012`; o cliente reconecta no mesmo endpoint público e a rota é resolvida novamente.

## Distributed Command Ledger

### Objetivo

Resolver a falha ambígua clássica:

```text
Ingress envia commandId=123
        ↓
Owner produz o efeito
        ↓
resposta se perde
        ↓
Ingress repete commandId=123
        ↓
Owner devolve resultado anterior
sem executar o efeito novamente
```

No PostgreSQL, `PostgresCommandLedger` cria `fenix_command_ledger`. A chave primária é `(scope_key, command_id)`, onde o scope privilegia campanha e usa sessão como fallback.

Campos principais:

- `scope_key`;
- `command_id`;
- `command_type`;
- `session_id`;
- `request_hash`;
- `status`;
- `result_json`;
- `error_code`;
- `owner_id`;
- `generation`;
- timestamps.

O body original não é persistido; somente seu SHA-256 canônico é usado para provar que um replay corresponde à mesma entrada. O resultado confirmado é persistido porque é necessário para reapresentação exata.

### Máquina de estados

```text
claim novo
   ↓
IN_PROGRESS
  ├─ confirmação segura → COMPLETED → replay do result_json
  └─ resultado incerto  → UNKNOWN   → bloquear auto-reexecução
```

Semântica:

- `COMPLETED`: devolve o resultado anterior;
- `IN_PROGRESS`: aguarda por uma janela curta e, se necessário, retorna `COMMAND_IN_PROGRESS`;
- `UNKNOWN`: retorna `COMMAND_OUTCOME_UNKNOWN` e nunca reexecuta automaticamente;
- mesmo `commandId` com outro payload: `COMMAND_ID_CONFLICT`;
- resultado maior que o limite configurado não é considerado replay-safe;
- entradas antigas são removidas conforme retenção configurada.

A criação da tabela usa `pg_advisory_xact_lock`, evitando corrida de catálogo quando várias réplicas inicializam simultaneamente.

### Configuração

```env
FENIX_COMMAND_LEDGER_WAIT_MS=1500
FENIX_COMMAND_LEDGER_UNKNOWN_AFTER_MS=60000
FENIX_COMMAND_LEDGER_RETENTION_HOURS=168
FENIX_COMMAND_LEDGER_RESULT_MAX_BYTES=524288
```

O cliente standalone gera `commandId` para start, action, room-entry e end. Ações realtime já carregam `commandId`. Integrações externas também podem enviar `X-Idempotency-Key`.

### Compatibilidade legada

Chamadas sem idempotency key continuam aceitas para não quebrar Foundry alpha.24. Essas chamadas não recebem retry automático em timeout/unreachability porque não existe prova de que o efeito não ocorreu.

## Observabilidade operacional

`RuntimeObservability` agrega eventos de routing, proxy, retry, command claim, replay, conflito, unknown e failover.

Endpoints:

- `/health`: liveness/capabilities;
- `/ready`: consulta a saúde do ledger e responde 503 quando a dependência não está pronta;
- `/metrics`: contadores e latências em formato Prometheus;
- `/v1/runtime/observability`: somente `startedAt`, counters e latências agregadas.

Detalhes como owner, source, generation e attempts permanecem em logs estruturados do Engine. Eles não são publicados pelo endpoint JSON agregado.

## Recuperação

```text
Repository.initialize()
  → CommandLedger.initialize()
  → PostgresStateBus.initialize()
  → PostgresRuntimeLeaseManager.initialize()
  → AuthService.initialize()
  → CampaignService.initialize()
  → CampaignRuntimeRegistry.initialize()
  → restaurar sessões cujos leases foram adquiridos
  → SessionDirector.restore()
  → hidratar RealtimeSessionHub
  → OwnerAwareRuntimeRouter resolve ingress
```

A tabela do ledger é compartilhada entre réplicas, então replay de `COMPLETED` continua disponível mesmo após troca de owner ou restart do processo.

## Shutdown seguro

No encerramento normal o Engine persiste snapshots, fecha o ingress, interrompe coordenação, libera leases e fecha as conexões externas. Em crash abrupto, takeover depende do TTL do lease; a deduplicação de comandos já confirmados continua no PostgreSQL.

## Limite distribuído atual: entrega de eventos realtime

O command ledger garante deduplicação da **execução** quando um `commandId` é reapresentado. Ele não é um outbox de eventos.

Exemplo restante:

```text
Owner confirma commandId
        ↓
persiste COMPLETED
        ↓
processo cai antes de entregar NARRATION/TOKEN_MOVED a todos os peers
```

Depois do failover, repetir o comando é corretamente deduplicado, mas o broadcast que faltou não possui uma fila durável própria para ser reenviado. A próxima fronteira é **Durable Realtime Outbox + Event Delivery Guarantees**.

## Compatibilidade Foundry

A regra alpha.24 de correlação por número da sala continua no adapter Foundry. `FENIX_ALLOW_LEGACY_SESSION_HTTP` mantém o caminho legado conforme configuração; em produção permanece fechado por padrão.

## Gates

A pipeline valida:

- Core em Node.js 20, 22 e 24;
- suíte `node:test` sem regressões;
- PostgreSQL 16 real;
- repository sem lost update;
- ownership, fencing, takeover e `LISTEN/NOTIFY`;
- inicialização concorrente do command ledger;
- duas réplicas disputando o mesmo `commandId` com uma única execução;
- replay do resultado `COMPLETED` em outra instância;
- `COMMAND_ID_CONFLICT` para payload incompatível;
- `UNKNOWN` bloqueando reexecução automática;
- timeout com commandId podendo ser repetido de forma deduplicável;
- timeout sem commandId continuando fail-closed;
- HTTP/WebSocket enviados ao não-owner e processados no owner;
- HMAC forjado rejeitado;
- reconnect após `1012`;
- auth/campanhas HTTP, WebSocket base e build Next;
- workflow somente-leitura (`contents: read`).
