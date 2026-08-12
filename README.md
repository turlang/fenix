# Mestre Orc / Fênix Engine

Versão base `0.1.0-alpha.24` — Node.js 20–24, Foundry VTT 13 e Fênix VTT standalone.

## Preview

![Preview do Mestre Orc Engine](docs/preview.svg)

O projeto mantém um Shared Core VTT-agnóstico para contexto, intenção, regras, relacionamentos, narração e áudio. O Foundry VTT continua como adapter de primeira classe, enquanto `apps/fenix-vtt` executa o mesmo Core como cliente standalone com Next.js, WebGL2, contas, campanhas, multiplayer e infraestrutura distribuída opcional sobre PostgreSQL.

## Engine

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run dev
```

Desenvolvimento pode permanecer em JSON:

```env
FENIX_PERSISTENCE_DRIVER=json
FENIX_STATE_FILE=./data/fenix-state.json
```

Para PostgreSQL distribuído:

```env
FENIX_PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@host:5432/fenix
FENIX_POSTGRES_POOL_MAX=10
FENIX_INSTANCE_ID=engine-a
FENIX_INSTANCE_PUBLIC_URL=https://engine-a.internal.example.com
FENIX_INTERNAL_ROUTING_SECRET=troque-por-um-segredo-compartilhado-com-32-ou-mais-caracteres
FENIX_RUNTIME_LEASE_TTL_MS=15000
FENIX_RUNTIME_HEARTBEAT_MS=5000
FENIX_RUNTIME_RECONCILE_MS=5000
FENIX_RUNTIME_ROUTING_TIMEOUT_MS=5000
FENIX_RUNTIME_ROUTING_MAX_RETRIES=1
FENIX_COMMAND_LEDGER_WAIT_MS=1500
FENIX_COMMAND_LEDGER_UNKNOWN_AFTER_MS=60000
FENIX_COMMAND_LEDGER_RETENTION_HOURS=168
FENIX_COMMAND_LEDGER_RESULT_MAX_BYTES=524288
```

`FENIX_INSTANCE_ID` deve ser único por réplica. `FENIX_INSTANCE_PUBLIC_URL` precisa ser alcançável pelas demais réplicas. O mesmo `FENIX_INTERNAL_ROUTING_SECRET` deve ser compartilhado somente entre Engines autorizados. Sem o secret, o Engine continua em modo local-only mesmo usando PostgreSQL.

Também configure `GROQ_API_KEY`, `GROQ_MODEL`, CORS e autenticação conforme `.env.example`.

## Fênix VTT standalone

```powershell
npm run dev:vtt
```

Na primeira abertura, o VTT oferece o bootstrap único do primeiro Mestre. Depois disso, a entrada usa login persistente. O GM cria campanhas e convites one-time ligados a um `actorId`; jogadores controlam apenas o personagem atribuído pelo servidor.

O browser envia somente `sessionId` e `clientId` no WebSocket. `userId`, papel GM/Player e `actorId` são derivados do cookie HttpOnly e da membership.

O fluxo atual possui:

- Next.js 15 + React 19 + Tailwind CSS 4;
- renderer WebGL2 atrás de `MapRendererPort`;
- upload de battlemap PNG/JPG/WEBP e importação segura por URL HTTP/HTTPS;
- pan/zoom, fit de cena e calibração persistente de grid;
- **Walls + Doors Authoring** persistente para o Mestre;
- segmentos `wall` e `door` com estados `open`, `closed` e `locked`;
- snap de paredes à grade, apagar, desfazer, cancelar e sincronização realtime;
- autenticação com `scrypt` e token opaco;
- campanhas/memberships/convites;
- `CampaignRuntimeRegistry` com runtime isolado por campanha;
- várias campanhas ativas simultaneamente;
- `PostgresRuntimeLeaseManager` com um único dono por campanha;
- fencing token monotônico por `generation`;
- heartbeat, expiração e takeover da mesma `sessionId`;
- `PostgresStateBus` com `LISTEN/NOTIFY` para invalidar caches entre Engines;
- `OwnerAwareRuntimeRouter` para encaminhar HTTP ao owner atual;
- proxy WebSocket transparente entre ingress e owner;
- HMAC interno, timestamp, generation e hop único para autenticar Engine→Engine;
- `DistributedCommandLedger` para deduplicar comandos por `commandId` entre réplicas;
- replay do resultado já confirmado após timeout/resposta perdida;
- bloqueio fail-closed de resultados ambíguos com `COMMAND_OUTCOME_UNKNOWN`;
- retry de timeout/unreachability apenas quando a requisição possui idempotency key;
- fencing antes de cada comando realtime;
- reconnect automático do browser após `1012 Runtime owner changed`;
- métricas de routing, dedupe, retry e failover;
- readiness dependente do ledger distribuído;
- `RealtimeSessionHub` isolado por `sessionId`;
- `ROOM_ENTERED` e ações pelo mesmo Shared Core;
- recuperação de sessões após restart/failover sem repetir aberturas;
- JSON local ou PostgreSQL transacional como adapters de persistência.

## Mapas, grade, paredes e portas

O Scene Manager mantém o battlemap, dimensões, grid calibrado e `walls` como estado persistente da cena. O Mestre pode abrir **Paredes** na toolbar e editar a geometria diretamente sobre o mapa usando as mesmas coordenadas de mundo do renderer.

```text
Battlemap
   ↓
