# Fênix 3D Runtime Adapter v1

## Objetivo

O Fênix 3D Runtime Adapter é a fronteira entre o estado autoritativo do VTT e um runtime 3D remoto, inicialmente pensado para Unreal Engine + Pixel Streaming.

A regra central é simples:

> O runtime 3D renderiza, coleta input e pode fazer predição visual. O Fênix Core continua sendo a autoridade de Token, movimento, colisão, elevação, regras e estado persistente.

O runtime não recebe permissão para teleportar o personagem nem gravar coordenadas diretamente.

## Fluxo

```text
Top View / Campanha Fênix
        |
        v
World Bootstrap autoritativo
        |
        v
Render Node
        |
        | converte para fenix.3d-runtime-manifest
        v
Runtime 3D / Unreal
        |
        | move / look / action (intent)
        v
App Server Runtime Control
        |
        v
AuthoritativeRealtimeSessionGateway
        |
        | colisão / limites / elevação / persistência
        v
fenix.3d-runtime-state-sync
        |
        v
Runtime 3D reconcilia câmera/pawn
```

## Runtime Manifest

Schema:

```text
fenix.3d-runtime-manifest / v1
```

O manifest é derivado de `fenix.render-world-bootstrap` e é entregue apenas ao processo 3D usando a credencial efêmera daquela render session.

Ele materializa:

- dimensões da cena;
- escala física;
- walls e doors;
- níveis;
- regiões `floor`, `stairs` e `ramp`;
- fontes de luz;
- tokens visíveis;
- viewer Actor/Sheet;
- câmera First Person;
- Fog explorado do viewer.

### Unidades e coordenadas

O VTT mantém a escala física da cena. O adapter converte o runtime para centímetros, convenção natural do Unreal.

Exemplo com o default Fênix:

```text
1 célula = 1,5 m
70 px por célula
1 célula no runtime = 150 cm
1 px ~= 2,142857 cm
```

Conversão espacial:

```text
runtime.x = scene.x * cmPerPixel
runtime.y = -scene.y * cmPerPixel
runtime.z = elevation em centímetros
```

O Y é invertido porque o canvas 2D cresce para baixo, enquanto o mundo 3D usa o plano visual com direção positiva oposta.

### Walls e Doors

Cada segmento vira uma entidade explícita com:

- `a` e `b` em centímetros;
- `bottomZ`;
- `topZ`;
- `heightCm`;
- `kind` (`wall` ou `door`);
- `doorState`;
- `blocksMovement`;
- `blocksVision`.

As faixas verticais legadas `-1000/+10000` não geram paredes gigantes no runtime. Elas são convertidas para a altura física padrão da cena quando necessário.

### Floors, Stairs e Ramps

Regiões físicas preservam:

- polígono;
- `baseZ`;
- `targetZ`;
- eixo de progressão para escada/rampa;
- prioridade.

O runtime pode gerar mesh/volume visual a partir disso, mas o valor autoritativo de elevação continua sendo resolvido pelo Core.

### Tokens

Cada Token vira uma entidade do manifest com:

- `tokenId`;
- `actorId`;
- `sheetId`;
- `systemId`;
- transform visual;
- footprint em centímetros;
- altura física;
- movement mode;
- flag `viewer`.

A identidade não pode ser alterada por input do runtime.

### Câmera First Person

A câmera é derivada de:

```text
Token.position + Token.elevation + Actor.eyeHeight
```

Ela também recebe:

- yaw inicial do Token;
- sentido preferido;
- alcance de visão convertido para centímetros;
- FOV inicial.

## Canal privado de controle

Ao criar uma sessão de render, o App Server pode gerar:

```text
controlId
runtime control token
runtime control input URL
```

Esses valores atravessam somente:

```text
App Server -> Render Node -> ambiente do processo 3D
```

O browser não recebe esses dados.

No process mode, o launcher injeta:

```text
FENIX_RUNTIME_MANIFEST_URL
FENIX_RUNTIME_MANIFEST_TOKEN
FENIX_RUNTIME_CONTROL_ID
FENIX_RUNTIME_CONTROL_URL
FENIX_RUNTIME_CONTROL_TOKEN
```

O processo não recebe cookie do jogador nem `FENIX_RENDER_NODE_TOKEN`.

## Input do runtime

Schema:

```text
fenix.3d-runtime-input / v1
```

Tipos permitidos:

### Move

```json
{
  "sequence": 41,
  "intent": {
    "type": "move",
    "forward": 1,
    "strafe": 0,
    "run": false
  }
}
```

### Look

```json
{
  "sequence": 42,
  "intent": {
    "type": "look",
    "yaw": 90,
    "pitch": -8
  }
}
```

### Action

```json
{
  "sequence": 43,
  "intent": {
    "type": "action",
    "action": "Examino a porta.",
    "targetId": "door-1"
  }
}
```

Campos de autoridade são rejeitados, inclusive quando aparecem dentro de `intent`:

```text
x, y, z, position, location, coordinates, transform,
teleport, elevation, actorId, tokenId, sceneId, campaignId
```

Inputs precisam ter sequência monotônica. Repetição/replay da mesma sequência é recusada.

## Movimento autoritativo

Para `move`, o adapter projeta apenas um destino solicitado a partir do vetor e yaw.

No v1:

- passo normal = `0,2` célula;
- `run=true` = `1` célula por intent.

Esse destino ainda não é aceito. O `AuthoritativeRealtimeSessionGateway` executa:

- validação Token -> Actor;
- limites da cena;
- colisão com wall/door;
- elevação;
- regiões de piso/escada/rampa;
- persistência do Token;
- atualização de Fog/exploração.

Depois o runtime recebe:

```text
fenix.3d-runtime-state-sync / v1
```

contendo a posição realmente aceita, revisão e resultado de colisão/verticalidade.

## Regra para implementação Unreal

O primeiro projeto Unreal deve ser dividido em quatro responsabilidades:

1. **FenixRuntimeBootstrapClient**
   - lê `FENIX_RUNTIME_MANIFEST_URL` e token;
   - baixa o manifest no startup;
   - nunca grava estado no Fênix diretamente.

2. **FenixWorldBuilder**
   - cria paredes, portas, pisos, escadas/rampas, níveis, luzes e entidades visuais;
   - mantém IDs Fênix como tags/identidade técnica.

3. **FenixFirstPersonPawn**
   - câmera na posição/altura fornecida;
   - coleta WASD/mouse/interação;
   - pode prever localmente para fluidez, mas precisa reconciliar com `state-sync`.

4. **FenixRuntimeControlClient**
   - envia `move/look/action` para `FENIX_RUNTIME_CONTROL_URL` com Bearer efêmero;
   - incrementa `sequence` monotonicamente;
   - aplica o estado aceito pelo Core.

## O que não pertence ao runtime 3D

Não colocar no Unreal como autoridade:

- regra de movimento do sistema RPG;
- associação Token/Actor/Sheet;
- collision truth;
- Fog persistente;
- decisão de alcance de visão;
- estado de campanha;
- IA do Mestre Fênix;
- autorização de jogador;
- inventário/ficha como source of truth.

## Próximo marco

Com este contrato validado, o próximo passo é o **Unreal Runtime Skeleton / Fenix3D v0.1**: criar o projeto/plugin mínimo que consome o manifest, instancia geometria simples, posiciona uma câmera First Person e envia intents reais ao App Server.