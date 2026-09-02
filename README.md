> **⚠️ COPYRIGHT NOTICE — ALL RIGHTS RESERVED**
>
> Copyright (c) 2026 **Evandro Ricardo / Mestre Orc**  
> Este software e todo o seu código-fonte são propriedade exclusiva do autor.  
> **É proibida** a cópia, modificação, distribuição, engenharia reversa ou qualquer uso sem autorização prévia e por escrito do proprietário.  
> Veja [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE).

---

# Mestre Orc / Fênix VTT

Versão base atual: `0.1.0-alpha.24`  
Stack principal: Node.js 20–24, Next.js 15, React 19, WebGL/3D, PostgreSQL, WebSocket e Shared Core de IA. O Foundry VTT 13 permanece como adapter de primeira classe enquanto o Fênix evolui como VTT standalone.

## Missão

O Fênix não pretende ser apenas um VTT que possui um chatbot ou um gerador de narração. A visão de longo prazo é construir um **motor de RPG persistente no qual um Mestre IA compreende o mundo, acompanha sua evolução e dirige a experiência narrativa**.

O destino arquitetural é o **Mestre IA 4D**: um Mestre com consciência operacional do espaço e do tempo do jogo, apoiado por percepção, memória, causalidade, emoção e direção dramática.

> **No Fênix, 4D significa explicitamente X + Y + Z + T: três dimensões espaciais mais a dimensão temporal.**
>
> Não significa consciência humana nem uma hipótese física de quarta dimensão espacial. Significa que o sistema deve conhecer onde as entidades estão, quando os estados mudaram, quem percebeu os acontecimentos e quais causas produziram as consequências atuais.

O roadmap completo dessa evolução está em [`ROADMAP.md`](ROADMAP.md).

## A visão 4D

Um VTT convencional conhece principalmente o estado presente. O Fênix deverá conhecer também a trajetória desse estado.

```text
FÊNIX WORLD MODEL

Space
  X + Y + Z

Time
  T

Context
  State
  Perception
  Knowledge
  Memory
  Emotion
  Causality
```

Exemplo de fatos que o motor deverá ser capaz de produzir sem depender de invenção do LLM:

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

A função da IA é **interpretar e dirigir a experiência a partir desses fatos**, e não inventar arbitrariamente a geometria ou o estado do mundo.

## Princípio fundamental: realidade ≠ percepção ≠ conhecimento

O Fênix deverá distinguir três camadas:

1. **Realidade do mundo:** o que realmente existe e acontece.
2. **Percepção:** o que determinado personagem consegue ver, ouvir ou detectar naquele momento.
3. **Conhecimento:** o que esse personagem sabe ou acredita com base em experiências anteriores.

Assim, o Mestre IA poderá saber que existe uma criatura no teto e simultaneamente saber que nenhum personagem a percebeu. A criatura existe no World Model, mas não pode ser revelada pela narração até que uma percepção, ação ou consequência justifique isso.

## A quarta dimensão: memória temporal

O tempo não será apenas um relógio visual. Ele deverá fazer parte do estado do universo.

```text
21:43 Player_A approached Door_17
21:43 Player_A attempted lockpick
21:43 lockpick FAILED
21:44 Player_B forced Door_17
21:44 Door_17 became BROKEN
21:44 Orc_03 heard impact
21:45 Orc_03 became ALERT
```

Isso permite que o Mestre compreenda não apenas que `Door_17` está quebrada, mas **quando foi quebrada, quem provocou a mudança, quem percebeu o evento e quais consequências surgiram depois**.

Uma sala poderá carregar vestígios de eventos anteriores. Um NPC poderá lembrar de uma ameaça. Guardas poderão procurar aventureiros porque receberam um alerta causado minutos antes. O presente passa a ser consequência de uma linha temporal persistente.

## Causalidade

A evolução posterior adicionará um grafo causal ao World Model:

```text
Door_17 broken
  caused_by: Player_B forced door
  consequence: Orc_03 alerted
  secondary: Orc_03 warned guards
  current_effect: guards searching dungeon
```

O objetivo é permitir que o Mestre IA compreenda **por que** o mundo chegou ao estado atual, e não apenas qual é esse estado.

