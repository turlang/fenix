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

- `wall` bloqueia movimento;
- `door:closed` bloqueia movimento;
- `door:locked` bloqueia movimento;
- `door:open` permite movimento;
- os limites da cena também limitam o centro do token;
- jogador continua autorizado apenas a mover seu próprio `actorId`;
- a posição transmitida e persistida é sempre a posição aceita pelo servidor.

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

Se uma tentativa de movimento é bloqueada, qualquer `roomEntry` enviado junto é ignorado. Assim uma parede não pode ser atravessada apenas para disparar narração de uma sala do outro lado.

## Fog of War e colisão

O registro de exploração continua acontecendo depois do comando realtime e usa `result.token.x/y`. Como `result.token` já contém a posição resolvida pelo Collision Engine, uma tentativa bloqueada não revela células atrás da parede.

### Estabilidade durante drag

A exploração transitória do Fog é idempotente: se o token continua vendo exatamente o mesmo conjunto de células, o estado React existente é reutilizado em vez de criar um novo array. O conjunto de tokens usado pelo Dynamic Lighting durante o drag também é memoizado. Isso impede ciclos de renderização durante `pointermove` e evita o erro `Maximum update depth exceeded` observado no Chrome durante a validação física.

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
   ├── collision resolution
   └── TOKEN_MOVED autoritativo

React / SVG
   └── DynamicLightingOverlay
```

`SessionDirector` não conhece colisão, fontes de luz, ray casting, React, WebGL, Fastify ou persistência de cena.

## Gates automatizados

O marco possui gates para:

- colisão por parede e portas fechadas/trancadas;
- passagem por porta aberta;
- limites da cena;
- room-entry bloqueado quando o movimento não atravessa a parede;
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