Pan / Zoom + Grid Calibration
   ↓
Walls + Doors Authoring
   ├─ wall
   └─ door → open | closed | locked
   ↓
CampaignSceneService
   ↓
persistência + SCENE_UPDATED realtime
```

O contrato puro está em `packages/scene-geometry`. Paredes e portas fechadas/trancadas são definidas como bloqueadoras de movimento e visão; portas abertas não bloqueiam. **Neste marco essa semântica ainda não é aplicada como colisão ou line-of-sight** — ela prepara a próxima etapa de Fog of War + Token Line of Sight sem acoplar o editor ao Shared Core narrativo.

Alteração de paredes é GM-only no servidor. Jogadores recebem a geometria autoritativa da cena, mas não podem persistir `walls` nem publicar `SCENE_UPDATE` de Mestre.

Detalhes do modelo e do editor: `docs/FENIX_WALLS_DOORS.md`.

## PostgreSQL, ownership e owner-aware ingress

`PostgresFenixRepository` preserva o contrato dos serviços atuais e usa pool, transação, advisory lock de inicialização e `SELECT ... FOR UPDATE` nas mutações. O estado principal continua em uma linha JSONB versionada nesta fase de transição.

Quando PostgreSQL está ativo, o Engine também cria `fenix_runtime_leases`. Um lease registra campanha, owner, `sessionId`, `generation` e prazo de validade. A geração funciona como fencing token: uma instância que perdeu ownership não consegue continuar processando comandos com uma geração antiga.

O `PostgresStateBus` mantém uma conexão dedicada em `LISTEN fenix_state_changed`. Alterações persistidas publicam notificações best-effort depois do `COMMIT`; a reconciliação periódica continua como proteção contra notificações perdidas.

### Roteamento HTTP

```text
Browser / Foundry
       ↓
Load Balancer
       ↓
Engine B
       ↓ resolve lease
owner = Engine A
       ↓ HMAC proxy
Engine A
       ↓ auth + membership + fence
DistributedCommandLedger
       ↓
CampaignRuntime
```

O proxy preserva a autenticação original do usuário. O owner executa novamente as regras de auth/membership; a assinatura interna nunca substitui autorização de usuário.

Cada hop interno transporta HMAC-SHA256 sobre origem, `generation`, timestamp, método, path e hash do body. O hop aceito é exatamente `1`, impedindo cadeias de proxy entre Engines.

### Roteamento WebSocket

O navegador permanece conectado ao endpoint público que recebeu o upgrade. Se essa réplica não for owner, ela cria um WebSocket interno assinado para o owner e encaminha frames nos dois sentidos.

```text
Browser
   ⇅ WebSocket público