## Narração natural é requisito central

A visão 4D não termina em geometria. Um mundo tecnicamente perfeito ainda falha como RPG se a narração parecer texto de IA lido por um TTS.

O Fênix deverá evoluir para um **Narrative Performance Engine** que coordene:

- contexto sensorial do ambiente;
- tensão, mistério e perigo percebido;
- estado físico e emocional dos personagens;
- conhecimento e segredos individuais;
- ritmo dramático;
- intenção narrativa;
- emoção e subtexto;
- pausas, respiração e hesitação;
- velocidade e intensidade da fala;
- sussurro e volume;
- silêncio dramático;
- identidade vocal persistente por NPC;
- música, soundscape e áudio espacial;
- iluminação e efeitos ambientais.

A saída de narração poderá carregar uma partitura de interpretação:

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

O objetivo não é fazer a IA falar continuamente. Um Mestre competente também sabe observar e permanecer em silêncio. O Director AI deverá poder escolher `NO_ACTION` quando som, iluminação, atuação dos NPCs ou simplesmente o silêncio forem narrativamente superiores a outra fala.

## Estado emocional e subtexto dos NPCs

NPCs futuros não deverão ser representados apenas por rótulos como `angry` ou `afraid`. O estado poderá ser multidimensional:

```text
fear:       0.62
anger:      0.81
confidence: 0.34
grief:      0.18
suspicion:  0.73
```

A cognição deverá separar:

```text
KNOWS
FEELS
WANTS
SAYS
DOES
```

Isso permitirá mentira, hesitação, medo oculto, falsa confiança, memória social e subtexto sem exigir que o narrador explique explicitamente cada emoção.

## Arquitetura-alvo

```text
                         FÊNIX WORLD
                              │
                       World Authority
                              │
               ┌──────────────┴──────────────┐
               │                             │
        Spatial World Model             Rules Engine
          X + Y + Z                          │
               │                         Simulation
        Perception Engine                    │
               └──────────────┬──────────────┘
                              │
                         Event Stream
                              │
                     Temporal Memory (T)
                              │
                         Causal Graph
                              │
                    NPC Cognition / Emotion
                              │
                         GM Director AI
                ┌─────────────┼─────────────┐
                │             │             │
           Narration        NPC AI       World Direction
                │             │             │
        Performance/TTS    Animation    Music/FX/Lighting
                └─────────────┼─────────────┘
                              │
                          FÊNIX WORLD
                              │
                   Desktop / Mobile / VR / AR
```

## VR e realidade espacial

VR é uma evolução planejada, mas **não deve ser o cérebro do sistema**. Primeiro o Fênix precisa compreender o mundo. Depois VR passa a ser outra interface para observar e manipular esse mesmo World Model.

O objetivo futuro é permitir sessões híbridas nas quais jogadores desktop e VR compartilhem o mesmo universo. Headset, posição da cabeça, orientação, mãos, voz e eventualmente gestos poderão alimentar o Perception Engine sem criar uma arquitetura paralela.

## Estado atual

A fundação existente inclui:

- Shared Core VTT-agnóstico para contexto, intenção, regras, relacionamentos, narração e áudio;
- Fênix VTT standalone com Next.js 15 + React 19;
- renderer desacoplado por `MapRendererPort`;
- battlemap, pan/zoom e calibração persistente de grid;
- Walls + Doors Authoring persistente;
- portas `open`, `closed` e `locked`;
- Fog of War + Token Line of Sight por personagem;
- memória persistente de áreas exploradas;
- autenticação, campanhas, memberships e convites;
- controle de personagem derivado da membership no servidor;
- `CampaignRuntimeRegistry` isolado por campanha;
- PostgreSQL opcional e coordenação distribuída;
- runtime leases com fencing token;
- `LISTEN/NOTIFY` para invalidação entre Engines;
- owner-aware HTTP/WebSocket routing;
- HMAC interno entre Engines;
- `DistributedCommandLedger` para idempotência;
- observabilidade e readiness;
- `ROOM_ENTERED` e ações integradas ao Shared Core;
- recuperação de sessão sem repetir aberturas.

## Próximas fundações técnicas

