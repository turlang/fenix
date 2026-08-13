# Fênix VTT — Elevação, Níveis, Voo e Floor Regions 2.5D

## Objetivo

O Fênix VTT usa um modelo tático 2.5D: o battlemap continua 2D, mas movimento, colisão, LOS/Fog, iluminação e superfícies consideram uma coordenada lógica `Z`.

A configuração vertical continua fora do Shared Core narrativo e do `SessionDirector`.

## Elevação da cena

Cada cena pode carregar:

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

Com `elevation.enabled === false`, o comportamento 2D legado é preservado.

## Perfil vertical do personagem

```js
{
  elevation: 0,
  height: 1.8,
  movementMode: 'ground' | 'flying'
}
```

- `ground`: Z é resolvido pelo piso/região quando houver Floor Regions; sem região, usa o fallback configurado.
- `flying`: Z varia por comandos, limitado pelo `verticalStep` no Engine.
- o browser nunca é autoridade final de Z.

## Paredes e portas verticais

Segmentos podem carregar:

```js
{
  bottomElevation: 0,
  topElevation: 3
}
```

Uma barreira só bloqueia um token quando as faixas verticais se cruzam. Paredes antigas sem faixa explícita permanecem efetivamente infinitas para preservar compatibilidade.

## Floor Regions

A cena pode armazenar regiões 2.5D:

```js
{
  id: 'ramp-1',
  name: 'Rampa da ponte',
  kind: 'floor' | 'stairs' | 'ramp',
  enabled: true,
  priority: 0,
  points: [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 240 },
    { x: 100, y: 240 }
  ],
  baseElevation: 0,
  targetElevation: 4,
  axis: {
    start: { x: 100, y: 170 },
    end: { x: 300, y: 170 }
  }
}
```

### Piso

`floor` fixa o Z de tokens em Solo no `baseElevation`.

### Escada e Rampa

`stairs` e `ramp` interpolam Z entre `baseElevation` e `targetElevation` conforme a projeção do token sobre `axis`.

A direção do eixo define o sentido da subida. Inverter o eixo e os valores Z inverte a transição.

### Sobreposição e prioridade

Quando duas regiões contêm o mesmo ponto, vence:

1. maior `priority`;
2. menor área;
3. ID, como desempate determinístico.

Isso permite colocar uma escada/rampa por cima de um piso maior sem perder a transição.

## Autoridade de movimento

Para tokens em Solo, o composition root do Engine resolve a região da posição solicitada, executa um preflight de colisão e usa a posição segura aceita para resolver o Z final. Portanto, uma parede antes do piso superior não permite ganhar antecipadamente a elevação da região que está atrás dela.

Tokens em Voo ignoram Floor Regions e mantêm a autoridade de `verticalStep` do Gateway.

O Mestre continua com noclip de paredes, porém Floor Regions também podem ser visualizadas/testadas pelo GM. O cliente faz apenas uma previsão visual do Z; o Engine continua confirmando a posição autoritativa.

## Privacidade

A geometria de Floor Regions é informação de authoring do Mestre:

- GM recebe as regiões completas;
- jogador recebe `regions: []` no catálogo público;
- o Engine conserva a geometria interna e calcula o Z do jogador no servidor.

Assim a região de uma passagem, escada secreta ou piso oculto não precisa ser entregue ao navegador do jogador.

## Visualização do Mestre

O battlemap agora possui um controle GM-only **`Pisos · N`**.

Quando ativo:

- Piso aparece como região azul;
- Escada aparece em amarelo;
- Rampa aparece em verde;
- Escadas/Rampas mostram uma seta indicando o sentido da subida;
- cada região mostra nome e faixa de Z;
- cada token mostra um badge `Z n.n` junto ao personagem.

Os badges Z permanecem visíveis para o Mestre quando o modelo de elevação está em uso, permitindo confirmar a transição sem depender do painel numérico. Mouse e WASD usam o mesmo helper de preview local das regiões; depois o Engine continua sendo a autoridade final.

O painel **Sentidos → Pisos e transições** permanece como ajuste preciso de X/Y/Z, prioridade e direção. O overlay elimina a validação “às cegas”: depois de salvar, o Mestre pode ativar `Pisos` e comparar diretamente a geometria configurada com o battlemap.

## LOS, Fog e Lighting

LOS usa a altura do raio no ponto em que cruza a barreira. Fog persiste exploração usando o Z aceito pelo Engine. Dynamic Lighting usa o Z de fontes fixas ou anexadas a tokens.

Uma fonte ou observador acima de uma parede baixa pode ver/iluminar além dela; dentro da faixa da parede a oclusão permanece.

## Validação automatizada

Os gates cobrem:

- comportamento 2D legado quando elevação está desligada;
- paredes legadas continuam bloqueando;
- colisão vertical;
- LOS vertical;
- Fog usando o Z aceito;
- luz com Z;
- proteção contra spoof de Z/modo/altura;
- voo limitado por `verticalStep`;
- persistência GM-only de níveis e regiões;
- jogador recebe `regions: []`;
- Piso fixa Z;
- Rampa/Escada interpolam Z;
- prioridade de regiões;
- preview local do GM reproduz Z de Piso/Rampa;
- overlay visual GM-only contém regiões, direção de subida e badges Z;
- capacidades táticas permanecem fora do `SessionDirector`.

A CI mantém Node 20/22/24, validator modular, PostgreSQL, coordenação distribuída, idempotência, routing, HTTP, WebSocket e build standalone.

## Limites deliberados

Ainda não fazem parte desta fase:

- gravidade, queda e dano de queda;
- teto/volume fechado completo;
- portais verticais/alçapões automáticos;
- oclusão token-contra-token;
- floors com imagens separadas;
- renderer 3D/PBR;
- pathfinding 3D.

O motor de regiões aceita polígonos; a edição precisa atual continua baseada nos valores do painel e a visualização acontece diretamente sobre o mapa.

## Fronteira arquitetural

`scene-elevation`, `scene-collision`, `scene-vision` e `scene-lighting` são capacidades táticas. O `SessionDirector` continua responsável apenas por intenção, regras, narração e publicação, sem conhecer Z, pisos, voo, paredes, Fog ou iluminação.