Engine B / ingress
   ⇅ WebSocket interno HMAC
Engine A / owner
   ⇅
Command Ledger → RealtimeSessionGateway
```

Cada comando recebido pelo owner passa por `assertOwnership()` e, quando possui `commandId`, pelo ledger. Se o lease for perdido, o socket antigo é encerrado com `1012`; o cliente standalone faz reconnect limitado no mesmo endpoint público, que resolve novamente o owner atual.

## Idempotência distribuída de comandos

O PostgreSQL mantém `fenix_command_ledger`, cujo par `(scope_key, command_id)` é único. O payload da requisição não é persistido no ledger; fica apenas seu SHA-256 para detectar reutilização incompatível do mesmo `commandId`. O resultado confirmado é persistido em JSONB para replay seguro.

Estados:

```text
novo commandId
     ↓
IN_PROGRESS
  ┌──┴─────────────────┐
  │                    │
sucesso             resultado incerto
  │                    │
COMPLETED             UNKNOWN
  │                    │
replay exato       nunca auto-reexecutar
```

Regras principais:

- mesmo `commandId` + mesmo payload + `COMPLETED` → devolve o resultado anterior;
- mesmo `commandId` + payload diferente → `COMMAND_ID_CONFLICT`;
- comando já sendo processado → aguarda brevemente ou retorna `COMMAND_IN_PROGRESS`;
- execução cujo resultado não pode ser confirmado → `UNKNOWN` e `COMMAND_OUTCOME_UNKNOWN`;
- `UNKNOWN` não é reaproveitado para uma segunda execução automática;
- inicialização concorrente da tabela é serializada com advisory transaction lock;
- registros antigos são removidos conforme `FENIX_COMMAND_LEDGER_RETENTION_HOURS`.

O cliente standalone gera `commandId` nas mutações de sessão. Clientes externos também podem usar `X-Idempotency-Key`. Requisições legadas sem chave continuam aceitas, mas não recebem retry automático para falhas ambíguas de transporte.

## Observabilidade e readiness

A infraestrutura registra contadores e latência para resolução de owner, proxy HTTP/WS, retry, dedupe, replay, conflitos e failover.

Endpoints operacionais:

- `GET /health`: liveness e capacidades configuradas;
- `GET /ready`: readiness; falha com 503 quando o ledger não responde;
- `GET /metrics`: métricas agregadas em formato Prometheus;
- `GET /v1/runtime/observability`: somente contadores e latências agregadas.

Os detalhes recentes de `ownerId`, `generation` e tentativa permanecem nos logs estruturados do servidor e não são expostos pelo endpoint JSON agregado.

## Migração JSON → PostgreSQL

Para migrar um estado JSON existente para um banco vazio:

```powershell
npm run migrate:postgres
```

O script recusa sobrescrever PostgreSQL que já contenha estado.

## Comandos

- `npm run dev`: inicia API/Engine.
- `npm run dev:vtt`: inicia o Fênix VTT.
- `npm run build:vtt`: build standalone.
- `npm test`: suíte `node:test`.
- `npm run test:auth-integration`: auth/campanhas no Fastify real, incluindo cenas, grid, paredes e mapas remotos.
- `npm run test:realtime-integration`: WebSocket real.
- `npm run test:postgres-integration`: repository contra PostgreSQL real.
- `npm run test:coordination-integration`: dois Engines, lease, LISTEN/NOTIFY, takeover e fencing.
- `npm run test:routing-integration`: HTTP e WebSocket chegam ao não-owner e são encaminhados ao owner.
- `npm run test:idempotency-integration`: dois ledgers PostgreSQL disputam o mesmo `commandId` e provam execução única/replay.
- `npm run migrate:postgres`: migra JSON para PostgreSQL vazio.
- `npm run validate`: valida fronteiras/estrutura.
- `npm run check`: validação + Core tests.

## Segurança e operação

- Nunca versione `.env`, estado persistido ou `node_modules`.
- Senhas usam `scrypt` + salt; tokens reutilizáveis de sessão/convite não ficam em texto puro.
- Cookies são `HttpOnly` e `Secure` em produção.
- WebSocket valida `Origin`, payload e rate limit.
- Jogador não escolhe `role`/`actorId` pela URL e não controla recursos de outra membership.
- Alterações de grid, paredes e portas são autorizadas como GM no servidor, não apenas ocultadas pela UI.
- O HTTP legado Foundry permanece disponível apenas conforme `FENIX_ALLOW_LEGACY_SESSION_HTTP`.
- Apenas o owner de um lease válido pode processar uma campanha persistente.
- Requisições internas precisam de HMAC válido, timestamp recente, `generation` e hop único.
- Cabeçalhos internos forjados são recusados; o proxy não cria cadeias recursivas.
- `commandId` nunca autoriza usuário; auth/membership continuam obrigatórias no owner.
- O ledger grava hash da requisição e resultado necessário ao replay, não o body original do comando.
- O shutdown fecha o ingress antes de liberar leases.
- `LISTEN/NOTIFY` acelera invalidação, mas a reconciliação periódica cobre eventos perdidos.

### Limite atual: entrega durável de eventos realtime

A execução de comandos agora é deduplicada entre réplicas, inclusive após resposta perdida. Porém o broadcast realtime ainda é um efeito do owner em memória: se o processo cair depois de confirmar uma mutação, mas antes de todos os peers receberem o evento correspondente, o ledger impede duplicar o comando, porém não garante a entrega daquele broadcast para cada conexão.

A evolução de infraestrutura para esse ponto continua sendo **Durable Realtime Outbox + Event Delivery Guarantees**, separando confirmação do comando de entrega durável/replay de eventos aos peers.

### Limite atual do mapa: visão e colisão

A geometria de paredes/portas já é persistente e autoritativa, mas ainda não recorta visão nem impede movimento de tokens. A próxima evolução do VTT é **Fog of War + Token Line of Sight**, consumindo o contrato `scene-geometry`; Dynamic Lighting vem depois sobre a mesma base.

## Módulo Foundry

Copie `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A lógica alpha.24 permanece no módulo: correlação por número da sala, Journal relacionado e read-aloud seguro. Essa regra não foi movida para o Shared Core.

