# Fênix VTT — Token Collision + Dynamic Lighting

## Objetivo

Este marco transforma a geometria persistente de Walls + Doors em física de movimento e iluminação dinâmica no VTT standalone. Colisão e luz são capacidades espaciais da cena; não fazem parte do Shared Core narrativo nem do `SessionDirector`.

## Colisão autoritativa

O browser continua enviando a posição desejada do token, mas a posição final é decidida pelo `RealtimeSessionHub` usando `packages/scene-collision`.

```text
Browser pede TOKEN_MOVE
        ↓
RealtimeSessionGateway
        ↓
posição anterior + posição desejada
        ↓
resolveTokenMovement()
        ↓
Walls + Doors autoritativas
        ↓
última posição segura
        ↓
TOKEN_MOVED para todos os peers
```

O token é tratado como um círculo para evitar que o centro atravesse uma parede enquanto parte do token ainda a sobrepõe. O sweep percorre o segmento do movimento e refina por busca binária a última posição segura quando encontra um bloqueador.

### Regras atuais

- `wall` bloqueia movimento de jogador;
- `door:closed` bloqueia movimento de jogador;
- `door:locked` bloqueia movimento de jogador;
- `door:open` permite movimento;
- Mestre/GM possui noclip administrativo e ignora paredes/portas ao mover tokens;
- o noclip do Mestre não ignora os limites externos da cena;
- os limites da cena limitam o centro do token para Mestre e jogador;
- jogador continua autorizado apenas a mover seu próprio `actorId`;
- a posição transmitida e persistida é sempre a posição aceita pelo servidor.

O bypass do Mestre é decidido novamente pelo `RealtimeSessionHub` a partir da identidade autenticada `role=gm`; não existe flag de noclip confiada ao navegador. O client replica a mesma política apenas para manter a interação local consistente antes da sessão realtime iniciar.

O evento `TOKEN_MOVED` inclui metadados de diagnóstico:

```json
{
  "collision": {
    "blocked": true,
    "boundaryAdjusted": false,
    "wallId": "wall-1",
    "fraction": 0.36
  }
}
```

Se uma tentativa de movimento de jogador é bloqueada, qualquer `roomEntry` enviado junto é ignorado. Assim uma parede não pode ser atravessada apenas para disparar narração de uma sala do outro lado.

## Guarda local de colisão

A validação física mostrou um caso importante: quando a sessão ainda está em `IDLE`, não existe WebSocket autoritativo para corrigir um drag local. O VTT agora aplica o mesmo `resolveTokenMovement()` antes de aceitar a posição final no cliente para jogadores; para o Mestre usa `{ ignoreWalls: true }`, preservando somente os bounds da cena.

Isso cria duas barreiras complementares:

```text
Arraste / WASD
     ↓
Client movement policy
     ├─ jogador: colisão completa
     └─ Mestre: noclip de paredes
     ↓
posição local aceita
     ↓
RealtimeSessionHub (quando conectado)
     ↓
segunda validação pela identidade autenticada
```

Portanto, uma parede salva bloqueia o jogador mesmo antes de `Iniciar sessão`; quando a sessão está ativa, o servidor continua sendo a autoridade final. O Mestre atravessa paredes nos dois modos.

## Controles gamer de teclado

O token autorizado/selecionado pode ser movimentado por teclado:

- `W` ou `↑`: cima;
- `A` ou `←`: esquerda;
- `S` ou `↓`: baixo;
- `D` ou `→`: direita;
- movimento normal: 20% de uma célula por evento de tecla;
- `Shift + direção`: uma célula completa;
- manter a tecla pressionada usa o repeat normal do navegador;
- atalhos são ignorados enquanto o foco está em `input`, `textarea`, `select`, botão ou conteúdo editável;
- Mestre move o ator selecionado em noclip de paredes/portas;
- jogador continua limitado ao próprio `actorId` e à colisão da cena.

Arraste e teclado passam pela mesma política local e depois pela mesma autoridade realtime quando a sessão está conectada.

## Zoom por scroll

O zoom do mapa por roda do mouse é registrado diretamente no `canvas` com `addEventListener('wheel', ..., { passive: false })`. Isso permite cancelar o scroll da página com `preventDefault()` sem provocar o erro do Chrome `Unable to preventDefault inside passive event listener invocation`.

O listener é removido no cleanup do componente e recriado quando a cena/dimensões mudam. O cálculo de zoom continua usando `zoomViewportAt()`, preservando o ponto do mundo sob o cursor e os mesmos limites de zoom usados pelos botões `+` e `−`.

O gate `test/vtt-render-stability.test.js` exige o listener nativo não-passivo, o cleanup correspondente, o `preventDefault()` legítimo e a ausência de `onWheel={handleWheel}` no canvas.

## Fog of War e colisão

