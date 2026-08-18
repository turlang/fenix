# Fênix Reference Render Node

## Objetivo

`apps/render-node` é o serviço interno executado no servidor de render GPU. O navegador não chama este serviço diretamente; o App Server continua sendo o broker autenticado entre jogador, estado autoritativo e infraestrutura GPU.

API interna principal:

- `GET /health`
- `POST /v1/render-sessions`
- `GET /v1/render-sessions/:renderSessionId`
- `DELETE /v1/render-sessions/:renderSessionId`

No `process mode`, cada processo 3D também recebe acesso efêmero ao seu manifest:

- `GET /v1/runtime/bootstrap/:renderSessionId`

Esse endpoint usa um token exclusivo da render session e não aceita o Bearer administrativo do Render Node.

## Fluxo

```text
Browser Fênix
    |
    v
App Server / RemoteRenderBroker
    |
    | valida Campaign -> Actor -> Token -> Scene
    | monta World Bootstrap
    | cria controlId/token efêmeros para input 3D
    v
Reference Render Node
    |
    | reserva GPU/session
    | transforma bootstrap em 3D Runtime Manifest
    | gera runtimeAccessToken efêmero
    v
Runtime 3D supervisionado
    |
    | FENIX_RUNTIME_MANIFEST_URL/TOKEN
    | FENIX_RUNTIME_CONTROL_URL/TOKEN
    v
Manifest + move/look/action
    |
    v
Fênix Core autoritativo
    |
    v
state-sync aceito -> Runtime 3D -> WebRTC -> Browser
```

## Modos de runtime

### `external`

A infraestrutura 3D/Pixel Streaming já existe fora do processo do Render Node. O node cuida de alocação, capacidade, TTL e descritores públicos.

```env
FENIX_RENDER_RUNTIME_MODE=external
```

### `process`

O Render Node inicia e supervisiona um executável 3D por sessão.

```env
FENIX_RENDER_RUNTIME_MODE=process
FENIX_RENDER_RUNTIME_COMMAND=/opt/fenix3d/Fenix3D.sh
FENIX_RENDER_RUNTIME_CWD=/opt/fenix3d
FENIX_RENDER_STREAMER_URL_TEMPLATE=ws://127.0.0.1:8888
```

O launcher usa `spawn()` com `shell: false`. Comando, cwd e argumentos privilegiados são definidos somente no servidor GPU.

Argumentos base:

```text
-RenderOffscreen
-PixelStreamingURL=<ws/wss>
-PixelStreamingWebRTCMaxFps=<fps>
-FenixRenderSessionId=<id>
-FenixCampaignId=<id>
-FenixSceneId=<id>
-FenixActorId=<id>
-FenixTokenId=<id>
```

## World Bootstrap e Runtime Manifest

`packages/render-world-bootstrap` cria o snapshot autoritativo privado. Em seguida, `packages/render-runtime-adapter` converte esse snapshot para:

```text
fenix.3d-runtime-manifest / v1
```

O browser não recebe nenhum desses objetos.

O manifest contém dados já preparados para um runtime 3D:

- dimensões de cena em pixels e centímetros;
- grid + escala física, default `1,5 m` por célula;
- walls/doors com faixa vertical em centímetros;
- elevation levels;
- floor/stair/ramp regions;
- luzes e raios em centímetros;
- entidades Token visíveis;
- viewer Actor/Sheet;
- câmera First Person;
- Fog explorado do viewer.

A conversão usa centímetros como unidade do runtime e inverte o eixo Y do canvas 2D.

Documentação detalhada: `docs/FENIX_3D_RUNTIME_ADAPTER.md`.

## Credencial efêmera do manifest

Cada `renderSessionId` recebe um `runtimeAccessToken` aleatório. Ele:

- não aparece no descriptor WebRTC;
- não aparece na resposta do broker para o navegador;
- não é `FENIX_RENDER_NODE_TOKEN`;
- só autoriza o manifest daquela sessão;
- deixa de funcionar quando a sessão é removida/expira.

No process mode o launcher injeta:

```text
FENIX_RUNTIME_MANIFEST_URL=http://127.0.0.1:9000/v1/runtime/bootstrap/<renderSessionId>
FENIX_RUNTIME_MANIFEST_TOKEN=<token efêmero>
```

Durante a migração, os aliases `FENIX_WORLD_BOOTSTRAP_URL/TOKEN` continuam disponíveis.

O endereço local pode ser alterado com:

```env
FENIX_RENDER_RUNTIME_BOOTSTRAP_BASE_URL=http://127.0.0.1:9000
```

## Canal de input do runtime 3D

Quando uma render session está associada a uma sessão VTT ativa e o App Server tem `FENIX_RENDER_CONTROL_BASE_URL` ou `FENIX_INSTANCE_PUBLIC_URL`, o broker cria outra credencial efêmera, específica para controle.

O launcher injeta no processo:

```text
FENIX_RUNTIME_CONTROL_ID=<controlId>
FENIX_RUNTIME_CONTROL_URL=https://api-internal/.../v1/runtime/render-control/<controlId>/input
FENIX_RUNTIME_CONTROL_TOKEN=<token efêmero>
```

O processo usa esse canal para enviar somente intents:

- `move`;
- `look`;
- `action`.

O runtime não pode enviar `x/y/z`, posição, transform, teleport, actorId, tokenId ou sceneId como autoridade. O App Server rejeita esses campos.

O `AuthoritativeRealtimeSessionGateway` existente continua responsável por:

- associação Token -> Actor;
- paredes/portas;
- limites da cena;
- elevação;
- regiões físicas;
- persistência;
- Fog/exploração.

A resposta para o runtime é `fenix.3d-runtime-state-sync`, contendo a posição aceita pelo Core.

## Lifecycle GPU

1. App Server autoriza jogador e monta World Bootstrap.
2. Broker cria o canal de controle efêmero, quando aplicável.
3. Render Node reserva slot e cria o Runtime Manifest.
4. Process mode inicia o runtime 3D.
5. Runtime busca somente seu manifest.
6. Runtime envia intents usando sua credencial de controle.
7. Core aceita/corrige o estado e devolve state-sync.
8. Early exit reverte a reserva.
9. `DELETE` encerra processo e sessão.
10. TTL encerra sessões abandonadas.
11. Shutdown executa `stopAll()`.

## Segurança

- porta administrativa do Render Node deve ficar em rede privada;
- `FENIX_RENDER_NODE_TOKEN` nunca deve ser enviado ao browser ou runtime 3D;
- Runtime Manifest nunca integra o descriptor público;
- Fog de outros atores não entra no manifest do jogador;
- manifest token e runtime-control token são credenciais diferentes e escopadas;
- runtime-control token não é cookie do jogador;
- comandos/paths do executável nunca vêm do navegador;
- `shell` permanece desativado;
- streamer aceita somente `ws://`/`wss://`;
- player público aceita somente `http://`/`https://`;
- movimento, visão, colisão e regras continuam autoridade do Fênix Core.

## Próximo estágio

O próximo marco é o **Unreal Runtime Skeleton / Fenix3D v0.1**: implementar no projeto Unreal o cliente do manifest, um world builder mínimo, um First Person Pawn e o cliente de `move/look/action` com reconciliação pelo state-sync.