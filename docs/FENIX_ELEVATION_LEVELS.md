# Fênix VTT — Elevação, Níveis e Voo 2.5D

## Objetivo

Este marco transforma o antigo campo `elevation` em parte autoritativa do runtime tático. O standalone continua sendo um mapa 2D, mas movimento, colisão, linha de visão, Fog of War e iluminação passam a considerar uma terceira coordenada lógica `Z`.

O modelo é deliberadamente **2.5D**: não há malha 3D de piso, física de queda ou renderer volumétrico. A coordenada vertical modifica regras táticas e oclusão sem substituir o battlemap 2D.

## Configuração vertical da cena

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

`levels` são referências nomeadas para o Mestre e para a UI. Eles não criam automaticamente superfícies físicas no mapa. Um token pode estar em qualquer Z válido; o nível mais próximo é usado como contexto visual.

A configuração permanece desligada por padrão. Quando `elevation.enabled === false`, colisão e LOS preservam o comportamento 2D anterior.

## Perfil vertical do personagem

O perfil de visão por `actorId` passa a incluir:

```js
{
  elevation: 0,
  height: 1.8,
  movementMode: 'ground' | 'flying'
}
```

- `elevation`: Z/base do corpo.
- `height`: altura corporal usada para colisão vertical e altura dos olhos.
- `ground`: o servidor fixa o token no Z configurado pelo Mestre.
- `flying`: o jogador pode subir/descer, mas o Engine limita cada comando a `scene.elevation.verticalStep`.

O navegador nunca é a autoridade do Z. Mesmo que um jogador envie `elevation: 999`, o Gateway resolve novamente o perfil persistido antes de aceitar o movimento.

## Paredes e portas com faixa vertical

Cada segmento pode carregar:

```js
{
  bottomElevation: 0,
  topElevation: 3
}
```

Uma parede só bloqueia um token quando sua faixa vertical cruza a faixa corporal do token.

Exemplo:

- parede: `Z 0..3`;
- personagem no chão: `Z 0..1.8` → bloqueado;
- personagem voando: `Z 4..5.8` → passa acima.

Portas abertas continuam sem bloquear visão/movimento. Portas fechadas ou trancadas usam a mesma regra vertical da parede.

### Compatibilidade legada

Paredes criadas antes deste marco, sem faixa explícita, normalizam para uma faixa ampla (`-1000..10000`) e portanto continuam funcionando como barreiras 2D/infindas.

A UI oferece **Aplicar faixa padrão às paredes**. Essa ação converte explicitamente os segmentos atuais para `defaultWallBottom..defaultWallTop`. Não há migração silenciosa que faça um dungeon antigo começar a ser atravessável por voo.

## Colisão autoritativa

O fluxo permanece:

```text
Browser solicita TOKEN_MOVE
        ↓
RealtimeSessionGateway autentica actorId
        ↓
Engine resolve perfil vertical persistido
        ↓
Z solicitado é fixado/clampado
        ↓
scene-collision testa XY + faixa vertical
        ↓
Hub persiste e transmite somente o token aceito
```

Jogadores não podem:

- mover outro `actorId`;
- trocar `movementMode` pelo payload;
- alterar `height` pelo payload;
- subir/descer mais do que `verticalStep` em um comando;
- usar Z forjado para atravessar uma parede.

O Mestre mantém o noclip existente para paredes, mas ainda respeita os limites XY da cena.

## Linha de visão vertical

`hasLineOfSight` interpola a altura do raio entre observador e alvo. Quando o raio cruza um segmento no plano XY, a parede só bloqueia se a altura do raio naquele ponto estiver dentro de `bottomElevation..topElevation`.

Isso permite, por exemplo:

- enxergar sobre um muro baixo;
- perder visão ao olhar de um ponto alto para um alvo baixo quando a linha descendente cruza o muro;
- manter portas e paredes infinitas de cenas legadas com o comportamento anterior.

O polígono de visão do token usa a altura dos olhos aproximada como:

```text
eyeZ = tokenZ + height × 0.9
```

## Fog of War

A exploração persistente continua sendo derivada pelo Engine após um `TOKEN_MOVE` autorizado. O browser não escolhe células exploradas.

Agora o Engine também recebe o Z **aceito** do token e calcula `visibleGridCells` na altura dos olhos. Portanto, um personagem que efetivamente esteja acima de um muro baixo pode explorar células que um personagem no térreo não alcança visualmente.

A privacidade existente permanece:

- GM recebe `exploredByActor`;
- jogador recebe apenas `exploredCells` do próprio `membership.actorId`.

## Dynamic Lighting vertical

Fontes de luz passam a ter `elevation`.

- fonte fixa usa seu próprio Z;
- fonte anexada a token acompanha `x`, `y` e `elevation` do token realtime;
- o polígono da luz usa a mesma geometria vertical de LOS;
- uma luz acima do topo de um muro baixo pode iluminar o outro lado;
- uma luz dentro da faixa vertical do muro continua projetando sombra.

## Pontes, passarelas e mezaninos

A primeira modelagem recomendada é:

1. criar um nível nomeado, por exemplo `Ponte · Z 4`;
2. configurar o personagem em `ground` com base `Z 4` quando ele estiver sobre a ponte, ou usar `flying` quando o deslocamento vertical for livre;
3. definir guarda-corpos/paredes da ponte com faixa, por exemplo `Z 4..6`;
4. manter paredes do piso inferior em sua faixa correspondente.

O motor então permite que personagens abaixo da ponte ignorem guarda-corpos elevados, enquanto personagens sobre a ponte colidem com eles.

## UI atual

No painel **Sentidos** do Mestre:

- ativar/desativar 2.5D;
- configurar altura entre níveis;
- configurar passo de voo;
- definir faixa padrão das paredes;
- criar/remover níveis nomeados;
- configurar Z base, altura corporal e modo Solo/Voo do personagem;
- converter em lote as paredes atuais para a faixa padrão.

Jogadores com perfil `flying` recebem controles `−Z` e `+Z`. Esses botões apenas solicitam movimento; o servidor continua sendo a autoridade.

## Limites deliberados deste marco

Ainda não fazem parte do modelo:

- polígonos de piso/áreas que detectam automaticamente se o token está sobre uma ponte;
- escadas e rampas com interpolação automática de Z;
- queda, gravidade ou dano de queda;
- teto e volume fechado completos;
- oclusão token-contra-token;
- visão em cone/altura da cabeça diferenciada por pose;
- floors renderizados como camadas separadas de imagem;
- renderer 3D, PBR ou sombras volumétricas;
- pathfinding 3D.

Essas capacidades podem evoluir sobre `scene-elevation` sem levar regras gráficas ao `SessionDirector` ou ao Shared Core narrativo.

## Fronteira arquitetural

`scene-elevation`, `scene-collision`, `scene-vision` e `scene-lighting` são capacidades táticas externas ao pipeline narrativo. O `SessionDirector` continua responsável somente pela orquestração de intenção, regras, narração e publicação e não deve importar ou conhecer conceitos de Z, voo, paredes ou iluminação.