O registro de exploração continua acontecendo depois do comando realtime e usa `result.token.x/y`. Como `result.token` já contém a posição resolvida pelo Collision Engine, uma tentativa bloqueada não revela células atrás da parede.

### Estabilidade durante drag

A exploração transitória do Fog é idempotente: se o token continua vendo exatamente o mesmo conjunto de células, o estado React existente é reutilizado em vez de criar um novo array. O conjunto de tokens usado pelo Dynamic Lighting durante o drag também é memoizado. Isso impede ciclos de renderização durante `pointermove` e evita o erro `Maximum update depth exceeded` observado no Chrome durante a validação física.

O hotfix possui um gate de regressão específico em `test/vtt-render-stability.test.js` e passa pelo mesmo pipeline completo de CI antes de nova validação física.

## Dynamic Lighting

A configuração persistente da cena agora possui:

```text
lighting.enabled
lighting.darkness
lighting.sources[]
```

Cada fonte possui:

- `id` e `name`;
- posição `x/y` quando fixa;
- `radiusCells`;
- `intensity`;
- `color` hexadecimal;
- `enabled`;
- `attachedTokenId` opcional.

São aceitas no máximo 128 fontes por cena.

### Luz e LOS

`packages/scene-lighting` reutiliza `packages/scene-vision`. Cada fonte gera um polígono de visibilidade limitado pelo raio e pelos mesmos segmentos usados no Fog.

```text
Fonte de luz
     ↓
scene-vision / ray casting
     ↓
wall            → sombra
closed door     → sombra
locked door     → sombra
open door       → luz atravessa
     ↓
polígono de luz
     ↓
SVG overlay alinhado ao viewport
```

A camada visual aplica escuridão ambiente e recorta as regiões iluminadas com os polígonos de LOS. Fog continua acima da iluminação, portanto uma fonte de luz não revela automaticamente áreas que o personagem ainda não pode ver.

O editor sincroniza o estado persistido por uma assinatura estável do conteúdo de `scene.lighting`, e não pela identidade do objeto React. Isso evita resets e atualizações recursivas quando um objeto semanticamente igual é reconstruído pela camada de composição.

## Fontes anexadas a tokens

Quando `attachedTokenId` está definido, a origem efetiva é a posição realtime do token. O `x/y` persistido permanece como fallback caso o token não esteja presente no snapshot.

Isso permite tochas, lanternas e auras móveis sem criar um segundo protocolo de movimento.

## Editor do Mestre

O mapa exibe um controle flutuante **Luz OFF/ON** somente para o Mestre. O painel permite:

- ativar/desativar Dynamic Lighting;
- ajustar escuridão ambiente;
- adicionar/remover fontes;
- escolher cor;
- ajustar raio e intensidade;
- posicionar fonte fixa por X/Y;
- anexar fonte a qualquer token presente;
- ativar/desativar uma fonte individual.

Alterações são persistidas por:

```text
POST /v1/campaigns/:campaignId/scenes/:sceneId/lighting
```

A autorização é GM-only no Engine, não apenas na interface.

## Arquitetura

```text
scene-geometry
   ├── scene-collision
   └── scene-vision
          └── scene-lighting

CampaignSceneService
   └── lighting persistente

RealtimeSessionHub
   ├── movimento autorizado
   ├── collision resolution / GM noclip
   └── TOKEN_MOVED autoritativo

React / SVG
   └── DynamicLightingOverlay
```

`SessionDirector` não conhece colisão, fontes de luz, ray casting, React, WebGL, Fastify ou persistência de cena.

## Gates automatizados

O marco possui gates para:

- colisão por parede e portas fechadas/trancadas para jogador;
- passagem por porta aberta;
- noclip do Mestre através de paredes mantendo bounds da cena;
- limites da cena;
- room-entry bloqueado quando o movimento do jogador não atravessa a parede;
- guarda local de colisão mesmo sem realtime;
- mapeamento WASD/setas e passo com Shift;
- proteção para não capturar teclado em campos de texto;
- wheel zoom por listener nativo não-passivo, sem `onWheel` passivo do React;
- normalização e persistência de iluminação;
- sombras por LOS;
- fonte anexada a token;
- autorização HTTP GM-only para iluminação;
- fronteira arquitetural mantendo colisão/iluminação fora do `SessionDirector`;
- estabilidade de renderização do Fog e do editor de iluminação durante drag.

## Limites deliberados deste marco

Ainda não fazem parte desta entrega:

- elevação/Z e paredes com altura;
- darkvision/infravision ou outros sentidos especiais;
- cones direcionais de luz;
- soft shadows fisicamente calculadas;
- oclusão por tokens;
- propagação volumétrica;
- shaders PBR;
- regras específicas de D&D sobre visão no escuro.

Essas evoluções podem consumir os contratos espaciais já criados sem alterar o Shared Core narrativo.
