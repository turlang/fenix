# Fênix Reference Render Node

## Objetivo

`apps/render-node` é o serviço interno executado no servidor de render GPU. O navegador não chama este serviço diretamente; o App Server continua sendo o broker autenticado entre jogador, estado autoritativo e infraestrutura GPU.

API interna principal:

- `GET /health`
- `POST /v1/render-sessions`
- `GET /v1/render-sessions/:renderSessionId`
- `DELETE /v1/render-sessions/:renderSessionId`

Runtime 3D process mode também recebe um endpoint efêmero:

- `GET /v1/runtime/bootstrap/:renderSessionId`

Esse endpoint usa um token exclusivo daquela sessão, diferente do Bearer administrativo do Render Node.

## Fluxo

```text
Browser Fênix
    |
    v
App Server / RemoteRenderBroker
    |
    | valida Campaign -> Actor -> Token -> Scene
    | monta World Bootstrap
    | Bearer interno
    v
Reference Render Node
    |
    | reserva GPU/session
    | gera runtimeAccessToken efêmero
    v
Runtime 3D supervisionado
    |
    | FENIX_WORLD_BOOTSTRAP_URL
    | FENIX_WORLD_BOOTSTRAP_TOKEN
    v
GET /v1/runtime/bootstrap/:renderSessionId
    |
    v
Cena física + Viewer Token + Actor/Sheet + câmera
    |
    v
Signalling / WebRTC -> Browser
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

## World Bootstrap

`packages/render-world-bootstrap` cria o snapshot autoritativo enviado ao Render Node. O browser não recebe esse objeto.

O bootstrap contém:

- Campaign/System;
- Scene id, dimensões e background asset id;
- grid + escala física, com default de `1.5 m` por célula;
- walls;
- lighting;
- elevation/levels;
- floor/stair/ramp regions;
- Fog explorado apenas para o viewer;
- tokens visíveis para aquele usuário;
- Actor/Sheet resolvido;
- viewer Token persistente;
- movimento resolvido;
- visão/sentido resolvido;
- câmera First Person derivada de `token.elevation + actor.eyeHeight`.

Exemplo conceitual:

```json
{
  "schema": "fenix.render-world-bootstrap",
  "version": 1,
  "viewer": {
    "camera": {
      "sceneX": 350,
      "sceneY": 420,
      "groundElevation": 3,
      "eyeHeight": 1.58,
      "elevation": 4.58,
      "unit": "m"
    }
  }
}
```

## Credencial efêmera do runtime

Cada `renderSessionId` recebe um `runtimeAccessToken` aleatório de uso interno. Ele:

- não aparece no descriptor WebRTC;
- não aparece na resposta do broker para o navegador;
- não é o `FENIX_RENDER_NODE_TOKEN` administrativo;
- só autoriza o bootstrap daquela sessão;
- deixa de funcionar assim que a sessão é removida/expira.

No process mode o launcher injeta somente no ambiente do processo:

```text
FENIX_WORLD_BOOTSTRAP_URL=http://127.0.0.1:9000/v1/runtime/bootstrap/<renderSessionId>
FENIX_WORLD_BOOTSTRAP_TOKEN=<token efêmero>
```

O endereço pode ser ajustado com:

```env
FENIX_RENDER_RUNTIME_BOOTSTRAP_BASE_URL=http://127.0.0.1:9000
```

## Lifecycle GPU

1. App Server autoriza o jogador e monta o World Bootstrap.
2. Render Node reserva um slot.
3. Process mode inicia o runtime 3D.
4. Early exit reverte a reserva.
5. Runtime busca apenas seu bootstrap.
6. `DELETE` encerra processo e sessão.
7. TTL encerra sessões abandonadas.
8. Shutdown executa `stopAll()`.

## Segurança

- porta administrativa do Render Node deve ficar em rede privada;
- `FENIX_RENDER_NODE_TOKEN` nunca deve ser enviado ao browser;
- World Bootstrap nunca integra o descriptor público;
- Fog de outros atores não entra no bootstrap do jogador;
- runtime token é escopado a uma única sessão;
- comando do runtime nunca vem do payload do jogador;
- `shell` permanece desativado;
- streamer aceita somente `ws://`/`wss://`;
- player público aceita somente `http://`/`https://`;
- movimento, visão, colisão e regras continuam autoridade do Fênix Core.

## Próximo estágio

O próximo marco é o **Fênix 3D Runtime Adapter**: definir como o projeto Unreal interpreta o World Bootstrap, converte coordenadas 2D/escala física para o mundo 3D, cria a câmera na altura dos olhos, materializa walls/doors/floors/ramps/lights e devolve inputs de movimento como intents ao Core em vez de movimentar o personagem localmente como autoridade.
