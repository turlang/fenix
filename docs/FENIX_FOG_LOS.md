# Fênix VTT — Fog of War + Token Line of Sight

## Objetivo

Este marco adiciona visão espacial por personagem ao VTT standalone usando a geometria persistida de paredes e portas. O Fog of War é uma capacidade de cena e não uma regra do Shared Core narrativo.

## Modelo

Cada cena pode configurar:

- `enabled`: liga/desliga Fog;
- `visionRangeCells`: alcance máximo de visão em células da grade;
- `exploredOpacity`: intensidade aplicada às áreas já vistas, mas fora da visão atual;
- `unexploredOpacity`: intensidade aplicada às áreas nunca vistas;
- `exploredByActor`: memória persistente interna, separada por `actorId`.

O Mestre recebe `exploredByActor` ao consultar a cena para poder usar o preview de qualquer personagem. Um jogador recebe somente `exploredCells` do próprio personagem vinculado à membership. O histórico dos demais atores não é exposto no catálogo do jogador.

## Line of Sight

O pacote puro `packages/scene-vision` consome a geometria produzida por `packages/scene-geometry`.

Regras atuais:

- `wall` bloqueia visão;
- `door:closed` bloqueia visão;
- `door:locked` bloqueia visão;
- `door:open` deixa a visão passar;
- o alcance máximo também limita o polígono de visão;
- os limites da própria cena fecham o polígono.

O LOS é calculado por ray-casting contra segmentos de cena. O cálculo atual usa raios uniformes e raios adicionais em torno dos endpoints dos obstáculos para evitar grandes vazamentos em quinas.

## Estados do Fog

```text
Nunca visto        -> opacidade alta
Já explorado       -> opacidade intermediária
Visão atual        -> totalmente visível
```

A visão atual é recalculada enquanto o token se move. O browser mantém uma união local das células descobertas para evitar flicker durante o drag; a fonte persistente continua sendo o Engine.

## Persistência autoritativa

O browser não possui um endpoint que aceite livremente uma lista de células exploradas.

A persistência acontece no Engine a partir do fluxo já autenticado de movimento:

```text
TOKEN_MOVE
   ↓
RealtimeSessionGateway
   ↓ valida role / actorId
normalizeRealtimeToken
   ↓
posição autoritativa
   ↓
CampaignSceneService.recordExploration
   ↓
visibleGridCells + walls + grid
   ↓
mergeExploredCells
   ↓
repository
```

Um jogador só pode gerar exploração para seu próprio `membership.actorId`. O Mestre pode mover qualquer token e, consequentemente, atualizar a exploração daquele ator.

## Realtime e privacidade

A configuração completa do Fog não é enviada dentro do `SCENE_UPDATED` global. O evento realtime funciona como invalidação: cada cliente atualiza seu catálogo via HTTP autenticado e recebe a versão da cena filtrada conforme sua membership.

Isso evita transmitir a jogadores o histórico de exploração de outros personagens.

## Recalibração da grade

A memória de exploração usa chaves de célula (`col:row`). Portanto, alterar `size`, `offsetX` ou `offsetY` da grade invalida semanticamente as células antigas.

Ao recalibrar a geometria da grade, o Engine limpa `exploredByActor` automaticamente. Alterar somente `grid.visible` preserva a exploração.

## UI do Mestre

A barra do mapa adiciona:

- **Fog**: abre configuração da cena;
- **Visão**: liga/desliga preview usando o ator atualmente selecionado.

O Mestre normalmente continua vendo o mapa completo. O Fog só é aplicado à visão do Mestre quando o preview está ativo.

## UI do jogador

Quando `scene.fog.enabled` está ativo, o jogador recebe automaticamente a visão do seu token vinculado à campanha. Se o token ainda não existe no snapshot realtime, o overlay fecha de forma segura e não revela o mapa.

## Limites deliberados deste marco

Este marco não implementa ainda:

- colisão física de token contra paredes/portas;
- fontes de luz e sombras dinâmicas;
- darkvision, visão em baixa luz ou sentidos especiais por sistema;
- visão compartilhada entre múltiplos tokens controlados pelo mesmo usuário;
- visão cônica/direcional;
- elevação, paredes de altura parcial ou janelas.

A próxima evolução natural é **Token Collision + Dynamic Lighting**, reutilizando `scene-geometry` e `scene-vision` sem mover essas responsabilidades para o Shared Core narrativo.
