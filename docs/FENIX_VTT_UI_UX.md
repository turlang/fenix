# Fênix VTT — Diretriz UI/UX Standalone

## Objetivo

O VTT independente será um cliente do Shared Core Engine, não uma reimplementação das regras narrativas. A primeira versão deve priorizar leitura de mapa, resposta instantânea, controle espacial e baixa carga cognitiva durante a sessão.

## Stack de interface

- Next.js 15 com App Router para shell, autenticação, campanhas e telas administrativas.
- Tailwind CSS para tokens visuais e composição responsiva.
- Canvas de jogo isolado do React DOM por um `MapRendererPort`.
- Backend de renderização com WebGL como baseline e WebGPU quando disponível, selecionado por capability detection.
- WebSocket para presença, movimento de tokens, chat, áudio pronto e eventos de sessão.
- Shared Core consumido por API/eventos; nenhuma regra de RPG deve existir em componentes React.

## Layout principal

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Campaign / Scene        Session State        Voice / Network / FPS   │
├──────────────┬───────────────────────────────────────┬───────────────┤
│ Scene Tree   │                                       │ Context Rail  │
│ Layers       │              MAP STAGE                │ Actors        │
│ Lighting     │         WebGL / WebGPU Canvas         │ Initiative    │
│ Audio        │                                       │ Journal       │
│              │                                       │ AI Director   │
├──────────────┴───────────────────────────────────────┴───────────────┤
│ Chat / Actions / Dice / Quick Command / Narration Timeline          │
└──────────────────────────────────────────────────────────────────────┘
```

## Princípios de experiência

1. **Mapa primeiro:** o canvas ocupa a maior área e nunca deve ser empurrado por painéis permanentes.
2. **Painéis contextuais:** Scene Tree e Context Rail recolhem automaticamente e reaparecem por atalho/hover controlado.
3. **Zero modal durante ação:** ataques, testes, movimento e diálogo usam popovers ou command palette; modal somente para configuração.
4. **Narrativa legível:** narrações aparecem em timeline própria com origem, destinatário e estado de áudio, sem misturar metadados técnicos no texto diegético.
5. **GM e jogador compartilham o mesmo shell:** permissões mudam ferramentas e camadas, não a estrutura inteira da interface.
6. **Acessibilidade operacional:** escala de interface, redução de movimento, alto contraste, navegação por teclado e legendas de áudio.

## MapRendererPort

O React não manipula objetos gráficos individualmente. Ele envia comandos a uma camada de renderização:

```text
loadScene(scene)
setViewport(camera)
upsertToken(token)
removeToken(tokenId)
setFog(fogState)
setLighting(lightingState)
setGrid(gridState)
hitTest(pointer)
render()
```

Isso permite trocar o renderer sem alterar a UI ou o Core.

## Pipeline de frames

- Estado autoritativo de sessão fica fora da árvore visual.
- Atualizações de token são agrupadas antes do próximo frame.
- React recebe somente estado de UI; transformações de câmera/token não provocam re-render completo da aplicação.
- Assets usam atlas/cache, carregamento progressivo e descarte por cena.
- Efeitos caros devem possuir níveis de qualidade e fallback.

## Orçamento de performance

- Objetivo visual: 60 FPS em desktop compatível durante navegação comum.
- Movimento de token não pode disparar chamadas de IA.
- Detecção de zona/sala gera evento somente em transição real, com debounce e deduplicação.
- Áudio neural nunca bloqueia o frame nem o evento de entrada de sala.
- Painéis React devem permanecer independentes do loop do renderer.

## Componentes principais

### Top Bar
Campanha, cena, estado da sessão, conexão, latência e áudio.

### Scene Tree
Cenas, pastas, encontros, zonas e bookmarks do mestre.

### Context Rail
Atores visíveis, alvo atual, iniciativa, condições, NPC ativo, Journal relacionado e ferramentas do AI Director.

### Narration Timeline
Texto entregue, destinatários, replay, legenda, estado `text-ready/audio-processing/audio-ready/fallback` e opção do GM para cancelar áudio ainda não reproduzido.

### Command Palette
Atalhos para trocar cena, selecionar ator, criar encontro, abrir Journal, iniciar/pausar sessão e acionar ferramentas do mestre.

### Player Focus Mode
Modo de baixa distração: mapa + narração + ações rápidas + ficha recolhível.

## Authoring do mapa

Ferramentas de preparação permanecem na toolbar do mapa e só aparecem para o Mestre. Elas não mudam o shell do jogador.

### Grade

`Grade` abre um painel compacto sobre o mapa com preview em tempo real de tamanho, offsets e visibilidade. Salvar persiste a calibração da cena e publica o estado autoritativo quando existe sessão realtime ativa.

### Paredes e portas

`Paredes` abre o authoring de geometria sem modal de tela cheia. O Mestre continua podendo usar pan/zoom enquanto trabalha.

Fluxo:

```text
Paredes
  ↓
Parede | Porta | Alternar porta | Apagar
  ↓
clique inicial → clique final
  ↓
draft local alinhado ao viewport
  ↓
Desfazer | Cancelar | Salvar paredes
  ↓
Scene Manager → SCENE_UPDATED
```

Regras de UX:

- dois cliques definem um segmento, reduzindo arrasto acidental;
- `Snap na grade` é opcional e usa a calibração persistente da cena;
- portas novas podem começar abertas, fechadas ou trancadas;
- `Alternar porta` muda o estado da porta mais próxima;
- `Apagar` seleciona o segmento mais próximo do clique;
- `Desfazer` atua apenas sobre o draft local até `Salvar paredes`;
- `Cancelar` restaura a geometria persistida;
- o overlay de edição é exclusivo do GM;
- jogadores recebem `walls` como estado autoritativo, mas não recebem controles de edição.

A representação visual usa uma camada SVG alinhada ao mesmo viewport do mapa. O modelo persistente continua em coordenadas de mundo e não depende do DOM nem do WebGL.

Colisão, Fog of War e line-of-sight não fazem parte do authoring atual; essas etapas consomem o contrato `scene-geometry` depois que a edição estiver validada isoladamente.

## Mobile

O telefone não tenta reproduzir o desktop inteiro. Funciona como companion:

- ficha e recursos;
- rolagens;
- chat;
- decisões rápidas;
- inventário;
- áudio/legendas;
- seleção de alvo.

O mapa completo continua disponível, mas não é o fluxo principal em telas pequenas. Authoring de paredes pode ser exibido de forma responsiva para o GM, porém o fluxo recomendado continua desktop/tablet por exigir precisão espacial.

## Limite arquitetural

Componentes Next.js nunca importam `RulesService`, `NarrationService`, Groq ou adapters de VTT. A UI conversa com Application/API; o renderer conversa com `MapRendererPort`; o Engine recebe eventos universais definidos em `packages/vtt-contracts`. O contrato puro `scene-geometry` pode ser consumido pelo editor e pelo realtime, mas o `SessionDirector` narrativo não conhece authoring de mapa.
