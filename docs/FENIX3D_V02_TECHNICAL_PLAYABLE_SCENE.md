# Fenix3D v0.2 — Technical Playable Scene

## Objetivo

Levar o skeleton Unreal do Fênix de um consumidor estático de manifest para uma cena técnica capaz de receber estado vivo do Fênix Core, apresentar feedback de colisão e ser validada em um GPU Render Node com Pixel Streaming.

## Autoridade

O Unreal continua sendo um thin client. Ele não resolve colisão, não decide posição final, não altera Actor/Token/Ficha e não executa regras RPG. WASD/mouse geram somente `move`, `look` e `action`. O Fênix Core devolve `fenix.3d-runtime-state-sync` e o runtime reconcilia a representação visual.

## Entregas v0.2

- `state-sync` do Runtime Control inclui a lista autoritativa atual dos tokens da cena.
- `AFenixWorldBuilder` mantém atores visuais por `tokenId` e atualiza posição, rotação e visibilidade de outros personagens.
- token do viewer permanece controlado exclusivamente pela reconciliação do `AFenixFirstPersonPawn`.
- reconciliação do viewer usa interpolação em vez de teleport visual a cada ACK.
- colisão recusada pelo Core produz feedback técnico na tela/log sem criar colisão local como autoridade.
- portas abertas são representadas visualmente em posição aberta.
- regiões `stairs` recebem uma representação em degraus e `ramp` mantém inclinação técnica.
- primitives do WorldBuilder continuam com `ECollisionEnabled::NoCollision`.

## Build nativo

O workflow normal do repositório não possui Unreal Engine instalado. O build nativo é executado por:

```powershell
$env:FENIX_UNREAL_ENGINE_ROOT="C:\Program Files\Epic Games\UE_5.5"
npm run build:fenix3d-native
```

Também existe `.github/workflows/fenix3d-native.yml`, desenhado para um runner Windows self-hosted com labels `self-hosted`, `Windows`, `X64`, `fenix3d` e Unreal Engine 5.5 instalado.

## Smoke Pixel Streaming

Com o Render Node em `process` mode, o executável Fenix3D configurado e a infraestrutura Pixel Streaming ativa:

```powershell
$env:FENIX_RENDER_NODE_INTERNAL_URL="http://127.0.0.1:3100"
$env:FENIX_RENDER_NODE_TOKEN="<token-interno>"
npm run smoke:fenix3d
```

O smoke valida `health`, cria uma sessão técnica com World Bootstrap mínimo, força o Render Node a iniciar o runtime configurado, verifica o `playerUrl` e encerra a sessão para liberar GPU/VRAM.

## Critério de pronto

Este marco pode entrar no `main` após a CI Node/PostgreSQL/realtime/VTT permanecer verde. O primeiro resultado de compilação real do C++ e o smoke Pixel Streaming devem ser executados no runner/servidor com Unreal instalado; eles não devem ser alegados como validados até esse ambiente existir e os comandos acima passarem.
