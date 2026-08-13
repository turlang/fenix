# Fênix VTT — Elevação, Níveis, Pisos e Transições 2.5D

## Objetivo

O Fênix VTT usa um modelo tático 2.5D: o battlemap continua 2D, mas movimento, colisão, LOS, Fog e iluminação consideram a coordenada lógica `Z`.

Além de níveis nomeados e voo, a cena agora pode possuir **regiões de piso, escadas e rampas**. Tokens em modo Solo recebem sua elevação automaticamente da região em que terminam o movimento. Tokens em Voo continuam usando o controle vertical autoritativo por `verticalStep`.

## Configuração vertical

```js
{
  elevation: {
    enabled: true,
    unit: 'm',
    levelHeight: 3,
    verticalStep: 1,
    defaultWallBottom: 0,
    defaultWallTop: 3,
    levels: [
      { id: 'ground', name: 'Térreo', elevation: 0 },
      { id: 'bridge', name: 'Ponte', elevation: 4 }
    ]
  }
}
```

`levels` continuam sendo referências nomeadas. A geometria física do piso é descrita separadamente por `scene.regions`.

## Floor Regions

Uma região pode ser `floor`, `stairs` ou `ramp`:

```js
{
  id: 'stairs-east',
  name: 'Escada leste',
  kind: 'stairs',
  enabled: true,
  priority: 10,
  points: [
    { x: 300, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 220 },
    { x: 300, y: 220 }
  ],
  baseElevation: 0,
  targetElevation: 4,
  axis: {
    start: { x: 300, y: 160 },
    end: { x: 500, y: 160 }
  }
}
```

O domínio aceita polígonos de até 64 pontos e até 128 regiões por cena. A UI desta fase cria regiões retangulares, mas a persistência e o motor não ficam limitados a retângulos.

### Piso

`floor` possui Z fixo:

```text
qualquer ponto dentro da região → baseElevation
```

Exemplo: uma passarela com `baseElevation = 4` coloca automaticamente um token em Solo em Z 4 quando ele termina o movimento dentro daquela região.

### Escada e rampa

`stairs` e `ramp` usam um eixo orientado `start → end`. O Engine projeta a posição do token nesse eixo e interpola:

```text
Z = baseElevation + (targetElevation - baseElevation) × progresso
```

Assim, uma rampa de Z 0 para Z 4 produz aproximadamente Z 2 no meio do percurso. Inverter o eixo e os extremos de Z inverte a direção da subida.

### Regiões sobrepostas

Quando mais de uma região contém o mesmo ponto, a resolução é determinística:

1. maior `priority`;
2. menor área do polígono;
3. `id` como desempate estável.

Isso permite colocar uma escada de prioridade alta dentro de uma região maior de piso.

## Autoridade do Engine

A geometria de região não é autoridade do browser. O fluxo de um token em Solo é:

```text
Browser solicita TOKEN_MOVE (X/Y)
        ↓
Engine autentica session + membership + actorId
        ↓
Engine lê scene.regions persistidas
        ↓
preflight usa colisão autoritativa para obter o ponto XY seguro
        ↓
resolveGroundElevation(ponto seguro)
        ↓
perfil vertical entregue ao RealtimeSessionGateway recebe o Z calculado
        ↓
Gateway aplica novamente suas regras autoritativas de token/collision
        ↓
TOKEN_MOVED contém somente o token aceito
        ↓
Fog persiste exploração usando X/Y/Z aceitos
```

Consequências:

- jogador não escolhe o Z de um token em Solo;
- uma região atrás de uma parede não deve alterar prematuramente o Z quando a colisão interrompe o movimento antes dela;
- `height` e `movementMode` continuam vindos do perfil persistido;
- tokens em Voo ignoram Floor Regions e continuam limitados a um `verticalStep` por comando;
- o Mestre conserva o noclip existente para paredes.

## Privacidade das regiões

Regiões podem revelar informação estrutural do mapa, como passagens, pisos secretos ou transições entre andares. Por isso:

