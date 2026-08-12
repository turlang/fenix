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
```

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
- várias campanhas ativas simultaneamente dentro da mesma instância do Engine;
- `RealtimeSessionHub` isolado por `sessionId`;
- WebSocket `/v1/realtime` com autoridade GM/Player;
- `ROOM_ENTERED` e ações pelo mesmo Shared Core;
- recuperação das sessões persistidas após restart sem repetir aberturas;
- JSON local ou PostgreSQL transacional como adapters de persistência.

## PostgreSQL e migração

`PostgresFenixRepository` preserva o contrato dos serviços atuais e usa pool, transação, advisory lock de inicialização e `SELECT ... FOR UPDATE` nas mutações. O estado continua em uma linha JSONB versionada nesta fase de transição.

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
- `npm run test:postgres-integration`: duas instâncias concorrentes contra PostgreSQL real.
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
- PostgreSQL protege mutações concorrentes do repository, mas **horizontal scaling completo ainda não está concluído**: os serviços mantêm caches em memória e ainda não há lease distribuído de ownership do runtime.

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
               ↓                                            todos os peers
       RealtimeSessionHub
               ↓
      CampaignRuntimeRegistry
        │       │       │
     Mesa A  Mesa B  Mesa C
        └───────┼───────┘
                ↓
      Persistence Repository
         JSON | PostgreSQL
```

`SessionDirector` continua sem conhecer Foundry, autenticação, banco, Fastify, WebSocket, React ou WebGL.

## CI

A CI #168 foi concluída com sucesso: 94/94 testes no Node 24, matriz Node 20/22/24 verde, PostgreSQL 16 real, auth/campanhas HTTP, WebSocket real, `npm ci` e build Next aprovados. O workflow final usa somente `contents: read`.

Veja `docs/FENIX_AUTH_PERSISTENCE.md` para os limites e a evolução distribuída. Os `README-ALPHA*.md` preservam o histórico anterior.
