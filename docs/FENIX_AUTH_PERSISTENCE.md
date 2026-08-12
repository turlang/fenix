# Fênix — Autenticação, Campanhas, Persistência, Coordenação e Ingress

## Objetivo

A infraestrutura standalone mantém identidade, campanhas, convites e estado realtime fora do navegador, recupera sessões após reinício e permite múltiplas campanhas simultâneas. Com PostgreSQL, o Engine coordena ownership de runtime entre réplicas por lease distribuído, invalida caches por `LISTEN/NOTIFY` e encaminha HTTP/WebSocket para o owner atual sem acoplar essa infraestrutura ao Shared Core.

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

`JsonFileFenixRepository` permanece disponível para desenvolvimento e instalações alpha single-instance. Ele escreve arquivo temporário com permissão restrita e faz `rename` atômico.

```env
FENIX_PERSISTENCE_DRIVER=json
FENIX_STATE_FILE=./data/fenix-state.json
```

JSON não ativa leases, `LISTEN/NOTIFY` nem proxy distribuído.

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
- reconcilia periodicamente estado persistido e ownership distribuído;
- expõe `assertOwnership()` para a camada realtime aplicar fencing sem conhecer PostgreSQL.

## Runtime lease distribuído

Quando o driver é PostgreSQL, `PostgresRuntimeLeaseManager` cria a tabela `fenix_runtime_leases`.

Cada registro contém:

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

`FENIX_INSTANCE_ID` deve ser único por processo/réplica. Para roteamento distribuído, `FENIX_INSTANCE_PUBLIC_URL` deve ser alcançável pelas demais réplicas.

### Aquisição e heartbeat

Antes de iniciar/restaurar uma campanha persistente, a instância precisa adquirir o lease. Enquanto for owner, renova `lease_until` periodicamente. Outra instância recebe `RUNTIME_LEASE_HELD` enquanto o lease estiver válido.

### Fencing token

`generation` é um fencing token monotônico. Quando um lease expirado é retomado, a geração aumenta — inclusive se a retomada usar o mesmo `owner_id`.

Antes de operações narrativas persistentes o registry chama `assertOwned()` com a geração registrada no runtime local. A camada realtime também executa `assertOwnership()` antes de cada comando recebido, cobrindo `TOKEN_MOVE`, `SCENE_UPDATE`, `ACTION_SUBMIT`, sync e demais mensagens de uma conexão já aberta.

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

A instância antiga falha em `assertOwned()` com `RUNTIME_LEASE_LOST` e remove seu runtime do registry local. Em WebSocket já estabelecido, o transporte encerra a conexão obsoleta com close code `1012` para forçar nova resolução do owner.

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

## Owner-Aware Runtime Routing

`OwnerAwareRuntimeRouter` fica na composition layer. Ele consulta o lease atual e classifica a rota como:

- `local`: esta instância possui o lease válido;
- `remote`: outra instância possui o lease válido;
- `unowned`: não existe lease ativo para a campanha.

### Configuração

```env
FENIX_INTERNAL_ROUTING_SECRET=troque-por-segredo-aleatorio-com-32-ou-mais-caracteres
FENIX_RUNTIME_ROUTING_TIMEOUT_MS=5000
FENIX_RUNTIME_ROUTING_MAX_RETRIES=1
```

O mesmo secret deve ser compartilhado somente entre as réplicas do Engine. Sem secret, o roteamento distribuído fica desabilitado e o comportamento continua local-only.

### Autenticação Engine → Engine

Cada requisição interna usa headers assinados:

- `x-fenix-route-hop`;
- `x-fenix-route-source`;
- `x-fenix-route-generation`;
- `x-fenix-route-timestamp`;
- `x-fenix-route-signature`.

A assinatura HMAC-SHA256 cobre origem, geração, timestamp, método HTTP, path e SHA-256 do body canônico.

O receptor exige:

