# Fênix VTT — Roadmap Estratégico

> Evolução do Fênix de VTT com IA para um **mundo de RPG persistente, compilável a partir de regras e material narrativo, compreendido e dirigido por um Mestre IA 4D**.

## Visão

O Mestre IA precisa primeiro **saber**, depois **compreender**, depois **simular**, e somente então ganhar autonomia para **improvisar e dirigir**.

A Knowledge Foundation torna-se prioridade arquitetural. O Fênix não deve depender do conhecimento pré-treinado do LLM como fonte de verdade para regras, lore ou campanha.

### 4D no Fênix

**4D = X + Y + Z + T.**

- X, Y e Z representam espaço tridimensional autoritativo.
- T representa a evolução temporal persistente do mundo.

O objetivo é consciência operacional espaço-temporal, não consciência humana: saber o que existe, onde está, quando mudou, quem percebeu, quais regras se aplicam, por que aconteceu e quais consequências permanecem ativas.

---

# Princípios prioritários

1. **Conhecimento antes de autonomia.**
2. **Rules Truth é externa ao LLM.** Regras aplicáveis devem vir de fontes autorizadas/importadas e de execução estruturada quando possível.
3. **World Truth é autoritativa.** A IA não inventa geometria ou fatos já estabelecidos.
4. **Proveniência é obrigatória.** Diferenciar `CANON`, `DERIVED`, `GENERATED`, `IMPROVISED` e `PLAYER_CAUSED`.
5. **Realidade, percepção e conhecimento são diferentes.**
6. **Tempo faz parte do estado.**
7. **Improvisação é permitida dentro de limites de coerência.**
8. **Campanhas são espaços de possibilidades, não roteiros rígidos.**
9. **O mundo virtual nasce do mesmo modelo semântico da campanha.**
10. **Narrativa é performance.**
11. **VR é uma interface sobre o World Model, não uma arquitetura separada.**
12. **Direitos e licenças são parte da arquitetura de conteúdo.**

---

# Fases evolutivas

## Fase 0 — Fundação VTT confiável

**Objetivo:** estabilizar a plataforma que hospedará o conhecimento e a simulação.

- cenas, tokens, personagens e permissões;
- grid, paredes, portas e Fog/LOS;
- multiplayer e persistência;
- runtime distribuído;
- streaming 3D manipulável com qualidade adequada;
- colisão;
- iluminação/elevação;
- eventos realtime duráveis.

**Gate:** o estado operacional do VTT é confiável para servir de base à autoridade do mundo.

## Fase 1 — Knowledge Foundation

**Objetivo:** criar a camada comum para regras, lore, campanhas, fontes e proveniência.

Estruturas mínimas:

```text
KnowledgeEntity
SourceReference
KnowledgeRelation
Confidence
Provenance
LicenseMetadata
AccessScope
```

Categorias de proveniência:

```text
CANON
DERIVED
GENERATED
IMPROVISED
PLAYER_CAUSED
```

Qualificadores:

```text
immutable
mutable
hidden
uncertain
rumor
false_information
```

**Gate:** toda informação relevante pode indicar de onde veio, seu escopo e sua confiabilidade.

## Fase 2 — Rule Compiler

**Objetivo:** transformar material de regras permitido em conhecimento mecânico consultável e progressivamente executável.

O Fênix poderá distribuir nativamente apenas conteúdo cuja licença permita o uso correspondente, incluindo sistemas abertos e materiais compatíveis com OGL, ORC, Creative Commons ou outras permissões aplicáveis.

Material privado fornecido pelo Mestre deverá permanecer privado e não será tratado como conteúdo redistribuível do produto.

Pipeline:

```text
Rule Source
    ↓
Document Parsing
    ↓
Semantic Rule Extraction
    ↓
Rules Knowledge Graph
    ↓
Validation / Provenance
    ↓
Rules Engine Representation
```

Extrair:

- entidades mecânicas;
- gatilhos;
- condições;
- cálculos;
- testes;
- efeitos;
- exceções;
- precedência;
- relações entre regras;
- referências à fonte.

**Gate:** ações importantes podem recuperar a regra correta e, quando formalizada, resolvê-la sem pedir ao LLM para inventar a mecânica.

## Fase 3 — World Compiler

**Objetivo:** transformar cenário, aventura ou material narrativo em representação semântica do universo.

Extrair:

