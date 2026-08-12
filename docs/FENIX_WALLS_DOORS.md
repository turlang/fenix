# Fênix VTT — Walls + Doors Authoring

## Objetivo

Este marco adiciona geometria autoritativa de paredes e portas às cenas persistentes do Fênix VTT. O objetivo é dar ao Mestre uma ferramenta visual de preparação do battlemap e estabelecer um contrato estável que será reutilizado por colisão, Fog of War, line-of-sight e iluminação dinâmica.

O authoring permanece fora do `SessionDirector` e do Shared Core narrativo.

## Modelo da cena

Cada cena pode conter `walls`:

```json
[
  {
    "id": "wall-1",
    "kind": "wall",
    "a": { "x": 140, "y": 210 },
    "b": { "x": 560, "y": 210 },
    "doorState": null
  },
  {
    "id": "door-1",
    "kind": "door",
    "a": { "x": 560, "y": 210 },
    "b": { "x": 630, "y": 210 },
    "doorState": "closed"
  }
]
```

Tipos:

- `wall`: parede permanente;
- `door`: abertura controlável.

Estados de porta:

- `open`: aberta;
- `closed`: fechada;
- `locked`: trancada.

O contrato puro fica em `packages/scene-geometry`. Ele também expõe as regras deriváveis `wallBlocksMovement()` e `wallBlocksVision()`: paredes e portas fechadas/trancadas bloqueiam; portas abertas não bloqueiam. Neste marco essas funções definem o contrato futuro, mas a colisão e o recorte visual ainda não são aplicados ao renderer.

## Normalização e limites

A geometria é validada antes de ser persistida:

- no máximo 2.000 segmentos por cena;
- coordenadas limitadas às dimensões da cena;
- segmento mínimo de 2 px;
- IDs duplicados são recusados;
- porta sem estado explícito assume `closed`;
- cada segmento recebe ID persistente;
- pontos podem ser alinhados à grade pelo editor.

## API

Somente um membro `gm` pode alterar a geometria:

```text
POST /v1/campaigns/:campaignId/scenes/:sceneId/walls
```

Body:

```json
{
  "walls": [
    {
      "id": "door-1",
      "kind": "door",
      "doorState": "closed",
      "a": { "x": 560, "y": 210 },
      "b": { "x": 630, "y": 210 }
    }
  ]
}
```

Jogadores podem receber a geometria da cena, porém não podem alterar `walls`.

## Editor do Mestre

Em uma cena real, o Mestre usa o botão `Paredes` na toolbar do mapa.

Ferramentas:

- **Parede** — clique no ponto inicial e depois no ponto final;
- **Porta** — cria um segmento do tipo porta, escolhendo o estado inicial;
- **Alternar porta** — clique próximo de uma porta para percorrer `closed → open → locked → closed`;
- **Apagar** — remove o segmento mais próximo;
- **Snap na grade** — alinha os pontos ao grid calibrado da cena;
- **Desfazer** — volta a última alteração local;
- **Cancelar** — descarta o draft local;
- **Salvar paredes** — valida e persiste o conjunto completo.

O overlay de authoring é mostrado apenas ao Mestre. O estado salvo continua disponível para os clientes dos jogadores por meio da cena autoritativa.

## Pan, zoom e grid

A geometria é armazenada em coordenadas do mundo. A camada SVG do editor converte essas coordenadas para a tela usando o mesmo viewport do mapa, portanto os segmentos permanecem alinhados quando o Mestre usa pan ou zoom.

O snap usa `grid.size`, `grid.offsetX` e `grid.offsetY`, compartilhando a mesma calibração introduzida no marco anterior.

## Realtime

`runtimeScene()` inclui `walls`. Quando o Mestre salva a geometria de uma cena ativa:

1. o Engine persiste a cena;
2. o catálogo local é atualizado;
3. o cliente GM envia `SCENE_UPDATE`;
4. o `RealtimeSessionGateway` normaliza novamente a geometria;
5. todos os peers recebem `SCENE_UPDATED` com a mesma lista de paredes e portas;
6. o snapshot realtime persistente carrega essa geometria em reconnect/failover.

Jogadores continuam proibidos de emitir `SCENE_UPDATE` autoritativo.

## Segurança e fronteiras

- alteração de paredes é GM-only no servidor;
- a UI não é tratada como fronteira de autorização;
- o servidor normaliza novamente qualquer payload recebido;
- o `SessionDirector` não conhece `scene-geometry` nem authoring;
- nenhuma regra do adapter Foundry alpha.24 foi alterada;
- geometria não contém segredo narrativo ou dado de autenticação.

## Limite deliberado deste marco

**Walls + Doors Authoring não implementa ainda colisão de tokens, Fog of War, line-of-sight ou iluminação dinâmica.**

O contrato já diferencia o que deve bloquear movimento/visão, mas a aplicação espacial dessas regras pertence ao próximo marco. Isso evita acoplar a ferramenta de edição ao renderer ou ao Shared Core narrativo antes de haver testes próprios de geometria computacional.

## Próxima evolução

A próxima entrega recomendada é **Fog of War + Token Line of Sight**, usando `scene.walls` como fonte autoritativa para:

- recorte de visibilidade por token;
- portas abertas/fechadas alterando LOS em tempo real;
- área explorada persistente por campanha/usuário;
- base para Dynamic Lighting posterior.