- secret válido;
- timestamp dentro da janela aceita;
- assinatura em tempo constante;
- `hop === 1`;
- generation compatível com o lease atual.

Uma tentativa de injetar headers internos sem HMAC válido recebe `RUNTIME_ROUTING_AUTH_INVALID`. Uma requisição que já possui hop interno nunca cria um segundo proxy, prevenindo loops entre réplicas.

A assinatura interna **não substitui autenticação do usuário**. Cookie e `Authorization` originais são preservados, e o owner executa as mesmas regras de sessão/membership.

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
CampaignRuntime
```

Se o owner responder explicitamente que perdeu ownership, o ingress reconsulta o lease e pode repetir o comando para uma nova `generation`, respeitando `FENIX_RUNTIME_ROUTING_MAX_RETRIES`.

Timeouts e falhas de rede não são tratados como prova de que a mutação não ocorreu; isso evita retry cego de ações potencialmente já processadas.

### WebSocket

O browser permanece conectado ao Engine público escolhido pelo balanceador. Se ele não for owner, essa instância cria um WebSocket interno assinado para o owner e encaminha frames nos dois sentidos.

```text
Browser
   ⇅
Engine B / ingress
   ⇅ proxy WS assinado
Engine A / owner
   ⇅
RealtimeSessionGateway
```

O proxy possui buffer limitado durante abertura e retry limitado quando o handshake indica mudança de owner/generation. Se um socket já estabelecido perde ownership, o owner obsoleto fecha com `1012`. O `FenixRealtimeClient` reconecta com backoff limitado no **mesmo endpoint público**, permitindo que o ingress resolva novamente o owner — inclusive quando o próprio ingress se tornou o novo owner.

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
  → OwnerAwareRuntimeRouter resolve tráfego para o owner atual
```

Cena, tokens, revisão, sala atual e histórico recente são recuperados; presença continua efêmera e é reconstruída conforme os browsers reconectam.

## Shutdown seguro

No encerramento normal o Engine:

1. persiste snapshots realtime;
2. fecha o Fastify para parar a entrada de novas requisições;
3. interrompe reconciliação/heartbeat;
4. libera os leases que ainda possui;
5. fecha `LISTEN` e pool PostgreSQL.

Isso reduz a janela de split-brain durante deploy/shutdown normal. Em crash abrupto, o failover depende da expiração do TTL do lease.

## Limite distribuído atual: idempotência de comandos

Ownership, cache invalidation, failover e encaminhamento HTTP/WebSocket já estão coordenados. A fronteira seguinte é tratar falhas **ambíguas** de rede.

Exemplo:

```text
Ingress envia ACTION_SUBMIT
        ↓
Owner processa a ação
        ↓
resposta se perde na rede
        ↓
Ingress não sabe se é seguro repetir
```

Sem um registro distribuído de `commandId`/idempotency key, repetir automaticamente esse comando poderia produzir consequência narrativa ou mutação duplicada. Por isso o roteador só faz retry automático em erros explícitos de ownership e não promete exactly-once em timeout/unreachability.

A próxima etapa deve adicionar idempotência persistente por campanha/sessão/comando e observabilidade de routing/lease antes de ampliar a política de retry.

## Compatibilidade Foundry

O módulo Foundry alpha.24 continua usando os endpoints existentes. Em desenvolvimento, `FENIX_ALLOW_LEGACY_SESSION_HTTP=true` preserva o caminho legado. Em produção ele fica fechado por padrão.

A regra alpha.24 de correlação por número da sala continua no adapter Foundry e não foi movida para o Shared Core.

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
- HTTP enviado ao não-owner e processado pelo owner correto;
- WebSocket enviado ao não-owner e proxyado ao owner correto;
- HMAC interno forjado rejeitado;
- reconnect do cliente após `1012`;
- auth/campanhas HTTP reais;
- WebSocket base real;
- `npm ci` com lockfile público;
- build Next.js de produção;
- workflow somente-leitura (`contents: read`).