- geografia;
- regiões e locais;
- personagens;
- povos e culturas;
- facções;
- história e política;
- cosmologia;
- criaturas;
- itens e artefatos;
- relações;
- segredos;
- cronologia;
- economia;
- arquitetura;
- estética e atmosfera;
- temas;
- regras implícitas do mundo.

Pipeline:

```text
Source Material
      ↓
Literary / World Analyzer
      ↓
Entities + Relations + Timeline + Geography
      ↓
World Knowledge Graph
      ↓
World DNA
```

**Gate:** o Fênix consegue responder fatos importantes sobre o universo citando sua proveniência e distinguindo fato explícito de inferência.

## Fase 4 — Campaign Compiler

**Objetivo:** combinar sistema, mundo e premissa em um modelo jogável.

```text
SYSTEM + WORLD + CAMPAIGN/ADVENTURE
                 ↓
         Playable Campaign Model
```

Suportar:

- one-shots gerados;
- campanhas geradas;
- aventuras importadas;
- cenários importados;
- campanhas sandbox;
- histórias paralelas a uma cronologia existente;
- modos de fidelidade ao material.

A campanha deve modelar situações, conflitos, objetivos, segredos, ameaças e possibilidades, não apenas uma sequência fixa de cenas.

**Gate:** o Mestre pode iniciar uma sessão a partir do Campaign Model sem depender de um roteiro textual linear.

## Fase 5 — Creative Boundary Engine

**Objetivo:** permitir improvisação sem corrupção de lore ou regras.

Política conceitual:

```text
mais fatos definidos pela fonte
        ↓
menor liberdade criativa

mais espaço não especificado
        ↓
maior liberdade criativa
```

Toda criação nova recebe proveniência. O motor verifica contradições antes de consolidar improvisações relevantes.

**Gate:** o Mestre IA consegue reagir a desvios importantes dos jogadores criando conteúdo novo coerente com sistema, cultura, geografia, cronologia e estado atual.

## Fase 6 — World Authority

**Objetivo:** consolidar a fonte de verdade do mundo jogável.

```text
Entity
  id
  type
  scene
  position[x,y,z]
  orientation
  state
  ownership
  relationships
  provenance
  timestamps
```

**Gate:** fatos autoritativos não dependem de interpretação livre do LLM.

## Fase 7 — Spatial World Model / Spatial Compiler

**Objetivo:** transformar o mundo semântico em espaço jogável.

- X/Y/Z;
- regiões, salas, zonas e volumes;
- terreno;
- assentamentos;
- edifícios e interiores;
- portas, passagens e objetos;
- conectividade;
- elevação;
- distância e cobertura;
- colisão;
- LOS;
- iluminação;
- propagação de som;
- relações `inside`, `behind`, `above`, `adjacent`, `reachable`.

Materialização deve ser incremental: alta resolução perto da área jogável e representação mais abstrata para regiões ainda distantes.

**Gate:** o Fênix consegue transformar parte relevante do Campaign/World Model em espaço 3D semanticamente compreendido, não apenas visualmente gerado.

## Fase 8 — Perception & Knowledge Engine

**Objetivo:** separar World Truth de percepção, crença e conhecimento individual.

```text
visibleEntities
heardEntities
knownEntities
suspectedEntities
rememberedEntities
beliefs
```

**Gate:** o Mestre IA sabe o que pode revelar para cada jogador e NPC.

## Fase 9 — Temporal Memory: T

**Objetivo:** transformar snapshots em história persistente.

Registrar ações, mudanças, observadores e tempo de mundo/sessão.

```text
21:44 Player_B forced Door_17
21:44 Door_17 became BROKEN
21:44 Orc_03 heard impact
21:45 Orc_03 became ALERT
```

**Gate 4D temporal:** consultar onde algo está, onde estava, quando mudou e quem presenciou a mudança.

## Fase 10 — Causal Simulation

**Objetivo:** compreender ação → consequência → novo estado.

- grafo causal;
- consequências atrasadas;
- propagação de informação;
- eventos mundiais;
- evolução de conflitos mesmo fora da atenção dos jogadores;
- resolução determinística antes da interpretação narrativa.

**Gate:** o mundo consegue explicar por que seu estado atual existe.

## Fase 11 — NPC Cognition

**Objetivo:** NPCs com percepção, memória, objetivos, crenças e emoções persistentes.

```text
KNOWS
BELIEVES
FEELS
WANTS
SAYS
DOES
```

