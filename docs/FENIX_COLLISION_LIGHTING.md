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

- `wall` bloqueia movimento de jogadores;
- `door:closed` bloqueia movimento de jogadores;
- `door:locked` bloqueia movimento de jogadores;
- `door:open` permite movimento;
- o Mestre possui **noclip administrativo** e ignora paredes/portas ao mover qualquer token;
- o noclip do Mestre não ignora os limites externos da cena;
- jogador continua autorizado apenas a mover seu próprio `actorId`;
- o bypass nunca é aceito como flag do navegador: o `RealtimeSessionHub` decide a política exclusivamente pela identidade autenticada `role=gm`;
- a posição transmitida e persistida é sempre a posição aceita pelo servidor.

O evento `TOKEN_MOVED` inclui metadados de diagnóstico:

```json
{
  "collision": {
    "blocked": true,
    "boundaryAdjusted": false,
    "wallId": "wall-1",
    "fraction": 0.36,
    "ignoredWalls": false
  }
}
```

Para movimento do Mestre, `ignoredWalls` é `true`. Isso permite diagnosticar noclip sem transferir a decisão de autoridade para o cliente.

Se uma tentativa de movimento de jogador é bloqueada, qualquer `roomEntry` enviado junto é ignorado. Assim uma parede não pode ser atravessada apenas para disparar narração de uma sala do outro lado.

## Guarda local de colisão

A validação física mostrou um caso importante: quando a sessão ainda está em `IDLE`, não existe WebSocket autoritativo para corrigir um drag local. O VTT agora aplica o mesmo `resolveTokenMovement()` antes de aceitar a posição final no cliente.

Isso cria duas barreiras complementares:

```text
Arraste / WASD
     ↓
Client collision guard
     ↓
posição local segura
     ↓
RealtimeSessionHub (quando conectado)
     ↓
segunda validação autoritativa
```

Para jogadores, uma parede salva bloqueia o token mesmo antes de `Iniciar sessão`; quando a sessão está ativa, o servidor continua sendo a autoridade final. Para o Mestre, a guarda local é executada com paredes ignoradas, preservando somente os limites externos do mapa.

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
- Mestre move o ator selecionado com noclip de paredes/portas;
- jogador continua limitado ao próprio `actorId` e à colisão da cena.

Arraste e teclado passam pela mesma política local e depois pela mesma autoridade realtime quando a sessão está conectada.

## Fog of War e colisão

O registro de exploração continua acontecendo depois do comando realtime e usa `result.token.x/y`. Como `result.token` já contém a posição resolvida pelo Collision Engine, uma tentativa bloqueada de jogador não revela células atrás da parede.

O noclip do Mestre não desativa LOS/Fog do personagem: ele é uma capacidade administrativa de movimentação, não uma alteração nas regras de visão do token.

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
   ├── política GM noclip / Player collision
   ├── collision resolution
   └── TOKEN_MOVED autoritativo

React / SVG
   └── DynamicLightingOverlay
```

`SessionDirector` não conhece colisão, fontes de luz, ray casting, React, WebGL, Fastify ou persistência de cena.

## Gates automatizados

O marco possui gates para:

- colisão de jogador por parede e portas fechadas/trancadas;
- passagem de jogador por porta aberta;
- noclip do Mestre através de paredes;
- limites da cena preservados mesmo para o Mestre;
- bypass decidido pelo papel autenticado, não por payload do cliente;
- room-entry bloqueado quando o movimento de jogador não atravessa a parede;
- guarda local de colisão mesmo sem realtime;
- mapeamento WASD/setas e passo com Shift;
- proteção para não capturar teclado em campos de texto;
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
