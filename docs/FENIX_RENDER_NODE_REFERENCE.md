# Fênix Reference Render Node

## Objetivo

`apps/render-node` é o serviço interno executado no servidor de render GPU. Ele implementa o contrato que o App Server já consome:

- `GET /health`
- `POST /v1/render-sessions`
- `GET /v1/render-sessions/:renderSessionId`
- `DELETE /v1/render-sessions/:renderSessionId`

Ele é o **control plane** da primeira pessoa remota. O navegador não chama este serviço diretamente.

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
    | playerUrl público
    v
Pixel Streaming / runtime 3D já implantado
    |
    | WebRTC vídeo/áudio + input
    v
Browser Fênix
```

## O que este serviço faz

- exige Bearer interno por padrão;
- anuncia capacidade e slots disponíveis;
- cria uma alocação para `campaignId + sceneId + actorId + tokenId`;
- reaproveita a mesma alocação enquanto ela estiver ativa;
- limita sessões simultâneas por GPU/node;
- expira sessões abandonadas por TTL;
- produz `playerUrl` e `signallingUrl` a partir de templates configurados;
- libera a alocação quando o App Server encerra a sessão.

## O que este serviço ainda NÃO faz

Este marco **não inicia, encerra nem supervisiona um processo Unreal Engine**. Ele pressupõe que um runtime 3D/Pixel Streaming já esteja implantado e tenha uma forma pública de selecionar/rotear a sessão indicada no template.

O próximo estágio adicionará um launcher/orchestrator real. Esse launcher poderá iniciar uma instância de runtime por sessão, usar containers/processos previamente aquecidos ou encaminhar a sessão para uma infraestrutura Pixel Streaming externa.

## Configuração do processo GPU

Exemplo:

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

Placeholders suportados:

- `{renderSessionId}`
- `{campaignId}`
- `{sessionId}`
- `{sceneId}`
- `{actorId}`
- `{tokenId}`

Todos os valores inseridos nos templates são URL-encoded.

## Inicialização

No servidor GPU, a partir do repositório instalado:

```bash
npm ci
npm run start:render-node
```

O App Server aponta para este serviço usando:

```env
FENIX_RENDER_NODE_URL=http://gpu-render.internal:9000
FENIX_RENDER_NODE_TOKEN=o-mesmo-segredo-interno
```

## Segurança

- mantenha a porta 9000 em rede privada sempre que possível;
- `FENIX_RENDER_NODE_TOKEN` nunca deve ser variável `NEXT_PUBLIC_*`;
- o browser recebe somente `playerUrl`/descritor público por meio do Remote Render Broker;
- health exige Bearer por padrão;
- `FENIX_RENDER_NODE_PUBLIC_HEALTH=true` deve ser usado apenas quando a topologia exigir;
- movimento, visão, colisão e regras permanecem autoridade do Fênix Core, não do renderer.

## Escala futura

A interface do App Server já aceita mais de um Render Node por meio do `RenderNodeGateway`. O estágio de scheduler poderá acrescentar telemetria de GPU, afinidade regional, fila, warm pools e distribuição de sessões sem mudar o contrato do VTT.