**Gate:** NPCs mantêm coerência social e psicológica entre sessões.

## Fase 12 — Narrative Intelligence

**Objetivo:** transformar estado e simulação em direção dramática.

- intenção narrativa;
- tema;
- ritmo;
- tensão;
- mistério;
- revelações;
- pistas;
- consequências;
- subtexto;
- escolha entre narrar, perguntar, agir, esperar ou permanecer em silêncio.

**Gate:** a IA dirige cenas sem confundir criatividade com alteração arbitrária de fatos.

## Fase 13 — Narrative Performance Engine

**Objetivo:** eliminar a sensação de texto de IA lido por TTS.

Coordenar:

- emoção;
- intensidade;
- ritmo;
- pausas;
- respiração;
- hesitação;
- sussurro;
- volume;
- identidade vocal;
- música;
- soundscape;
- iluminação;
- áudio espacial;
- silêncio dramático.

**Gate:** ambiente, sensação, estado emocional e intenção são transmitidos naturalmente sem exposição excessiva.

## Fase 14 — Autonomous GM / Director AI

**Objetivo:** observar continuamente e decidir quando e como intervir.

```text
Knowledge + Rules + World
          ↓
Perception + Time + Causality
          ↓
GM Director
 ├─ Rules
 ├─ Narration
 ├─ NPCs
 ├─ Encounters
 ├─ Music
 ├─ Soundscape
 ├─ Lighting
 └─ NO_ACTION
```

**Gate:** sessões longas permanecem coerentes com supervisão humana opcional.

## Fase 15 — Mestre IA 4D

**Objetivo:** integração plena da primeira visão espaço-temporal.

O Mestre deve compreender simultaneamente:

**regras + mundo + campanha + onde + quando + quem + percepção + conhecimento + emoção + causa + consequência + possibilidades futuras.**

As quatro fontes de verdade são obrigatórias:

1. Rules Truth;
2. World Truth;
3. Character Knowledge;
4. Temporal Truth.

**Gate:** improvisação e narração permanecem coerentes com todas as quatro fontes durante sessões prolongadas.

## Fase 16 — VR / Spatial RPG

**Objetivo:** colocar jogadores dentro do mesmo World Model.

- headset;
- cabeça e mãos;
- orientação corporal;
- interação espacial;
- áudio 3D;
- jogadores desktop e VR juntos;
- percepção baseada em ponto de vista;
- voz e gestos como sinais quando suportados.

VR adiciona sensores e interação. Não cria um segundo cérebro ou segundo mundo.

## Fase 17 — Mundo persistente multimodal

Horizonte:

- regiões que evoluem continuamente;
- NPCs autônomos;
- geração procedural semântica;
- múltiplos grupos quando desejado;
- desktop/mobile/VR/AR;
- memória de campanha de longo prazo;
- direção dramática adaptativa;
- expansão incremental de mundos importados ou criados.

---

# Fênix World Compiler

O termo **Fênix World Compiler** representa o conjunto de pipelines que convertem conhecimento em mundo jogável:

```text
Rules ───────→ Rule Compiler ──────┐
                                   │
World Sources → World Compiler ────┼→ Campaign Model
                                   │       ↓
Adventure ───→ Campaign Compiler ──┘   World Model
                                           ↓
                                    Spatial Compiler
                                           ↓
                                     3D/4D World
                                           ↓
                                      Simulation
                                           ↓
                                      Mestre IA 4D
```

Esse eixo é fundacional e prioritário.

---

# Métrica conceitual de maturidade

As porcentagens são marcos arquiteturais, não progresso de sprint:

| Marco | Maturidade conceitual |
|---|---:|
| VTT confiável | 30% |
| Knowledge + Rule/World/Campaign Compilers | 45% |
| World Authority + Spatial Model | 60% |
| Perception + Temporal Memory | 72% |
| Causality + NPC Cognition | 84% |
| Narrative Intelligence + Performance | 90% |
| Autonomous Mestre IA 4D | 96% |
| VR/multimodal, primeiro ciclo | 100% |

---

# Critério final

O Fênix deve ser capaz de:

> **compreender as regras escolhidas, compreender o material importado ou criado, convertê-lo em um mundo jogável, preservar proveniência, acompanhar esse mundo em X + Y + Z + T, resolver ações segundo as regras, improvisar dentro da coerência e dirigir/narrar uma experiência dramática natural.**

Essa é a base oficial para a evolução do **Mestre IA 4D**.