## Arquitetura validada

```text
Browser / Foundry
       │
       ↓
Load Balancer
       │
       ↓
 qualquer Engine
       │
       ├── Auth / Membership
       ├── Scene Manager → assets / grid / walls
       ├── resolve lease
       │
       ├─ local owner ───────────────┐
       │                             │
       └─ remote owner → HMAC proxy ─┤
                                     ↓
                           DistributedCommandLedger
                                     │
                          CampaignRuntimeRegistry
                                     │
                              assert lease/fence
                                     ↓
                               Shared Core
                                     │
                           NarrationOutput / Hub
                                     │
                    ┌────────────────┴──────────────┐
                    │ PostgreSQL                    │
                    │ state + leases + ledger       │
                    └───────────────┬───────────────┘
                                    │
                         RuntimeObservability
                         /ready /metrics / logs
```

`SessionDirector` continua sem conhecer Foundry, autenticação, banco, Fastify, WebSocket, React, WebGL, assets, scene authoring, `scene-geometry`, leases, `LISTEN/NOTIFY`, roteamento, command ledger ou observabilidade.

## CI

A pipeline exige matriz Node 20/22/24, suíte unitária, validação do contrato de paredes/portas, PostgreSQL 16 real, concorrência de repository, leases/failover, idempotência distribuída de comandos, owner-aware HTTP/WebSocket routing entre dois Engines, auth/campanhas/cenas HTTP, WebSocket real, `npm ci` e build Next. O workflow permanece somente-leitura (`contents: read`).

Veja `docs/FENIX_WALLS_DOORS.md` para o authoring de mapa e `docs/FENIX_AUTH_PERSISTENCE.md` para persistência, coordenação, ingress, idempotência e observabilidade. Os `README-ALPHA*.md` preservam o histórico anterior.
