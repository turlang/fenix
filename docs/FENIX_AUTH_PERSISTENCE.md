# Fênix — Autenticação, Campanhas e Persistência

## Objetivo

A infraestrutura standalone mantém identidade, campanhas, convites e estado realtime fora do navegador e permite recuperar sessões após reinício. O marco atual acrescenta duas capacidades: `PostgresFenixRepository` para persistência transacional e `CampaignRuntimeRegistry` para executar várias campanhas simultaneamente dentro da mesma instância do Engine.

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

### PostgreSQL — produção

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
- uma linha JSONB versionada como formato de transição da alpha.

Assim, duas instâncias do repository podem mutar o mesmo estado sem sobrescrever silenciosamente a atualização concorrente.

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

- restaura todas as campanhas com `activeSession` no boot;
- indexa `campaignId ↔ sessionId`;
- direciona action/room/status/end ao runtime correto;
- impede dois `start` concorrentes para a mesma campanha;
- permite campanhas diferentes iniciarem simultaneamente;
- encerra uma campanha sem derrubar as demais;
- preserva um runtime legado isolado para o adapter Foundry em desenvolvimento.

Cada conexão WebSocket é escopada por `sessionId`, mantendo o `RealtimeSessionGateway` e o protocolo existentes sem introduzir WebSocket no Shared Core.

## Recuperação

```text
Repository.initialize()
  → AuthService.initialize()
  → CampaignService.initialize()
  → CampaignRuntimeRegistry.initialize()
  → restaurar cada activeSession
  → SessionDirector.restore()
  → hidratar RealtimeSessionHub por sessionId
```

`SessionDirector.restore()` não executa `createOpening()`, então restart/deploy não repete automaticamente a abertura. Cena, tokens, revisão, sala atual e histórico recente são recuperados; presença continua efêmera.

## Limite distribuído ainda existente

PostgreSQL torna **as mutações do repository** seguras entre processos e o registry permite **múltiplas campanhas dentro de uma instância do Engine**. Isso ainda não equivale a horizontal scaling completo.

`AuthService` e `CampaignService` mantêm índices/cache em memória após `initialize()`, e não existe ainda lease distribuído para decidir qual Engine possui um runtime ativo. Duas instâncias de aplicação podem compartilhar o banco com segurança de escrita, mas ainda precisam de invalidação/refresh de cache e coordenação de ownership antes de atender a mesma campanha simultaneamente.

A próxima fronteira distribuída é `DistributedRuntimeLease + Postgres LISTEN/NOTIFY (ou outro mecanismo de invalidação)`.

## Compatibilidade Foundry

O módulo Foundry alpha.24 continua usando os endpoints existentes. Em desenvolvimento, `FENIX_ALLOW_LEGACY_SESSION_HTTP=true` preserva o caminho legado. Em produção ele fica fechado por padrão.

## Gates

A CI #167 foi concluída com sucesso em 2026-08-12. O gate provou:

- Core em Node.js 20, 22 e 24;
- 94 testes / 94 aprovados no Node 24;
- isolamento de múltiplos runtimes e bloqueio de start duplicado;
- PostgreSQL 16 real em service container;
- inicialização concorrente do schema;
- duas instâncias de repository mutando o mesmo estado sem lost update;
- auth/campanhas HTTP reais;
- WebSocket real;
- `npm ci` com lockfile público;
- build Next.js de produção;
- workflow final somente-leitura (`contents: read`).