Antes do Mestre IA 4D, o VTT precisa consolidar:

- manipulação e qualidade do streaming 3D;
- colisão autoritativa de tokens;
- iluminação dinâmica, elevação e som espacial;
- Durable Realtime Outbox + garantias de entrega;
- World Authority;
- Spatial World Model;
- Perception & Knowledge Engine;
- Temporal Memory;
- Causal Simulation;
- NPC Cognition;
- Narrative Performance Engine;
- Autonomous GM / Director AI;
- VR e interfaces espaciais.

A ordem e os gates estão documentados em [`ROADMAP.md`](ROADMAP.md).

## Execução local

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run dev
```

Fênix VTT standalone:

```powershell
npm run dev:vtt
```

Desenvolvimento pode usar persistência JSON:

```env
FENIX_PERSISTENCE_DRIVER=json
FENIX_STATE_FILE=./data/fenix-state.json
```

Para infraestrutura distribuída, configure PostgreSQL e as variáveis de runtime descritas em `.env.example`, além de `GROQ_API_KEY`, `GROQ_MODEL`, CORS e autenticação.

## Mapas, visão e autoridade atual

O Scene Manager mantém battlemap, dimensões, grid calibrado, paredes e Fog como estado persistente. Paredes e portas fechadas/trancadas bloqueiam visão; portas abertas liberam line-of-sight. O contrato geométrico permanece em `packages/scene-geometry` e o contrato de visão em `packages/scene-vision`.

A exploração não é declarada pelo browser. Depois de um `TOKEN_MOVE` autorizado, o Engine calcula as células visíveis usando posição, grid e paredes. Alterações de grid, paredes, portas e Fog são GM-only no servidor.

Documentação relacionada:

- [`docs/FENIX_WALLS_DOORS.md`](docs/FENIX_WALLS_DOORS.md)
- [`docs/FENIX_FOG_LOS.md`](docs/FENIX_FOG_LOS.md)
- [`docs/FENIX_AUTH_PERSISTENCE.md`](docs/FENIX_AUTH_PERSISTENCE.md)

## Limites atuais importantes

### Entrega durável de eventos realtime

A execução de comandos já é deduplicada entre réplicas, mas o broadcast realtime ainda pode ser perdido se o owner cair após confirmar uma mutação e antes da entrega aos peers. A evolução planejada é **Durable Realtime Outbox + Event Delivery Guarantees**.

### Colisão, iluminação e espacialidade

Fog e LOS já usam geometria autoritativa. Ainda é necessário consolidar colisão física, iluminação dinâmica, elevação, propagação de som e relações espaciais necessárias ao futuro World Model 4D.

## Módulo Foundry

Copie `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A lógica alpha.24 preserva correlação por número da sala, Journal relacionado e read-aloud seguro. O Foundry permanece adapter de primeira classe, mas a inteligência de mundo de longo prazo pertence ao Shared Core/Fênix World Model.

## Comandos principais

```text
npm run dev
npm run dev:vtt
npm run build:vtt
npm test
npm run test:auth-integration
npm run test:realtime-integration
npm run test:postgres-integration
npm run test:coordination-integration
npm run test:routing-integration
npm run test:idempotency-integration
npm run migrate:postgres
npm run validate
npm run check
```

## Segurança

O Fênix mantém autorização no servidor, autenticação com cookies HttpOnly, validação de origem e payload WebSocket, isolamento por membership, HMAC entre Engines, fencing de runtime, idempotência distribuída e separação entre autenticação de usuário e confiança interna de infraestrutura.

Nenhum componente de IA deverá poder contornar permissões, revelar estado oculto ou substituir regras determinísticas do World Model.

## Critério de sucesso da visão Fênix

A pergunta final não é apenas:

> "A IA consegue escrever uma boa descrição?"

É:

> **"O Fênix consegue dirigir uma experiência dramática contínua usando espaço, tempo, percepção, memória, causalidade, emoção, voz, silêncio e ambiente sem quebrar a coerência do mundo?"**

Quando essa resposta for consistentemente positiva, o Fênix terá deixado de ser apenas um VTT com IA para se tornar um **motor de RPG espaço-temporal dirigido por um Mestre IA 4D**.
