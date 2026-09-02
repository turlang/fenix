# Fênix VTT — Roadmap Estratégico

> Este roadmap descreve a evolução do Fênix de VTT com IA para um **mundo de RPG persistente compreendido e dirigido por um Mestre IA espaço-temporal**.

## Visão de longo prazo

O objetivo do Fênix não é apenas adicionar IA a um VTT. O objetivo é construir um motor de RPG no qual o Mestre IA possua um modelo autoritativo do mundo, compreenda espaço, tempo, percepção, memória, causalidade e estado emocional, e use essas informações para dirigir uma experiência narrativa natural.

### A intenção das 4 dimensões

No Fênix, **4D significa 3 dimensões espaciais + tempo**:

- **X**: posição horizontal;
- **Y**: profundidade/plano;
- **Z**: elevação/altura;
- **T**: evolução temporal do mundo.

Não se trata de afirmar consciência humana ou uma quarta dimensão física exótica. Trata-se de criar **consciência operacional espaço-temporal**: o Mestre IA deve saber o que existe, onde existe, quando mudou, quem percebeu a mudança e quais eventos causaram o estado atual.

A representação-alvo é:

```text
WORLD STATE
  ├─ Space: X + Y + Z
  ├─ Time: T
  ├─ State
  ├─ Perception
  ├─ Knowledge
  ├─ Memory
  ├─ Emotion
  └─ Causality
```

Exemplo:

```text
23:47:14
Player_A moved 1.4m north.
Player_A cannot see Orc_07.
Orc_07 cannot see Player_A.
Orc_07 heard Player_A.
Orc_07 suspicion = 0.42.
Player_B is looking toward the ceiling.
Player_B perception check = SUCCESS.
```

A IA não deve inventar esses fatos. O Fênix deve calculá-los e entregá-los ao Mestre IA como verdade do mundo.

---

## Princípios arquiteturais

1. **O World Model é a fonte da verdade.** A IA interpreta fatos, mas não substitui geometria, regras, permissões ou estado autoritativo.
2. **Percepção não é realidade.** Cada personagem conhece apenas aquilo que conseguiu perceber ou aprender.
3. **O mundo possui memória.** Uma sala pode carregar consequências de acontecimentos anteriores.
4. **Causalidade é persistente.** O sistema deve conseguir relacionar estado atual a eventos que o produziram.
5. **Narrativa é performance.** Texto, voz, silêncio, ritmo, ambiente, música, iluminação e atuação formam uma única experiência.
6. **VR é uma interface, não o cérebro.** O mesmo World Model deve servir desktop, navegador, streaming, mobile, VR e futuramente AR.
7. **IA não deve responder o tempo todo.** Um Mestre competente também observa, espera e usa silêncio, ambiente e consequências sem narração verbal.

---

# Fases evolutivas

## Fase 0 — Fundação VTT confiável

**Objetivo:** estabilizar o produto atual antes de ampliar a autonomia da IA.

- mesa, cenas, tokens e personagens;
- grid e calibração em tempo real;
- paredes e portas com authoring preciso;
- Fog of War e LOS;
- permissões GM/Player;
- multiplayer e runtime distribuído;
- persistência e recuperação;
- streaming 3D com qualidade e manipulação adequada;
- colisão de tokens;
- iluminação dinâmica;
- eventos realtime duráveis.

**Gate:** estado do VTT confiável o suficiente para se tornar fonte de verdade para a IA.

## Fase 1 — World Authority

**Objetivo:** consolidar um estado central autoritativo.

Cada entidade relevante deve possuir identidade, posição, estado e relações explícitas.

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
  timestamps
```

**Gate:** nenhuma decisão espacial importante depende de interpretação livre do LLM.

## Fase 2 — Spatial World Model

**Objetivo:** fazer o Fênix compreender semanticamente o espaço 3D.

- X/Y/Z autoritativos;
- salas, zonas e volumes;
- elevação;
- distância;
- cobertura;
- portas e passagens;
- conectividade espacial;
- colisão;
- linha de visão;
- propagação básica de som;
- iluminação e escuridão;
- relações como `inside`, `behind`, `above`, `adjacent`, `reachable`.

**Gate:** o sistema consegue responder deterministicamente onde cada entidade está e quais relações espaciais existem.

## Fase 3 — Perception & Knowledge Engine

**Objetivo:** separar realidade, percepção e conhecimento.

Para cada ator:

```text
visibleEntities
heardEntities
knownEntities
suspectedEntities
rememberedEntities
```

Considerar:

- orientação/campo de visão;
- iluminação;
- obstáculos;
- distância;
- audição;
- furtividade;
- percepção passiva/ativa;
- condições especiais;
- conhecimento previamente adquirido.

**Gate:** o Mestre IA sabe claramente o que pode e o que não pode revelar para cada jogador.

## Fase 4 — Temporal Memory: a quarta dimensão

**Objetivo:** transformar o mundo de um snapshot em uma história contínua.

O Fênix deve registrar eventos relevantes com tempo do mundo e tempo de sessão.

```text
21:43 Player_A approached Door_17
21:43 Player_A attempted lockpick
21:43 lockpick FAILED
21:44 Player_B forced Door_17
21:44 Door_17 became BROKEN
21:44 Orc_03 heard impact
21:45 Orc_03 became ALERT
```

O estado presente passa a ser interpretável a partir de sua trajetória temporal.

**Gate 4D:** o Mestre IA consegue consultar **onde algo está agora, onde estava, quando mudou e quais personagens presenciaram a mudança**.

## Fase 5 — Causal Simulation

**Objetivo:** registrar ação → consequência → novo estado.

```text
Door_17 broken
  caused_by: Player_B forced door
  consequence: Orc_03 alerted
  secondary: Orc_03 warned guards
  current_effect: guards searching dungeon
