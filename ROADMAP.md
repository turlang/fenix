# Fênix VTT — Roadmap Estratégico

> Este documento define **para onde o Fênix está indo e em qual ordem**. A visão resumida do produto, requisitos e modelo de negócio ficam no [`README.md`](README.md). Mudanças já implementadas pertencem ao [`CHANGELOG.md`](CHANGELOG.md).

## Objetivo estratégico

Evoluir o Fênix de um VTT com IA para um **motor de RPG persistente dirigido por um Mestre IA 4D**.

No Fênix, **4D = X + Y + Z + T**: três dimensões espaciais autoritativas mais a evolução temporal persistente do mundo. O objetivo é consciência operacional do estado do jogo, não consciência humana.

A regra arquitetural central é:

> **saber → compreender → simular → improvisar → dirigir.**

Por isso, conhecimento confiável precede autonomia. Regras, lore e fatos da campanha não devem depender da memória pré-treinada do LLM como fonte de verdade.

## Princípios de evolução

1. Conhecimento antes de autonomia.
2. Rules Truth vem de fontes autorizadas e resolução estruturada sempre que possível.
3. World Truth é autoritativa e não pode ser inventada pelo LLM.
4. Proveniência acompanha conhecimento e mudanças relevantes.
5. Realidade, percepção e conhecimento são estados diferentes.
6. Tempo integra o estado do mundo.
7. Improvisação ocorre dentro dos limites de coerência.
8. Campanhas são espaços de possibilidades, não roteiros rígidos.
9. O mundo visual deriva do mesmo modelo semântico da campanha.
10. Narrativa inclui direção e performance, não apenas geração de texto.
11. VR é uma interface sobre o World Model compartilhado.
12. Direitos, licenças, privacidade e escopo de acesso fazem parte da arquitetura de conteúdo.

## Sequência estratégica

```text
VTT Reliability
      ↓
Knowledge Foundation
      ↓
Rule Compiler + World Compiler
      ↓
Campaign Compiler + Provenance
      ↓
Creative Boundary Engine
      ↓
World Authority
      ↓
Spatial World Model
      ↓
Perception & Knowledge
      ↓
Temporal Memory
      ↓
Causal Simulation
      ↓
NPC Cognition
      ↓
Narrative Intelligence
      ↓
Narrative Performance
      ↓
Autonomous GM
      ↓
Mestre IA 4D
      ↓
VR / Spatial RPG
      ↓
Persistent Multimodal World
```

# Fases

## Fase 0 — Fundação VTT confiável

**Objetivo:** estabilizar a plataforma que hospedará conhecimento e simulação.

Escopo principal:
- cenas, tokens, personagens e permissões;
- grid, paredes, portas e Fog/LOS;
- multiplayer e persistência;
- runtime distribuído e eventos realtime;
- streaming 3D manipulável com qualidade adequada;
- colisão, iluminação e elevação.

**Gate:** o estado operacional do VTT é confiável o suficiente para sustentar a autoridade do mundo.

## Fase 1 — Knowledge Foundation

**Objetivo:** criar a camada comum de conhecimento, fontes, relações, confiança, proveniência, licença e escopo de acesso.

Proveniência mínima:

```text
CANON
DERIVED
GENERATED
IMPROVISED
PLAYER_CAUSED
```

**Gate:** informação relevante consegue declarar origem, escopo e confiabilidade.

## Fase 2 — Rule Compiler

**Objetivo:** transformar material de regras permitido em conhecimento mecânico consultável e progressivamente executável.

Pipeline:

```text
Rule Source → Parsing → Semantic Extraction → Rules Knowledge → Validation → Rules Engine
```

Deve representar entidades mecânicas, gatilhos, condições, cálculos, testes, efeitos, exceções, precedência e referências à fonte.

**Gate:** ações importantes recuperam a regra correta e, quando formalizada, são resolvidas sem pedir ao LLM que invente a mecânica.

## Fase 3 — World Compiler

**Objetivo:** transformar cenário, aventura e material narrativo autorizado em representação semântica do universo.

Pipeline:

```text
Source Material → World Analysis → Entities / Relations / Timeline / Geography → World Knowledge → World DNA
```

O modelo deverá representar geografia, personagens, culturas, facções, história, política, cosmologia, criaturas, objetos, relações, segredos, cronologia, economia, arquitetura, estética e atmosfera conforme as fontes disponíveis.

**Gate:** o Fênix responde fatos importantes sobre o universo preservando proveniência e distinguindo fato explícito de inferência.

## Fase 4 — Campaign Compiler

**Objetivo:** combinar sistema, mundo e premissa em um modelo jogável.

```text
SYSTEM + WORLD + CAMPAIGN / ADVENTURE → Playable Campaign Model
```

Deve suportar campanhas e one-shots criados ou importados, sandbox, histórias paralelas e modos de fidelidade ao material.

**Gate:** uma sessão pode partir do Campaign Model sem depender de roteiro textual linear.

## Fase 5 — Creative Boundary Engine

**Objetivo:** permitir improvisação sem corromper regras, lore ou continuidade.

Quanto maior a definição existente, menor a liberdade para contradizê-la. Quanto maior a lacuna, maior a liberdade criativa. Toda criação relevante recebe proveniência.

**Gate:** desvios importantes dos jogadores podem gerar conteúdo novo coerente com sistema, cultura, geografia, cronologia e estado atual.

