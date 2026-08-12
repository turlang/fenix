# Mestre Orc / Fênix Engine

Versão base `0.1.0-alpha.24` — Node.js 20–24, Foundry VTT 13 e Fênix VTT standalone.

## Preview

![Preview do Mestre Orc Engine](docs/preview.svg)

O projeto mantém um Shared Core VTT-agnóstico para contexto, intenção, regras, relacionamentos, narração e áudio. O Foundry VTT continua como adapter de primeira classe, enquanto `apps/fenix-vtt` executa o mesmo Core como cliente standalone com Next.js, WebGL2, contas, campanhas, multiplayer e persistência PostgreSQL opcional.

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
```

`FENIX_INSTANCE_ID` deve ser único por réplica. `FENIX_INSTANCE_PUBLIC_URL` precisa ser alcançável pelas demais réplicas. O mesmo `FENIX_INTERNAL_ROUTING_SECRET` deve ser compartilhado somente entre os Engines autorizados. Sem o secret, o Engine continua em modo local-only mesmo usando PostgreSQL.

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
- autenticação com `scrypt` e token opaco;
- campanhas/memberships/convites;
- `CampaignRuntimeRegistry` com runtime isolado por campanha;
- várias campanhas ativas simultaneamente;
- `PostgresRuntimeLeaseManager` com um único dono por campanha;
- fencing token monotônico por `generation` para invalidar owners antigos;
- heartbeat, expiração e takeover da mesma `sessionId` após perda do owner;
- `PostgresStateBus` com `LISTEN/NOTIFY` para invalidar caches entre Engines;
- refresh de `AuthService` e `CampaignService` sem reiniciar processo;
- `OwnerAwareRuntimeRouter` para encaminhar HTTP ao owner atual do lease;
- proxy WebSocket transparente entre o ingress escolhido pelo balanceador e o owner;
- HMAC interno, timestamp, generation e hop único para autenticar Engine→Engine e impedir loops;
- retry limitado quando o owner muda antes da conclusão do comando;
- fencing antes de cada comando realtime, inclusive movimento de token e troca de cena;
- reconnect automático do browser após `1012 Runtime owner changed`;
- `RealtimeSessionHub` isolado por `sessionId`;
- `ROOM_ENTERED` e ações pelo mesmo Shared Core;
- recuperação das sessões persistidas após restart/failover sem repetir aberturas;
- JSON local ou PostgreSQL transacional como adapters de persistência.

## PostgreSQL, ownership e owner-aware ingress

`PostgresFenixRepository` preserva o contrato dos serviços atuais e usa pool, transação, advisory lock de inicialização e `SELECT ... FOR UPDATE` nas mutações. O estado continua em uma linha JSONB versionada nesta fase de transição.

Quando PostgreSQL está ativo, o Engine também cria `fenix_runtime_leases`. Um lease registra campanha, owner, `sessionId`, `generation` e prazo de validade. A geração funciona como fencing token: uma instância que perdeu ownership não consegue continuar processando comandos com uma geração antiga.

O `PostgresStateBus` mantém uma conexão dedicada em `LISTEN fenix_state_changed`. Alterações persistidas publicam notificações best-effort depois do `COMMIT`; uma falha do canal de notificação não desfaz uma gravação já confirmada. A reconciliação periódica continua como proteção contra notificações perdidas.

### Roteamento HTTP

Uma requisição pode cair em qualquer Engine:

```text
Browser / Foundry
       ↓
Load Balancer
       ↓
Engine B
       ↓
resolve lease no PostgreSQL
       ↓
owner = Engine A
       ↓
proxy interno assinado
       ↓
Engine A
       ↓
CampaignRuntime
```

O proxy preserva a autenticação original do usuário. O owner executa novamente as mesmas regras de auth/membership; a assinatura interna não substitui autorização de usuário.

Cada hop interno transporta HMAC-SHA256 sobre origem, `generation`, timestamp, método, path e hash do body. O hop aceito é exatamente `1`, impedindo cadeias de proxy entre Engines. Se a geração mudou durante o encaminhamento, o ingress re-resolve o lease e pode repetir uma vez para o novo owner conforme configuração.

### Roteamento WebSocket

O navegador continua conectado ao endpoint público que recebeu o upgrade. Se essa réplica não for owner, ela cria um WebSocket interno assinado para o owner e encaminha frames nos dois sentidos.

```text
Browser
   ⇅ WebSocket público
