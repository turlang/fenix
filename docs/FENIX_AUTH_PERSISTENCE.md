# Fênix — Autenticação e Persistência de Campanhas

## Objetivo

Este marco remove a autoridade de GM/jogador da URL do cliente standalone e torna contas, campanhas, convites, sessão narrativa e mundo realtime recuperáveis após reinício do processo.

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
- O token reutilizável não é gravado em disco; somente seu hash SHA-256 é persistido.
- O cookie é `HttpOnly` e `Secure` em produção.
- Desenvolvimento usa `SameSite=Lax` por padrão.
- Produção usa `SameSite=None` por padrão para permitir frontend/API em sites distintos; deployments same-site podem optar por `Lax` ou `Strict`.

## Bootstrap

A instalação começa sem usuários. `POST /v1/auth/bootstrap` cria exatamente o primeiro usuário. O `AuthService` possui trava em memória para impedir duas requisições concorrentes de se tornarem o primeiro usuário.

Depois da primeira conta, o bootstrap fecha com `AUTH_BOOTSTRAP_CLOSED`.

## Campanhas e papéis

Uma campanha possui:

- proprietário (`ownerUserId`);
- membros;
- papel `gm` ou `player` por membro;
- `actorId` obrigatório para jogador;
- sessão narrativa ativa opcional.

O GM pode mover qualquer token, iniciar/encerrar a sessão e trocar cena. O jogador só pode mover e agir como o `actorId` atribuído à sua membership. Essa regra é aplicada no servidor HTTP e no gateway realtime.

## Convites

Convites de jogador:

- são criados somente por GM;
- reservam um `actorId`;
- possuem token aleatório;
- persistem somente o hash do token;
- expiram;
- podem ser usados uma única vez;
- são enviados pelo cliente no fragmento `#invite=...`, evitando colocar o segredo no path/query HTTP e em logs comuns de servidor.

O browser troca o fragmento por um POST explícito para inspeção/aceite.

## Persistência alpha

`JsonFileFenixRepository` é o adapter persistente atual. Ele escreve o estado em arquivo temporário com permissão restrita e faz `rename` atômico para o caminho final.

Por padrão:

```env
FENIX_STATE_FILE=./data/fenix-state.json
```

O arquivo contém hashes de senha/token, contas, campanhas, memberships, convites, sessão ativa e snapshots realtime. Ele é ignorado pelo Git.

### Limite operacional

Este adapter é apropriado para **uma instância do Engine** durante a fase alpha. Ele não implementa locking distribuído, transações multi-instância ou coordenação horizontal. Em Render, o caminho precisa estar em Persistent Disk para sobreviver a substituição do container.

A futura implementação `PostgresFenixRepository` deverá implementar o mesmo contrato sem alterar `AuthService`, `CampaignService`, `PersistentSessionService` ou `SessionDirector`.

## Recuperação de sessão

Ao iniciar o Engine:

```text
JsonFileFenixRepository.initialize()
  → AuthService.initialize()
  → CampaignService.initialize()
  → localizar activeSession
  → runtime.restore(sessionId, snapshot)
  → SessionDirector.restore()
  → COLLECTING_ACTIONS
  → hidratar RealtimeSessionHub
```

`SessionDirector.restore()` não executa `createOpening()`. Portanto um restart/deploy não repete automaticamente a abertura da cena.

O snapshot realtime restaura:

- cena;
- tokens;
- revisão;
- sala atual de cada token;
- histórico recente de narração.

Presença não é persistida: cada browser precisa reconectar e gerar presença nova.

## Compatibilidade Foundry

O módulo Foundry alpha.24 continua usando os endpoints HTTP existentes. Em desenvolvimento, `FENIX_ALLOW_LEGACY_SESSION_HTTP` é `true` por padrão. Em produção, o padrão é `false`; habilite-o explicitamente apenas durante a transição do adapter Foundry.

Isso preserva a integração atual sem permitir que o VTT standalone use o caminho legado para contornar autenticação.

## Gates

O CI verifica:

- senha/token não persistidos em texto puro;
- apenas um bootstrap concorrente;
- convite one-time;
- tentativa de elevar `role`/trocar `actorId` ignorada pelo authorizer autenticado;
- mesma `sessionId` após restart sem nova abertura;
- hidratação do estado realtime;
- integração HTTP real de auth/campanhas;
- integração WebSocket real;
- build Next.js de produção.
