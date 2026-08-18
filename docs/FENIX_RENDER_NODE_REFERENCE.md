# Fênix Reference Render Node

## Objetivo

`apps/render-node` é o serviço interno executado no servidor de render GPU. Ele implementa o contrato que o App Server consome:

- `GET /health`
- `POST /v1/render-sessions`
- `GET /v1/render-sessions/:renderSessionId`
- `DELETE /v1/render-sessions/:renderSessionId`

O navegador não chama este serviço diretamente. O App Server continua sendo o broker autenticado entre jogador, estado autoritativo e infraestrutura GPU.

## Fluxo

```text
Browser Fênix
    |
    | cookie/auth do jogador
    v
App Server / RemoteRenderBroker
    |
    | Bearer interno + rede privada
    v
Reference Render Node (GPU server)
    |
    +---- external mode ----> Pixel Streaming já implantado
    |
    +---- process mode -----> executável 3D supervisionado por sessão
                                  |
                                  v
                          Signalling / WebRTC
                                  |
                                  v
                             Browser Fênix
```

## Dois modos de runtime

### `external`

O Render Node controla alocação, capacidade e TTL, mas a infraestrutura 3D/Pixel Streaming já está em execução fora dele. Esse modo preserva integrações com clusters, containers, serviços gerenciados ou warm pools externos.

```env
FENIX_RENDER_RUNTIME_MODE=external
```

### `process`

O Render Node inicia e supervisiona um executável 3D empacotado para cada sessão alocada.

```env
FENIX_RENDER_RUNTIME_MODE=process
FENIX_RENDER_RUNTIME_COMMAND=/opt/fenix3d/Fenix3D.sh
FENIX_RENDER_RUNTIME_CWD=/opt/fenix3d
FENIX_RENDER_STREAMER_URL_TEMPLATE=ws://127.0.0.1:8888
```

O comando e diretório vêm somente da configuração do servidor GPU. O payload de jogador/sessão não pode escolher executável, shell ou argumentos privilegiados.

O launcher usa `spawn()` com `shell: false` e adiciona os argumentos de sessão necessários ao runtime:

```text
-RenderOffscreen
-PixelStreamingURL=<ws/wss do signalling>
-PixelStreamingWebRTCMaxFps=<fps solicitado>
-FenixRenderSessionId=<id>
-FenixCampaignId=<id>
-FenixSceneId=<id>
-FenixActorId=<id>
-FenixTokenId=<id>
```

Os argumentos `Fenix*` são o contrato interno para o futuro projeto/runtime 3D carregar o contexto correto da plataforma.

## Lifecycle GPU

No modo `process`:

1. o broker valida Campanha → Membership → Ator → Token → Cena;
2. o Render Node reserva um slot;
3. o launcher inicia o runtime 3D;
4. se o processo morrer durante o grace period, a reserva é revertida e o App Server recebe erro;
5. `DELETE` encerra o processo e libera a reserva;
6. TTL de sessão abandonada também dispara encerramento;
7. shutdown do Render Node executa `stopAll()` para reduzir risco de processos/VRAM órfãos.

O launcher tenta `SIGTERM` primeiro e usa término forçado depois do timeout configurado quando necessário.

## Configuração básica do Render Node

```env
FENIX_RENDER_NODE_HOST=0.0.0.0
FENIX_RENDER_NODE_PORT=9000
FENIX_RENDER_NODE_ID=render-gpu-01
FENIX_RENDER_NODE_REGION=br-1
FENIX_RENDER_NODE_TOKEN=um-segredo-interno-forte
FENIX_RENDER_NODE_CAPACITY=2
FENIX_RENDER_SESSION_TTL_MS=1800000
FENIX_RENDERER_KIND=unreal-pixel-streaming
FENIX_RENDER_PLAYER_URL_TEMPLATE=https://stream.example.com/player?renderSessionId={renderSessionId}&actorId={actorId}
FENIX_RENDER_SIGNALLING_URL_TEMPLATE=wss://stream.example.com/signalling/{renderSessionId}
```

Placeholders do player/signalling:

- `{renderSessionId}`
- `{campaignId}`
- `{sessionId}`
- `{sceneId}`
- `{actorId}`
- `{tokenId}`

Os valores inseridos nesses templates são URL-encoded.

## Configuração process mode

Exemplo Linux:

```env
FENIX_RENDER_RUNTIME_MODE=process
FENIX_RENDER_RUNTIME_COMMAND=/opt/fenix3d/Fenix3D.sh
FENIX_RENDER_RUNTIME_CWD=/opt/fenix3d
FENIX_RENDER_STREAMER_URL_TEMPLATE=ws://127.0.0.1:8888
FENIX_RENDER_RUNTIME_EXTRA_ARGS_JSON=["-ResX={maxWidth}","-ResY={maxHeight}"]
FENIX_RENDER_RUNTIME_STARTUP_GRACE_MS=2500
FENIX_RENDER_RUNTIME_STOP_TIMEOUT_MS=5000
```

Exemplo Windows:

```env
FENIX_RENDER_RUNTIME_MODE=process
FENIX_RENDER_RUNTIME_COMMAND=C:\Fenix3D\Fenix3D.exe
FENIX_RENDER_RUNTIME_CWD=C:\Fenix3D
FENIX_RENDER_STREAMER_URL_TEMPLATE=ws://127.0.0.1:8888
```

Placeholders aceitos nos argumentos extras:

- `{renderSessionId}`
- `{campaignId}`
- `{sessionId}`
- `{sceneId}`
- `{actorId}`
- `{tokenId}`
- `{targetFps}`
- `{maxWidth}`
- `{maxHeight}`

## Inicialização

No servidor GPU:

```bash
npm ci
npm run start:render-node
```

O App Server aponta para o serviço interno:

```env
FENIX_RENDER_NODE_URL=http://gpu-render.internal:9000
FENIX_RENDER_NODE_TOKEN=o-mesmo-segredo-interno
```

## Infraestrutura que continua separada

O launcher supervisiona o executável 3D, mas signalling, frontend/player WebRTC, TURN/STUN e eventual SFU continuam componentes de infraestrutura próprios. O `FENIX_RENDER_STREAMER_URL_TEMPLATE` indica onde o executável 3D deve registrar seu streamer; `FENIX_RENDER_PLAYER_URL_TEMPLATE` indica o endpoint público que o thin client Fênix pode incorporar.

## Segurança

- mantenha a porta do Render Node em rede privada sempre que possível;
- `FENIX_RENDER_NODE_TOKEN` nunca deve ser `NEXT_PUBLIC_*`;
- browser recebe somente descritor público pelo Remote Render Broker;
- health exige Bearer por padrão;
- comando do runtime nunca vem do navegador;
- `shell` permanece desativado no launcher;
- streamer URL aceita somente `ws://` ou `wss://`;
- player URL aceita somente `http://` ou `https://`;
- movimento, visão, colisão e regras permanecem autoridade do Fênix Core, não do renderer.

## Próximo estágio

O processo Unreal agora pode ser iniciado de forma segura, mas ele ainda precisa receber o **World Bootstrap** real. O próximo marco deve fornecer ao runtime 3D um snapshot autenticado por `renderSessionId` contendo Cena física, Token persistente, Actor/Sheet resolvido, altura dos olhos, visão, iluminação e elevação. A partir daí a câmera First Person poderá nascer do mesmo estado usado pela Top View.
