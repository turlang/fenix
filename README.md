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

Para PostgreSQL:

```env
FENIX_PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@host:5432/fenix
FENIX_POSTGRES_POOL_MAX=10
FENIX_RUNTIME_LEASE_TTL_MS=15000
FENIX_RUNTIME_HEARTBEAT_MS=5000
FENIX_RUNTIME_RECONCILE_MS=5000
```

Cada réplica pode receber `FENIX_INSTANCE_ID` único e `FENIX_INSTANCE_PUBLIC_URL` opcional. Se `FENIX_INSTANCE_ID` for omitido, o Engine gera um UUID no boot. Também configure `GROQ_API_KEY`, `GROQ_MODEL`, CORS e autenticação conforme `.env.example`.

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
- `RealtimeSessionHub` isolado por `sessionId`;
- WebSocket `/v1/realtime` com autoridade GM/Player;
- `ROOM_ENTERED` e ações pelo mesmo Shared Core;
- recuperação das sessões persistidas após restart/failover sem repetir aberturas;
- JSON local ou PostgreSQL transacional como adapters de persistência.

## PostgreSQL, coordenação e migração

`PostgresFenixRepository` preserva o contrato dos serviços atuais e usa pool, transação, advisory lock de inicialização e `SELECT ... FOR UPDATE` nas mutações. O estado continua em uma linha JSONB versionada nesta fase de transição.

Quando PostgreSQL está ativo, o Engine também cria `fenix_runtime_leases`. Um lease registra campanha, owner, `sessionId`, geração e prazo de validade. A geração funciona como fencing token: uma instância que perdeu ownership não consegue continuar processando ações com um token antigo.

O `PostgresStateBus` mantém uma conexão dedicada em `LISTEN fenix_state_changed`. Alterações persistidas publicam notificações best-effort depois do `COMMIT`; uma falha do canal de notificação não desfaz uma gravação já confirmada. A reconciliação periódica continua como proteção contra notificações perdidas.

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
- Apenas o owner de um lease válido pode processar action/room/end de uma campanha persistente.
- O shutdown fecha o ingress antes de liberar leases, reduzindo a janela de split-brain durante desligamento normal.
- `LISTEN/NOTIFY` acelera invalidação, mas a reconciliação periódica é a fonte de recuperação quando uma notificação for perdida.

### Limite de roteamento

Ownership/failover distribuído está implementado, mas **roteamento transparente para o owner ainda não está**. Se uma requisição HTTP/WebSocket cair em uma réplica que não possui o runtime, ela não é automaticamente proxyada para a réplica dona. Em produção horizontal, use afinidade/roteamento owner-aware até existir a camada de ingress distribuído do Fênix.

## Módulo Foundry

Copie `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A lógica alpha.24 permanece no módulo: correlação por número da sala, Journal relacionado e read-aloud seguro. Essa regra não foi movida para o Shared Core.

## Arquitetura validada

```text
Foundry VTT --------------------------┐
                                     ├→ VTT Contracts → Shared Core → NarrationOutput
Conta → Campaign Membership → VTT ---┘                       │
               │                                             ├→ texto
               ↓                                             └→ áudio
       RealtimeSessionGateway                                     ↓
               ↓                                            peers da sessão
       RealtimeSessionHub
               ↓
      CampaignRuntimeRegistry
               │
        assert lease/fence
               ↓
   PostgresRuntimeLeaseManager
               │
       ┌───────┴────────┐
       │   PostgreSQL   │
       │ leases + JSONB │
       └───────┬────────┘
               │ LISTEN/NOTIFY
       PostgresStateBus
        ↙             ↘
    Engine A       Engine B
```

`SessionDirector` continua sem conhecer Foundry, autenticação, banco, Fastify, WebSocket, React, WebGL, leases ou `LISTEN/NOTIFY`.

## CI

A pipeline exige matriz Node 20/22/24, suíte unitária, PostgreSQL 16 real, concorrência do repository, integração distribuída de dois Engines com takeover/fencing/cache invalidation, auth/campanhas HTTP, WebSocket real, `npm ci` e build Next. O workflow permanece somente-leitura (`contents: read`).

Veja `docs/FENIX_AUTH_PERSISTENCE.md` para detalhes de persistência e coordenação. Os `README-ALPHA*.md` preservam o histórico anterior.
