# Fênix VTT — Standalone Live Bridge

Este diretório contém o primeiro cliente VTT standalone executável do Projeto Fênix. Ele consome o mesmo Shared Core usado pela integração Foundry e mantém regras, IA e narração fora da árvore React.

## Stack

- Next.js 15 com App Router.
- React 19.
- Tailwind CSS 4 via PostCSS, coexistindo com os tokens visuais próprios do Fênix.
- Canvas WebGL2 através de `packages/webgl-map-renderer` e do contrato `MapRendererPort`.
- Fênix Engine HTTP através de `FenixApiClient`.
- Browser Speech Synthesis como reprodução local/fallback de áudio.

## Executar localmente

Na raiz do monorepo:

```bash
npm ci
```

Terminal 1 — Engine:

```bash
npm run dev
```

Terminal 2 — VTT:

```bash
npm run dev:vtt
```

O VTT abre em `http://localhost:3000` e o Engine usa `http://localhost:3001` por padrão.

Para apontar o cliente para outro Engine, copie `apps/fenix-vtt/.env.example` para `.env.local` nesse workspace e configure:

```env
NEXT_PUBLIC_FENIX_API_URL=http://localhost:3001
```

## Vertical slice disponível

1. Inicie a sessão pelo topo, envie uma ação ou mova um token; o provider garante uma sessão ativa antes do evento.
2. Selecione/arraste Ayla no mapa.
3. Leve o token para a zona **03 — Câmara Norte**, no nordeste do mapa.
4. A transição gera um evento universal `ROOM_ENTERED`.
5. `FenixApiClient` envia o evento para `/v1/session/room-entry`.
6. O Shared Core aplica contexto, Safety/Quality/Novelty Guards e narração.
7. O texto retorna para a Narration Timeline.
8. A diretiva de áudio entra na fila Browser-TTS sem cancelar a fala já em andamento.

A caixa de comando também envia ações reais para `/v1/session/action`, vinculadas ao ator selecionado.

## Fronteira obrigatória

```text
React/App Router -> Application/API -> Shared Core
Canvas ---------> MapRendererPort -> WebGL2/WebGPU adapter
Standalone state -> HTTP events -> Fênix Engine
```

Nenhum componente desta aplicação pode importar `RulesService`, `NarrationService`, provider Groq, `SessionDirector` ou código do módulo Foundry. Essa regra é verificada por `scripts/validate.mjs` no CI.

## Gates

O CI deve provar, antes de promover esta entrega:

- estrutura e testes em Node.js 20, 22 e 24;
- `package-lock.json` sem URLs de registry privado;
- `npm ci` a partir do registry público;
- import do runtime Fastify;
- `npm run build:vtt` concluído com sucesso.
