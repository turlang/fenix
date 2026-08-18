# Fenix3D v0.1 — Unreal Runtime Skeleton

## Objetivo

`apps/fenix3d-unreal` é o primeiro runtime 3D nativo do Projeto Fênix. Ele é um cliente fino do Fênix Core: renderiza o mundo, captura input e reconcilia a apresentação com o estado autoritativo do servidor.

O Unreal **não** decide:

- propriedade de Token/Ator;
- posição final;
- colisão autoritativa;
- elevação válida;
- regras de movimento;
- Fog explorado;
- consequência narrativa.

## Fluxo

```text
Render Node
  |
  | env scoped credentials
  v
Fenix3D
  |
  | GET FENIX_RUNTIME_MANIFEST_URL
  v
UFenixRuntimeBootstrapClient
  |
  v
fenix.3d-runtime-manifest v1
  |
  +--> AFenixWorldBuilder
  |      - base floor
  |      - walls / doors
  |      - floor / stairs / ramp regions
  |      - lights
  |      - non-viewer token proxies
  |
  +--> AFenixFirstPersonPawn
         - camera at eye height
         - WASD
         - mouse look
         - Shift run intent
         - E interact intent

Pawn input
  |
  v
UFenixRuntimeControlClient
  |
  | POST semantic intent only
  v
Fênix App Server / Runtime Control
  |
  v
AuthoritativeRealtimeSessionGateway
  |
  | collision / boundaries / elevation / persistence / Fog
  v
fenix.3d-runtime-state-sync
  |
  v
AFenixFirstPersonPawn::ApplyAuthoritativeState
```

## Estrutura

```text
apps/fenix3d-unreal/
  Fenix3D.uproject
  Config/
    DefaultEngine.ini
    DefaultInput.ini
  Source/
    Fenix3D.Target.cs
    Fenix3DEditor.Target.cs
    Fenix3D/
      Fenix3D.Build.cs
      Public/
        Fenix3D.h
        FenixRuntimeTypes.h
        FenixRuntimeBootstrapClient.h
        FenixRuntimeControlClient.h
        FenixWorldBuilder.h
        FenixFirstPersonPawn.h
        FenixRuntimeGameMode.h
      Private/
        Fenix3D.cpp
        FenixRuntimeBootstrapClient.cpp
        FenixRuntimeControlClient.cpp
        FenixWorldBuilder.cpp
        FenixFirstPersonPawn.cpp
        FenixRuntimeGameMode.cpp
```

## Runtime Manifest

O processo recebe do Render Node:

```text
FENIX_RUNTIME_MANIFEST_URL
FENIX_RUNTIME_MANIFEST_TOKEN
```

O bootstrap usa `Authorization: Bearer <token efêmero>` e aceita somente:

```text
schema = fenix.3d-runtime-manifest
version = 1
```

O manifest já chega em centímetros para a camada 3D e contém:

- cena e dimensões;
- paredes e portas;
- níveis;
- pisos, escadas e rampas;
- luzes;
- entidades visíveis;
- viewer Actor/Token;
- câmera First Person;
- Fog privado do viewer.

## WorldBuilder v0.1

`AFenixWorldBuilder` usa primitives do próprio Engine para materializar uma cena técnica sem depender de assets externos.

Nesta versão:

- o piso base é um box técnico;
- walls/doors são boxes orientados;
- regiões são proxies geométricos;
- rampas recebem inclinação inicial;
- luzes viram `APointLight`;
- tokens não-viewer viram proxies cilíndricos.

### Autoridade de colisão

Os meshes gerados usam `ECollisionEnabled::NoCollision` de propósito.

Isso evita que a física local do Unreal se torne uma segunda autoridade. A barreira real continua no Fênix Core; ao tentar atravessar uma parede, o runtime envia uma intenção, o Core resolve o movimento e o Pawn recebe a posição aceita.

Colisão visual/preditiva poderá ser acrescentada depois, desde que nunca substitua o resultado autoritativo.

## First Person Pawn

`AFenixFirstPersonPawn` possui somente câmera e captura de input. Não existe `CharacterMovementComponent`, `FloatingPawnMovement` ou `AddMovementInput`.

Bindings:

```text
W/S        MoveForward
A/D        MoveRight
Mouse X    LookYaw
Mouse Y    LookPitch
Shift      Run
E          PrimaryAction / interact
```

O Pawn pode atualizar a orientação local da câmera para resposta imediata, mas a posição do personagem só é alterada por:

```text
ApplyAuthoritativeState(...)
```

## Runtime Control

O Render Node injeta:

```text
FENIX_RUNTIME_CONTROL_URL
FENIX_RUNTIME_CONTROL_TOKEN
FENIX_RENDER_SESSION_ID
```

`UFenixRuntimeControlClient` envia somente:

```json
{
  "sequence": 1,
  "intent": {
    "type": "move",
    "forward": 1,
    "strafe": 0,
    "run": false
  }
}
```

Também existem `look` e `action`.

O cliente mantém uma fila serializada para que requisições HTTP não ultrapassem umas às outras e violem a sequência monotônica do broker.

Ele nunca envia `x`, `y`, `z`, `position`, `teleport`, `actorId`, `tokenId` ou `sceneId` como autoridade.

## State Sync

Resposta de movimento/look aceita:

```text
fenix.3d-runtime-state-sync
```

O `AFenixRuntimeGameMode` verifica se `tokenId` e `actorId` continuam iguais ao viewer do manifest antes de aplicar a reconciliação.

## Pixel Streaming

O `.uproject` habilita `PixelStreaming2`. O Render Node continua responsável por iniciar o executável com:

```text
-RenderOffscreen
-PixelStreamingURL=<signalling ws/wss>
-PixelStreamingWebRTCMaxFps=<fps>
```

O navegador continua cliente fino e recebe somente o Player URL público.

## Como abrir localmente

1. Instale Unreal Engine 5.5 com suporte C++.
2. Confirme que o plugin Pixel Streaming 2 está disponível na instalação.
3. Abra `apps/fenix3d-unreal/Fenix3D.uproject`.
4. Gere/compile o projeto para Development Editor.
5. Para um runtime conectado de verdade, inicie-o pelo Render Node em `process` mode para que as credenciais efêmeras sejam injetadas no ambiente.

Abrir diretamente pelo Editor sem essas variáveis permite validar compilação/UI do projeto, mas o bootstrap vai falhar fechado e não inventará uma cena local.

## CI

A CI pública do monorepo não possui o SDK/Engine Unreal instalado. Por isso este marco valida automaticamente:

- layout `.uproject`/targets/module;
- dependências HTTP/JSON;
- bootstrap e schema;
- WorldBuilder;
- input First Person;
- ausência de movimento local autoritativo;
- fila de Runtime Control;
- reconciliação por state-sync;
- credenciais injetadas pelo Render Node.

A compilação nativa do Unreal será adicionada a um runner Windows/GPU próprio quando essa infraestrutura estiver disponível.

## Próximo estágio

Depois deste skeleton, a próxima entrega 3D deve focar em uma **Technical Playable Scene**:

- build nativo validado em UE5;
- background/map asset materializado como referência espacial;
- paredes e portas com materiais de debug;
- pisos/escadas/rampas com geometria mais fiel;
- proxies de tokens com atualização em tempo real;
- feedback visual de colisão/reconciliação;
- smoke test real Render Node → Unreal → Pixel Streaming → Browser.
