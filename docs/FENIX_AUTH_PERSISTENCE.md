# Fênix — Autenticação, Campanhas, Persistência e Coordenação

## Objetivo

A infraestrutura standalone mantém identidade, campanhas, convites e estado realtime fora do navegador, recupera sessões após reinício e permite múltiplas campanhas simultâneas. Com PostgreSQL, o Engine também coordena ownership de runtime entre réplicas por lease distribuído e invalida caches por `LISTEN/NOTIFY`.

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
  → RealtimeSessionGateway
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

`JsonFileFenixRepository` permanece disponível para desenvolvimento e instalações alpha single-instance. Ele escreve arquivo temporário com permissão restrita e faz `rename` atômico.

```env
FENIX_PERSISTENCE_DRIVER=json
FENIX_STATE_FILE=./data/fenix-state.json
```

### PostgreSQL — persistência compartilhada

`PostgresFenixRepository` implementa o mesmo contrato `snapshot/read/mutate`, portanto `AuthService` e `CampaignService` não conhecem o driver concreto.

```env
FENIX_PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@host:5432/fenix
FENIX_POSTGRES_POOL_MAX=10
FENIX_POSTGRES_CONNECT_TIMEOUT_MS=5000
FENIX_POSTGRES_IDLE_TIMEOUT_MS=30000
```

O adapter usa:

- pool reutilizável do `node-postgres`;
- `pg_advisory_xact_lock` para serializar a criação inicial do schema entre processos;
- transação com client dedicado;
- `SELECT ... FOR UPDATE` antes de cada `mutate`;
- `COMMIT/ROLLBACK` explícitos;
- uma linha JSONB versionada como formato de transição da alpha;
- publicação de invalidação somente depois do `COMMIT` e depois de liberar o client da transação.

Assim, duas instâncias do repository podem mutar o mesmo estado sem lost update. Falha de `NOTIFY` não transforma um `COMMIT` já confirmado em falha de aplicação.

### Migração JSON → PostgreSQL

Com `DATABASE_URL` configurada:

```bash
npm run migrate:postgres
```

O script importa o JSON somente quando o estado PostgreSQL está vazio. Se o banco já contém dados, a migração falha fechada em vez de sobrescrevê-los.

## CampaignRuntimeRegistry

O Engine não possui mais um único runtime global. O registry mantém:

```text
campaign-a → runtime A → session A
campaign-b → runtime B → session B
campaign-c → runtime C → session C
```

Ele:

- restaura campanhas persistidas cuja ownership consegue adquirir;
- indexa `campaignId ↔ sessionId` localmente;
- direciona action/room/status/end ao runtime correto;
- impede dois `start` concorrentes para a mesma campanha;
- permite campanhas diferentes iniciarem simultaneamente;
- encerra uma campanha sem derrubar as demais;
- preserva um runtime legado isolado para o adapter Foundry em desenvolvimento;
- reconcilia periodicamente estado persistido e ownership distribuído.

Cada conexão WebSocket é escopada por `sessionId`, mantendo o `RealtimeSessionGateway` e o protocolo existentes sem introduzir WebSocket no Shared Core.

## Runtime lease distribuído

Quando o driver é PostgreSQL, `PostgresRuntimeLeaseManager` cria a tabela `fenix_runtime_leases`.

Cada registro contém:

- `campaign_id`;
- `owner_id`;
- `owner_url` opcional;
- `session_id`;
- `generation`;
- `lease_until`;
- `updated_at`.

Configuração típica:

```env
FENIX_INSTANCE_ID=engine-a
FENIX_INSTANCE_PUBLIC_URL=https://engine-a.example.com
FENIX_RUNTIME_LEASE_TTL_MS=15000
FENIX_RUNTIME_HEARTBEAT_MS=5000
FENIX_RUNTIME_RECONCILE_MS=5000
```

`FENIX_INSTANCE_ID` deve ser único por processo/réplica; quando omitido, o Engine gera UUID no boot.

### Aquisição e heartbeat

Antes de iniciar/restaurar uma campanha persistente, a instância precisa adquirir o lease. Enquanto for owner, renova `lease_until` periodicamente. Outra instância recebe `RUNTIME_LEASE_HELD` enquanto o lease estiver válido.