Engine B / ingress
   ⇅ WebSocket interno HMAC
Engine A / owner
   ⇅
RealtimeSessionGateway
```

Cada comando recebido pelo owner passa novamente por `assertOwnership()`. Se o lease for perdido, o socket antigo é encerrado com `1012`; o cliente standalone faz reconnect limitado no mesmo endpoint público, que resolve novamente o owner atual.

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
- `npm run test:auth-integration`: auth/campanhas no Fastify real.
- `npm run test:realtime-integration`: WebSocket real.
- `npm run test:postgres-integration`: duas instâncias concorrentes do repository contra PostgreSQL real.
- `npm run test:coordination-integration`: dois Engines, lease, LISTEN/NOTIFY, takeover e fencing contra PostgreSQL real.
- `npm run test:routing-integration`: dois Engines reais; HTTP e WebSocket chegam ao não-owner e são encaminhados ao owner.
- `npm run migrate:postgres`: migra JSON para PostgreSQL vazio.
- `npm run validate`: valida fronteiras/estrutura.
- `npm run check`: validação + Core tests.

## Segurança e operação

- Nunca versione `.env`, estado persistido ou `node_modules`.
- Senhas usam `scrypt` + salt; tokens reutilizáveis de sessão/convite não ficam em texto puro.
- Cookies são `HttpOnly` e `Secure` em produção.
- WebSocket valida `Origin`, payload e rate limit.
- Jogador não escolhe `role`/`actorId` pela URL e não controla recursos de outra membership.
- O HTTP legado Foundry permanece disponível apenas conforme `FENIX_ALLOW_LEGACY_SESSION_HTTP`.
- PostgreSQL protege mutações concorrentes do repository.
- Apenas o owner de um lease válido pode processar uma campanha persistente.
- Requisições internas precisam de HMAC válido, timestamp recente, `generation` e hop único.
- Cabeçalhos internos forjados são recusados; o proxy não cria cadeias recursivas.
- O shutdown fecha o ingress antes de liberar leases, reduzindo a janela de split-brain durante desligamento normal.
- `LISTEN/NOTIFY` acelera invalidação, mas a reconciliação periódica é a recuperação para notificações perdidas.

### Limite atual: idempotência em falha ambígua

O roteamento owner-aware evita executar deliberadamente no owner errado e só faz retry automático quando recebe um erro explícito de ownership antes da conclusão. Ainda não existe um ledger distribuído de idempotência que permita repetir cegamente uma mutação quando a rede cai **depois** de o owner processar a ação, mas **antes** de o proxy receber a resposta.

Por isso timeouts/unreachability não são tratados como garantia de “não processado”. A próxima evolução deve introduzir `commandId`/idempotency records persistentes e observabilidade de roteamento antes de qualquer política mais agressiva de retry.

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
       ├── resolve lease
       │
       ├─ local owner ───────────────┐
       │                             │
       └─ remote owner → HMAC proxy ─┤
                                     ↓
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
                    │ state + leases + LISTEN       │
                    └───────────────────────────────┘
```

`SessionDirector` continua sem conhecer Foundry, autenticação, banco, Fastify, WebSocket, React, WebGL, leases, `LISTEN/NOTIFY` ou roteamento entre Engines.

## CI

O gate deste marco exige 102 testes no Node 24, matriz Node 20/22/24, PostgreSQL 16 real, concorrência do repository, lease/failover, owner-aware HTTP/WebSocket routing entre dois Engines, tentativa de assinatura interna forjada, auth/campanhas HTTP, WebSocket base, `npm ci` e build Next. O workflow permanece somente-leitura (`contents: read`).

Veja `docs/FENIX_AUTH_PERSISTENCE.md` para detalhes de persistência, coordenação e ingress. Os `README-ALPHA*.md` preservam o histórico anterior.