```

- grafo causal;
- consequências atrasadas;
- efeitos locais e globais;
- propagação de informação entre NPCs;
- resolução determinística de regras antes da interpretação narrativa.

**Gate:** o mundo consegue explicar por que seu estado atual existe.

## Fase 6 — NPC Cognition

**Objetivo:** NPCs com percepção, memória, objetivos e estado emocional persistente.

Modelo emocional multidimensional, por exemplo:

```text
fear:       0.62
anger:      0.81
confidence: 0.34
grief:      0.18
suspicion:  0.73
```

Cada NPC deve separar:

```text
KNOWS
FEELS
WANTS
SAYS
DOES
```

Isso permite mentira, hesitação, subtexto, medo oculto, confiança falsa e mudanças de comportamento coerentes.

**Gate:** NPCs mantêm coerência entre sessões sem depender apenas do histórico textual enviado ao modelo.

## Fase 7 — Narrative Performance Engine

**Objetivo:** eliminar a sensação de "texto de IA lido por TTS".

A geração deve receber contexto sensorial e dramático estruturado:

- temperatura;
- iluminação;
- umidade;
- cheiro;
- sons;
- visibilidade;
- estado físico dos personagens;
- tensão;
- mistério;
- perigo percebido;
- perigo real;
- conhecimento e segredos;
- estado emocional;
- ritmo da cena.

A saída deve incluir uma partitura de performance:

```text
emotion: apprehension
intensity: 0.38
pace: slow
volume: low
breathiness: 0.22

"O frio muda primeiro."
PAUSE 900ms

"Não é apenas a umidade da cripta."
PAUSE 500ms

intensity: 0.52
"Há alguma coisa diferente no ar."
PAUSE 1300ms
```

Recursos-alvo:

- emoção variável dentro da mesma fala;
- pausas intencionais;
- respiração;
- hesitação;
- sussurro;
- aceleração/desaceleração;
- volume;
- subtexto;
- silêncio dramático;
- interrupção contextual;
- pronúncia e identidade vocal persistente por NPC;
- áudio espacial.

**Gate:** a narração transmite ambiente, sensação, estado emocional e intenção sem depender de exposição excessiva.

## Fase 8 — Autonomous GM / Director AI

**Objetivo:** o Mestre IA observa o mundo continuamente e decide quando agir.

```text
World Model
   ↓
Perception
   ↓
Temporal Memory
   ↓
Causal Graph
   ↓
GM Director
   ├─ Narration
   ├─ NPC AI
   ├─ Rules
   ├─ Music
   ├─ Soundscape
   ├─ Lighting
   ├─ Effects
   └─ Encounter pacing
```

O Mestre deve poder decidir por `NO_ACTION` quando a melhor direção dramática for não interromper os jogadores.

**Gate:** uma sessão pode permanecer coerente por longos períodos com supervisão humana opcional, sem o Mestre IA perder estado, revelar informação indevida ou responder mecanicamente a cada evento.

## Fase 9 — 4D AI GM

**Objetivo:** integrar espaço, tempo, percepção, memória, causalidade, emoção e direção narrativa.

O Mestre IA deve compreender simultaneamente:

**onde + quando + quem + o quê + quem percebeu + o que sabe + como se sente + por que aconteceu + o que pode acontecer depois.**

Este é o estágio denominado no projeto como **Mestre IA 4D**.

> "4D" no Fênix é uma intenção arquitetural explícita: **X + Y + Z + T**, complementada por percepção, conhecimento, memória e causalidade.

## Fase 10 — VR / Spatial RPG

**Objetivo:** colocar jogadores dentro do mesmo World Model.

- headset VR;
- tracking de cabeça e mãos;
- orientação corporal;
- interação física com objetos;
- áudio espacial;
- presença de jogadores desktop e VR na mesma sessão;
- percepção individual baseada no ponto de vista real;
- NPCs reagindo a voz, posição, distância e gestos quando suportado.

VR não cria a inteligência espacial. VR apenas adiciona novos sensores e formas de interação ao World Model já existente.

## Fase 11 — Mundo persistente multimodal

Horizonte de longo prazo:

- campanhas persistentes;
- regiões que continuam evoluindo;
- agentes NPC autônomos;
- geração procedural controlada por regras e lore;
- desktop + mobile + VR + AR;
- Mestre IA multimodal;
- memória de campanha de longo prazo;
- direção dramática adaptativa;
- múltiplos grupos compartilhando, quando desejado, o mesmo universo persistente.

---

# Métrica de maturidade rumo ao Mestre IA 4D

As porcentagens abaixo são metas conceituais, não progresso de sprint:

| Marco arquitetural | Maturidade conceitual |
|---|---:|
| VTT confiável | 40% |
| World Authority + Spatial Model | 55% |
| Perception + Temporal Memory | 70% |
| Causal Simulation + NPC Cognition | 85% |
| Autonomous GM | 95% |
| Integração VR/multimodal | 100% do primeiro ciclo da visão 4D |

---

# Critério final de qualidade

O objetivo não é apenas responder à pergunta:

> "A IA consegue escrever boas descrições?"

O objetivo é responder positivamente a uma pergunta mais difícil:

> **"O Fênix consegue dirigir uma experiência dramática contínua usando espaço, tempo, percepção, memória, causalidade, voz, silêncio, ambiente e emoção sem quebrar a coerência do mundo?"**

Quando isso for verdade, o Fênix terá deixado de ser apenas um VTT com IA e terá se tornado um **motor de RPG espaço-temporal dirigido por IA**.
