# Fenix3D v0.3 — GPU Runtime Deployment & Native Validation

## Objetivo

Transformar o Fenix3D de um skeleton C++ versionado em um runtime empacotável e executável em um GPU Node Windows, mantendo o Fênix Core como autoridade de jogo e usando Pixel Streaming 2 apenas para vídeo/áudio/input remoto.

## Topologia oficial

```text
Fênix App/API
    |
    v
Remote Render Broker
    |
    | rede privada + Bearer interno
    v
GPU Render Node (Windows)
    |-- RenderSessionRegistry
    |-- ProcessRenderRuntimeLauncher
    |-- Fenix3D.exe por sessão
    |
    +--> Pixel Streaming Signalling/Web Server (UE5.5 infra)
             |
             +--> STUN/TURN quando necessário
             |
             v
          Browser
```

O Matchmaker da infraestrutura Pixel Streaming não faz parte do Fênix. A seleção de GPU/sessão já pertence ao `RemoteRenderBroker`.

## Compatibilidade

- Unreal Engine: 5.5
- Plugin: Pixel Streaming 2
- Infraestrutura Pixel Streaming: branch correspondente ao UE5.5
- Runtime GPU inicial: Windows x64
- Render Node: Node.js 20–24
- GPU: NVIDIA com encoder de hardware validável por `nvidia-smi` no primeiro deployment

## IDs de stream

Cada processo recebe:

```text
-PixelStreamingID=<renderSessionId>
```

O `renderSessionId` é gerado pelo Render Node e nunca pelo navegador. Isso permite que o frontend/signalling identifique qual streamer pertence à sessão reservada pelo Fênix.

## Build nativo

```powershell
$env:FENIX_UNREAL_ENGINE_ROOT="C:\Program Files\Epic Games\UE_5.5"
npm run preflight:fenix3d-gpu
npm run build:fenix3d-native
```

O preflight verifica Windows, Node, Unreal Build/Automation Tool e NVIDIA GPU.

## Package Win64

```powershell
$env:FENIX_UNREAL_ARCHIVE_DIR="C:\Fenix\Builds\Fenix3D"
npm run package:fenix3d
```

O comando usa `RunUAT BuildCookRun` com build/cook/stage/pak/archive e falha se não encontrar `Fenix3D.exe` no archive.

## Configuração do GPU Node

Copie:

```text
deploy/gpu-node/fenix3d-gpu.env.example
```

para um arquivo local fora do Git e configure pelo menos:

- `FENIX_RENDER_NODE_TOKEN`
- `FENIX_RENDER_RUNTIME_COMMAND`
- `FENIX_RENDER_RUNTIME_CWD`
- `FENIX_RENDER_STREAMER_URL_TEMPLATE`
- `FENIX_RENDER_PLAYER_URL_TEMPLATE`
- `FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE`

Nunca versionar o token real do Render Node nem credenciais TURN.

## Inicialização

```powershell
.\deploy\gpu-node\start-fenix-gpu-node.ps1 -EnvFile C:\Fenix\fenix3d-gpu.env
```

Para exigir também a presença local da infraestrutura Pixel Streaming:

```powershell
.\deploy\gpu-node\start-fenix-gpu-node.ps1 -EnvFile C:\Fenix\fenix3d-gpu.env -RequirePixelStreamingInfra
```

## Readiness

O antigo atraso fixo de inicialização não é mais suficiente para declarar uma sessão pronta.

Em `process mode` o launcher:

1. inicia `Fenix3D.exe` com `shell:false`;
2. aguarda o grace period mínimo;
3. consulta `FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE`;
4. somente registra o processo como pronto após resposta HTTP 2xx/3xx;
5. se houver timeout, encerra o processo e a alocação é revertida.

A URL pode apontar para um endpoint customizado do frontend/signalling ou reverse proxy. Para a validação completa futura, esse endpoint deverá representar o streamer específico identificado pelo `renderSessionId`.

## ICE / STUN / TURN

WebRTC pode exigir STUN/TURN quando navegador e GPU Node estão separados por NAT/firewalls. O arquivo:

```text
deploy/gpu-node/pixel-streaming-ice.example.json
```

é apenas um template sem credenciais reais. Configure os ICE servers no SignallingWebServer da infraestrutura Pixel Streaming da versão UE5.5.

## Smoke nativo

Depois de o Render Node estar rodando em `process mode`:

```powershell
$env:FENIX_RENDER_NODE_INTERNAL_URL="http://127.0.0.1:9000"
$env:FENIX_RENDER_NODE_TOKEN="<token interno>"
npm run smoke:fenix3d
```

O smoke exige por padrão:

- Render Node saudável;
- `runtimeMode=process`;
- launcher ativo;
- readiness configurada;
- criação de sessão real;
- PID de `Fenix3D.exe` associado à sessão;
- `readyAt` confirmado;
- frontend Pixel Streaming acessível;
- encerramento da sessão ao final para liberar GPU/VRAM.

## GitHub Actions self-hosted

`.github/workflows/fenix3d-native.yml` continua manual e exige runner:

```text
self-hosted + Windows + X64 + fenix3d
```

O runner precisa ter UE5.5, toolchain C++ compatível e GPU disponível. O workflow executa preflight, build nativo, package opcional e smoke opcional.

## Status de validação

Este marco prepara e testa estruturalmente o deployment no repositório. O build C++/package e o WebRTC real só podem ser declarados validados depois que o workflow self-hosted rodar em uma máquina GPU com UE5.5 e a infraestrutura Pixel Streaming configurada.
