# Fênix Shared Core Architecture

## Regra central

O domínio não sabe qual VTT originou o evento. Foundry, Fênix Standalone e adapters futuros traduzem seus modelos nativos para contratos universais antes de entrar no pipeline.

```text
Foundry Adapter ───────┐
Standalone Adapter ────┼──> VTT Contracts ──> SessionDirector ──> Narration Output
Future Adapter ────────┘                         │
                                                ├── Intent
                                                ├── Rules
                                                ├── Relationship
                                                ├── Narration + Guards
                                                └── Audio Directive
```

## Ports

### VttContextPort

Implementa `sync()` e retorna um `GameSnapshot` normalizado. O adapter pode possuir `setSnapshot()` quando o transporte entrega snapshots explicitamente pela API.

### NarrationOutputPort

Implementa `publishNarration(content, metadata)`. O domínio não conhece chat do Foundry, DOM, socket de cliente ou componente Next.js.

### Eventos universais

- `PLAYER_ACTION`
- `ROOM_ENTERED`

A regra alpha.24 de correlação Scene/Journal/número da sala permanece no adapter Foundry. O Core recebe somente o `ROOM_ENTERED` já resolvido com âncora canônica.

## Compatibilidade alpha.24

`createSessionRuntime()` ainda aceita temporariamente `foundryApi` e `publishChat`. Esses nomes são aliases de borda; o `SessionDirector` utiliza somente `contextPort` e `narrationOutput`.

## Segurança narrativa

O provider usa um System Prompt versionado. SafetyGuard, QualityGuard e NoveltyGuard continuam sendo barreiras pós-geração. Prompt não substitui guard determinístico.

Princípios:

- grounding em fonte canônica;
- proibição de vazamento de conteúdo reservado;
- agência do jogador preservada;
- sem invenção de fatos não sustentados;
- sem metadados do VTT na narração;
- variação narrativa controlada pelo NoveltyGuard.

## Áudio emocional

O texto é a resposta crítica. Síntese neural é um fluxo posterior e substituível.

```text
Narration Ready ───────────────> VTT recebe texto
      │
      └── AudioJob ──> Priority Queue ──> Cache ──> Neural TTS
                                              │
                                      Audio Ready Event
                                              │
                                              └──> VTT
```

Prioridades iniciais:

1. entrada de sala/cutscene;
2. resolução de ação;
3. diálogo NPC;
4. ambiente.

Falha de TTS nunca invalida `room-entry`, `action`, `start` ou a sessão. O fallback continua sendo Browser-TTS ou somente texto.

### Marcadores

Marcadores permitidos: `[calmo]`, `[tenso]`, `[sussurro]`, `[urgente]`, `[pausa]`.

Eles são desligados por padrão enquanto o canal principal for Browser-TTS. Quando habilitados, `AudioNarrationService` converte os marcadores em segmentos e remove os tokens do texto que será falado.

## Backend HTTP

```text
server.js                 composition root
  ↓
app.js                    Fastify/CORS/error handler/health
  ↓
register-session-routes   rotas + schemas
  ↓
session-controller       tradução HTTP
  ↓
sessionService/runtime   application layer
  ↓
SessionDirector           domínio/orquestração
  ↓
Services + Memory Repo    regras, relações, narração, persistência
```

Controllers não importam RulesService, RelationshipService ou NarrationService.

## Próxima fronteira

Depois desta extração, um adapter standalone pode fornecer `GameSnapshot`, `PLAYER_ACTION` e `ROOM_ENTERED` sem qualquer alteração no SessionDirector. Essa prova deve acontecer antes de iniciar renderer multiplayer completo.