### Fencing token

`generation` é um fencing token monotônico. Quando um lease expirado é retomado, a geração aumenta — inclusive se a retomada usar o mesmo `owner_id`. Antes de action, room entry, end e persistência realtime, o registry chama `assertOwned()` com a geração registrada no runtime local.

Isso impede que uma instância antiga continue processando a campanha depois de um takeover.

### Failover

Quando o lease expira:

```text
Engine A perde/expira lease
        ↓
Engine B reconcilia
        ↓
acquire campaign lease
        ↓
generation N → N+1
        ↓
restore mesma sessionId
        ↓
hidrata RealtimeSessionHub
```

O `SessionDirector.restore()` não executa `createOpening()`, então o takeover não repete automaticamente a abertura da cena.

A instância antiga falha em `assertOwned()` com `RUNTIME_LEASE_LOST` e remove seu runtime do registry local.

## Postgres LISTEN/NOTIFY e invalidação de cache

`PostgresStateBus` mantém uma conexão dedicada em:

```sql
LISTEN fenix_state_changed;
```

Após mutações persistentes, o origin publica um evento `STATE_CHANGED` usando `pg_notify`. A outra instância:

1. recebe a notificação;
2. executa `repository.refresh()`;
3. reconstrói os índices do `AuthService`;
4. reconstrói os índices do `CampaignService`;
5. reconcilia runtimes/leases.

Eventos originados pela própria instância são ignorados pelo listener. O canal possui reconexão automática em caso de erro.

`NOTIFY` é aceleração, não a única garantia de convergência: a reconciliação periódica continua verificando o banco, cobrindo notificações perdidas e períodos de reconexão.

## Recuperação

```text
Repository.initialize()
  → PostgresStateBus.initialize()
  → PostgresRuntimeLeaseManager.initialize()
  → AuthService.initialize()
  → CampaignService.initialize()
  → CampaignRuntimeRegistry.initialize()
  → adquirir leases disponíveis
  → restaurar activeSessions pertencentes à instância
  → SessionDirector.restore()
  → hidratar RealtimeSessionHub por sessionId
```

Cena, tokens, revisão, sala atual e histórico recente são recuperados; presença continua efêmera e cada browser precisa reconectar.

## Shutdown seguro

No encerramento normal o Engine:

1. persiste snapshots realtime;
2. fecha o Fastify para parar a entrada de novas requisições;
3. interrompe reconciliação/heartbeat;
4. libera os leases que ainda possui;
5. fecha `LISTEN` e pool PostgreSQL.

Isso reduz a janela de split-brain durante deploy/shutdown normal. Em crash abrupto, o failover depende da expiração do TTL do lease.

## Limite distribuído ainda existente: ingress

Ownership, cache invalidation e failover de runtime já estão coordenados entre Engines. Ainda não existe **proxy/redirect automático de comandos para o owner**.

Portanto, se um load balancer enviar uma action ou WebSocket para uma réplica que não possui aquela campanha, a réplica reconhece o runtime como remoto, mas não encaminha automaticamente a operação à réplica dona. Para operação horizontal, use afinidade/roteamento owner-aware até existir essa camada.

Essa limitação é intencionalmente separada do Shared Core e do `SessionDirector`.

## Compatibilidade Foundry

O módulo Foundry alpha.24 continua usando os endpoints existentes. Em desenvolvimento, `FENIX_ALLOW_LEGACY_SESSION_HTTP=true` preserva o caminho legado. Em produção ele fica fechado por padrão.

## Gates

A pipeline valida:

- Core em Node.js 20, 22 e 24;
- suíte `node:test` sem regressões;
- PostgreSQL 16 real em service container;
- inicialização concorrente do schema;
- duas instâncias de repository sem lost update;
- dois Engines disputando a mesma campanha;
- rejeição do segundo owner enquanto o lease está válido;
- takeover após expiração com incremento de `generation`;
- bloqueio da instância antiga por fencing;
- restauração da mesma `sessionId` no novo owner;
- `LISTEN/NOTIFY` atualizando caches de auth e campanhas;
- auth/campanhas HTTP reais;
- WebSocket real;
- `npm ci` com lockfile público;
- build Next.js de produção;
- workflow somente-leitura (`contents: read`).