## Fase 6 — World Authority

**Objetivo:** consolidar a fonte de verdade do mundo jogável, incluindo identidade, tipo, posição, orientação, estado, ownership, relações, proveniência e timestamps.

**Gate:** fatos autoritativos deixam de depender de interpretação livre do LLM.

## Fase 7 — Spatial World Model

**Objetivo:** transformar o mundo semântico em espaço jogável e semanticamente compreendido.

Inclui X/Y/Z, regiões, volumes, terreno, assentamentos, interiores, objetos, conectividade, elevação, distância, cobertura, colisão, LOS, iluminação, som e relações espaciais.

A materialização deve ser incremental: alta resolução onde o jogo exige e representação abstrata onde ainda não exige.

**Gate:** uma parte relevante do Campaign/World Model pode ser materializada em espaço 3D funcional, não apenas visual.

## Fase 8 — Perception & Knowledge Engine

**Objetivo:** separar World Truth de percepção, crença, memória e conhecimento individual.

**Gate:** o Mestre IA sabe o que pode revelar para cada jogador e NPC.

## Fase 9 — Temporal Memory

**Objetivo:** incorporar T ao World Model, registrando ações, mudanças, observadores e tempo de mundo/sessão.

**Gate:** o sistema consulta onde algo está, onde estava, quando mudou e quem presenciou a mudança.

## Fase 10 — Causal Simulation

**Objetivo:** modelar ação → consequência → novo estado.

Inclui grafo causal, consequências atrasadas, propagação de informação, eventos mundiais e evolução de conflitos fora da atenção imediata dos jogadores.

**Gate:** o mundo consegue explicar por que seu estado atual existe.

## Fase 11 — NPC Cognition

**Objetivo:** manter NPCs com percepção, memória, crenças, emoções, objetivos e relações persistentes.

```text
KNOWS → BELIEVES → FEELS → WANTS → SAYS → DOES
```

**Gate:** NPCs mantêm coerência social e psicológica entre cenas e sessões.

## Fase 12 — Narrative Intelligence

**Objetivo:** transformar estado e simulação em direção dramática.

Inclui intenção narrativa, tema, ritmo, tensão, mistério, revelações, pistas, consequências, subtexto e decisão entre narrar, perguntar, agir, esperar ou permanecer em silêncio.

**Gate:** a IA dirige cenas sem alterar arbitrariamente fatos autoritativos.

## Fase 13 — Narrative Performance Engine

**Objetivo:** transformar intenção narrativa em performance natural.

Inclui emoção, intensidade, ritmo, pausas, respiração, hesitação, volume, identidade vocal, música, soundscape, iluminação, áudio espacial e silêncio dramático.

**Gate:** ambiente, sensação, estado emocional e intenção são transmitidos sem exposição artificial ou sensação predominante de texto lido por TTS.

## Fase 14 — Autonomous GM / Director AI

**Objetivo:** observar o estado continuamente e decidir quando e como intervir usando regras, narração, NPCs, encontros, música, ambiente, iluminação ou `NO_ACTION`.

**Gate:** sessões prolongadas permanecem coerentes com supervisão humana opcional.

## Fase 15 — Mestre IA 4D

**Objetivo:** integrar regras, mundo, campanha, espaço, tempo, percepção, conhecimento, emoção, causalidade e possibilidades futuras em uma única direção de jogo.

**Gate:** improvisação e narração permanecem coerentes com Rules Truth, World Truth, Character Knowledge e Temporal Truth durante sessões prolongadas.

## Fase 16 — VR / Spatial RPG

**Objetivo:** colocar jogadores dentro do mesmo World Model compartilhado por desktop e outras interfaces.

Inclui tracking compatível de cabeça/mãos, orientação corporal, interação espacial, áudio 3D, percepção por ponto de vista e sinais multimodais quando suportados.

**Gate:** VR adiciona interação espacial sem criar um segundo estado de mundo ou uma segunda lógica de jogo.

## Fase 17 — Mundo persistente multimodal

**Objetivo de horizonte:** permitir regiões em evolução contínua, NPCs autônomos, geração procedural semântica, memória de longo prazo, múltiplas interfaces e expansão incremental de mundos criados ou importados.

**Gate:** o mundo mantém continuidade de longo prazo enquanto diferentes modalidades e grupos interagem com a mesma autoridade de estado, dentro das regras de produto definidas.

## Fênix World Compiler

**Fênix World Compiler** é o nome do eixo que converte conhecimento em mundo jogável:

```text
Rules ───────→ Rule Compiler ──────┐
                                   │
World Sources → World Compiler ────┼→ Campaign Model → World Model
                                   │                         ↓
Adventure ───→ Campaign Compiler ──┘                 Spatial Compiler
                                                             ↓
                                                       3D / 4D World
                                                             ↓
                                                        Simulation
                                                             ↓
                                                        Mestre IA 4D
```

## Critério final

O Fênix deve conseguir **compreender as regras escolhidas, compreender o material importado ou criado, convertê-lo em um mundo jogável, preservar proveniência, acompanhar o mundo em X + Y + Z + T, resolver ações segundo as regras, improvisar dentro da coerência e dirigir/narrar uma experiência dramática natural**.

O estado real de implementação de cada entrega deve ser registrado no [`CHANGELOG.md`](CHANGELOG.md), e não inferido deste roadmap.