- Mestre recebe `scene.regions` completas;
- jogador recebe `scene.regions = []` no catálogo HTTP;
- o Engine ainda usa as regiões privadas para calcular o Z do token do jogador;
- `POST /v1/campaigns/:campaignId/scenes/:sceneId/regions` é GM-only.

O jogador observa somente o resultado autoritativo do próprio token, não o polígono que produziu a transição.

## Perfil vertical do personagem

```js
{
  elevation: 0,
  height: 1.8,
  movementMode: 'ground' | 'flying'
}
```

- `ground`: Z vem do piso automático quando houver região; fora de regiões usa o Z-base persistido.
- `flying`: Z é variável, porém cada comando continua limitado pelo `verticalStep`.
- `height`: define a faixa corporal e contribui para a altura dos olhos.

## Paredes e portas

Paredes continuam podendo ter:

```js
{
  bottomElevation: 0,
  topElevation: 3
}
```

Uma barreira só bloqueia quando a faixa corporal/raio vertical cruza sua faixa. Portas abertas não bloqueiam; portas fechadas e trancadas usam a mesma regra vertical.

Paredes antigas sem faixa explícita permanecem efetivamente infinitas para preservar compatibilidade.

## Fog e iluminação

O Fog continua sendo calculado após o movimento aceito e recebe o Z final do token. Portanto, ao subir uma escada/rampa o ponto de observação usado pelo LOS acompanha a nova elevação.

Fontes de luz anexadas continuam seguindo X/Y/Z autoritativos dos tokens. Oclusão vertical de paredes permanece compartilhada com as regras de visão.

## Authoring atual

No painel **Sentidos** do Mestre existe a seção **Pisos e transições** com:

- `+ Piso`;
- `+ Escada`;
- `+ Rampa`;
- nome e tipo;
- ativar/desativar;
- X1/Y1/X2/Y2 do retângulo;
- Z inicial;
- Z final para escada/rampa;
- prioridade;
- **Inverter subida**.

Novas regiões nascem próximas ao personagem selecionado para acelerar o authoring. O domínio já suporta polígonos arbitrários, porém desenho poligonal click-to-click sobre o mapa fica para um refinamento posterior.

## Validação automatizada

Os gates deste marco cobrem:

- normalização de `floor`, `stairs` e `ramp`;
- point-in-polygon;
- piso com Z fixo;
- interpolação de rampa;
- prioridade de regiões sobrepostas;
- persistência GM-only;
- jogador recebendo lista vazia de regiões;
- runtime interno recebendo a geometria completa;
- resolução server-side antes do movimento;
- Fog usando o Z aceito;
- compatibilidade dos gates anteriores de voo, colisão, LOS, iluminação e infraestrutura distribuída.

A CI deste marco deve manter verdes Node 20/22/24, validator modular, HTTP de autenticação/Fog/Lighting, PostgreSQL, coordenação distribuída, idempotência, routing, WebSocket e build standalone. O gate específico de Floor Regions exige também persistência GM-only, `regions: []` para jogador e cálculo de piso no composition root antes do movimento realtime.

## Limites deliberados

Ainda não fazem parte desta fase:

- desenho poligonal direto click-to-click no battlemap;
- malha 3D ou renderer volumétrico;
- gravidade, queda e dano de queda;
- salto/climb automático baseado em regras de sistema;
- detecção física de teto;
- oclusão token-contra-token;
- pathfinding 3D;
- imagens de battlemap separadas por andar;
- bloqueio automático de toda diferença abrupta de Z entre pisos sem uma escada/rampa explícita.

Para mapas táticos, a recomendação é sobrepor a região de escada/rampa ao corredor de transição e usar `priority` maior que os pisos adjacentes.

## Fronteira arquitetural

As capacidades permanecem fora do pipeline narrativo. `scene-elevation`, `scene-collision`, `scene-vision` e `scene-lighting` são serviços táticos puros; `CampaignSceneService` persiste authoring; o composition root resolve estado autoritativo; o `SessionDirector` continua sem conhecer Z, regiões, paredes, Fog ou iluminação.
