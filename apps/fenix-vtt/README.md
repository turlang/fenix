# Fênix VTT — Authenticated Standalone

Este diretório contém o cliente VTT standalone do Projeto Fênix. Ele consome o mesmo Shared Core usado pela integração Foundry e mantém regras, IA, autenticação e persistência fora da árvore React.

## Stack

- Next.js 15 / App Router.
- React 19.
- Tailwind CSS 4 via PostCSS.
- Canvas WebGL2 atrás de `MapRendererPort`.
- Engine HTTP por `FenixApiClient`.
- Multiplayer por `FenixRealtimeClient` / WebSocket.
- Browser Speech Synthesis como fallback local de áudio.

## Executar localmente

Na raiz:

```bash
npm ci
```

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run dev:vtt
```

O VTT usa `http://localhost:3000` e o Engine `http://localhost:3001` por padrão. Outro Engine pode ser definido em `.env.local`:

```env
NEXT_PUBLIC_FENIX_API_URL=http://localhost:3001
```

## Primeiro acesso

1. Abra o VTT.
2. Se ainda não existem contas, a interface apresenta **Ativar primeiro Mestre**.
3. O bootstrap cria a primeira conta e recebe cookie de sessão HttpOnly.
4. Crie uma campanha.
5. Entre na campanha e inicie a sessão.
6. Como GM, escolha um personagem no painel de convite e gere o link one-time.
7. O jogador abre o link, entra/cria conta e recebe a membership vinculada ao `actorId` reservado.

O convite fica no fragmento `#invite=...`; o segredo não é colocado na query HTTP do Engine.

## Autoridade

O navegador não define mais papel por URL. A conexão `/v1/realtime` envia somente:

- `sessionId`;
- `clientId`.

O servidor usa o cookie autenticado para obter `userId` e a membership da campanha para definir `role` e `actorId`.

- GM: inicia/encerra sessão, controla cena e qualquer token.
- Player: controla somente o token/ações do seu `actorId`.

A UI também esconde/desabilita controles indevidos, mas a regra definitiva fica no servidor.

## Persistência e restart

A campanha mantém uma sessão narrativa ativa e o Engine restaura a mesma `sessionId` no restart. `SessionDirector.restore()` não chama `createOpening()`, portanto a abertura da cena não é repetida automaticamente.

O estado realtime recupera cena, tokens, revisão, sala atual e histórico recente. Presença é efêmera e reaparece quando os browsers reconectam.

## Fronteira obrigatória

```text
React/App Router → API/Realtime clients → Engine application layer → Shared Core
Canvas → MapRendererPort → WebGL2
Auth UI → HTTP cookie → AuthService/CampaignService
```

Nenhum componente do VTT pode importar `RulesService`, `NarrationService`, Groq, `SessionDirector` ou código Foundry. `scripts/validate.mjs` verifica essa fronteira.

## Gates

- `node:test` em Node 20/22/24;
- testes de segredo em repouso, bootstrap, convite e restart;
- lockfile portátil;
- `npm ci` público;
- integração HTTP auth/campanha;
- integração WebSocket real;
- `npm run build:vtt`.
