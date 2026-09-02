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

O Fênix não pretende ser apenas um VTT com chatbot, gerador de texto ou automação de regras. A visão é construir um **motor de RPG persistente no qual um Mestre IA compreende regras, mundo, campanha, espaço, tempo, percepção, memória e causalidade, e usa esse conhecimento para mestrar e narrar com criatividade controlada pela coerência**.

O destino arquitetural é o **Mestre IA 4D**.

> **No Fênix, 4D significa explicitamente X + Y + Z + T: três dimensões espaciais mais a dimensão temporal.**
>
> Não significa consciência humana nem uma hipótese física de quarta dimensão espacial. Significa consciência operacional espaço-temporal do estado do jogo: onde as entidades estão, quando os estados mudaram, quem percebeu os acontecimentos, quais regras se aplicam e quais causas produziram as consequências atuais.

O roadmap completo está em [`ROADMAP.md`](ROADMAP.md).

## Diretriz prioritária: conhecimento antes de autonomia

O Mestre IA não deve depender da memória pré-treinada de um LLM para decidir regras, lore ou fatos da campanha. Antes de ampliar sua autonomia, o Fênix deve construir uma **Knowledge Foundation** confiável.

```text
                    FÊNIX KNOWLEDGE FOUNDATION

       RULE MATERIAL                         WORLD MATERIAL
             │                                     │
       Rule Compiler                         World Compiler
             │                                     │
       Rules Knowledge                      World Knowledge
             │                                     │
             └──────────────┬──────────────────────┘
                            │
                     Campaign Compiler
                            │
                     Campaign Model
                            │
                      World Authority
                            │
                   Mestre IA 4D / Director
```

Essa fundação é prioridade arquitetural do projeto.

## Sistemas de RPG e material do Mestre

O Fênix poderá distribuir nativamente apenas regras e conteúdos cuja licença permita esse uso, incluindo sistemas abertos e materiais compatíveis com licenças como OGL, ORC, Creative Commons ou outras permissões aplicáveis.

O Mestre poderá fornecer seus próprios materiais para uso privado na campanha, inclusive livros de regras, aventuras, cenários e outros documentos aos quais tenha acesso legítimo. O Fênix deve tratar conteúdo importado como privado, manter proveniência e respeitar direitos, licenças e restrições aplicáveis. A posse de uma cópia não é tratada pelo sistema como autorização automática para redistribuição.

Conteúdo privado importado não deve ser incorporado ao produto, publicado para terceiros ou usado como conteúdo nativo distribuído pelo Fênix sem autorização apropriada.

## Rule Compiler

Importar um livro de regras não deve significar apenas indexar PDF para busca semântica. O objetivo é **compreender e estruturar as regras**.

O Rule Compiler deverá produzir simultaneamente:

- referência ao texto-fonte;
- conceitos e entidades mecânicas;
- condições e gatilhos;
- cálculos;
- exceções;
- relações entre regras;
- requisitos;
- efeitos;
- fonte e proveniência;
- confiança da interpretação.

Exemplo conceitual:

```text
RULE
id: falling_damage
system: SYSTEM_A
trigger: actor_falls
conditions: distance > threshold
calculation: ...
exceptions: ...
source: book / section / page
confidence: 0.99
```

A IA interpreta a intenção do jogador. O Rules Engine determina a resolução mecânica sempre que a regra puder ser formalizada. O Mestre IA transforma o resultado em consequência e narração.

```text
Player Action
     ↓
Intent Recognition
     ↓
Rules Retrieval
     ↓
Rules Engine
     ↓
World State Mutation
     ↓
Narrative Director
```

## World Compiler

O World Compiler deverá compreender material de cenário, aventuras, campanhas e, quando legalmente utilizável, obras narrativas fornecidas pelo Mestre, convertendo texto em uma representação semântica jogável.

O objetivo não é resumir documentos. É extrair o **DNA do mundo**:

- geografia;
- locais;
- personagens;
- povos e culturas;
- facções;
- história;
- política;
- cosmologia e mitologia;
- criaturas;
- objetos e artefatos;
- relações;
- segredos;
- cronologia;
- arquitetura;
- tecnologia;
- economia;
- estética;
- atmosfera;
- temas;
- regras implícitas do universo.

Toda informação deve preservar sua origem:

```text
CANON       explicitamente estabelecido pela fonte
DERIVED     inferido a partir das fontes
GENERATED   criado para completar o mundo jogável
IMPROVISED  criado durante a sessão
PLAYER_CAUSED mudança provocada pelas ações dos jogadores
```

Fatos também poderão ser `immutable`, `mutable`, `hidden`, `uncertain`, `rumor` ou `false_information`.

## Campaign Compiler

O Campaign Compiler une:

```text
SYSTEM
  +
WORLD
  +
CAMPAIGN / ADVENTURE
  =
PLAYABLE CAMPAIGN MODEL
```

Ele deverá funcionar tanto para campanhas e one-shots criados do zero quanto para material importado.

A criação não deve produzir uma história rígida. O Fênix deve gerar **situações, conflitos, personagens, objetivos, segredos, lugares, ameaças e possibilidades**, deixando que a história resulte das ações dos jogadores.

## Importação de mundos literários

Uma meta estratégica é permitir que material narrativo autorizado ou legitimamente fornecido pelo Mestre seja interpretado como um mundo potencialmente jogável.

```text
Book / Source Material
        ↓
Literary Analyzer
        ↓
Entities + Geography + Timeline + Relationships
        ↓
Knowledge Graph
        ↓
World DNA
        ↓
RPG Adaptation
        ↓
World Model
        ↓
Spatial Compiler
        ↓
3D / 4D Playable World
```

Um romance não é uma aventura pronta. O sistema precisa converter narrativa linear em um **espaço de possibilidades** sem confundir fatos da obra com conteúdo inventado para preencher lacunas.

A materialização espacial deve ser incremental. O Fênix pode compreender uma região semanticamente sem gerar todo o seu espaço 3D imediatamente. Áreas próximas aos jogadores ganham maior resolução conforme se tornam relevantes.

## Quatro fontes de verdade do Mestre IA

Toda decisão do Mestre IA deverá considerar, quando aplicável:

1. **Rules Truth:** quais regras se aplicam e como a ação é resolvida.
2. **World Truth:** o que realmente existe e qual é seu estado.
3. **Character Knowledge:** o que cada personagem sabe, acredita, percebe ou desconhece.
4. **Temporal Truth:** o que aconteceu, quando aconteceu e quais consequências permanecem ativas.

O Mestre IA também deverá consultar a proveniência para saber **o que pode inventar sem contradizer o material**.

## Creative Boundary Engine

Improvisação é requisito central, mas não pode destruir a coerência.

O Fênix deverá permitir criatividade crescente conforme diminui a quantidade de fatos definidos pela fonte. Próximo a fatos canônicos ou regras explícitas, a liberdade é menor. Em lacunas não definidas, o Mestre IA pode criar novos NPCs, locais, conflitos, rumores, interiores e acontecimentos, registrando essas criações como `GENERATED` ou `IMPROVISED`.

A meta é:

> **criatividade limitada pela coerência, não por scripts.**

Se jogadores abandonarem completamente o caminho previsto, o sistema deve conseguir expandir o mundo mantendo cultura, geografia, economia, história, regras e estado atual.

## A visão 4D

O World Model combina espaço e tempo:

```text
FÊNIX WORLD MODEL

Space: X + Y + Z
Time: T
State
Perception
Knowledge
Memory
Emotion
Causality
Provenance
```

A IA não deve inventar fatos espaciais autoritativos. Geometria, posição, visibilidade, alcance e demais fatos determinísticos devem ser calculados pelo sistema.

## Realidade, percepção e conhecimento

O Fênix distingue:

1. realidade do mundo;
2. percepção individual;
3. conhecimento e crença individual.

Assim, uma criatura pode existir no World Model sem poder ser revelada ao personagem que ainda não a percebeu.

Informação falsa também pode existir corretamente:

```text
WORLD TRUTH: King is dead
NPC BELIEF: King escaped
PLAYER KNOWLEDGE: unknown
PUBLIC RUMOR: King was kidnapped
```

## A quarta dimensão: memória temporal e causalidade

O tempo faz parte do universo:

```text
21:43 Player_A attempted lockpick
21:43 lockpick FAILED
21:44 Player_B forced Door_17
21:44 Door_17 became BROKEN
21:44 Orc_03 heard impact
21:45 Orc_03 became ALERT
```

O sistema deve preservar não apenas o estado atual, mas quando ele mudou, quem provocou a mudança, quem percebeu e quais consequências surgiram.

Eventos podem formar um grafo causal, permitindo que o mundo continue evoluindo mesmo fora da atenção imediata dos jogadores.

## Mundo virtual construído a partir do conhecimento

Regras, cenário e campanha não ficam isolados em documentos. Eles alimentam o mesmo World Model que sustenta o espaço virtual.

```text
Knowledge Foundation
       ↓
Campaign Model
       ↓
World Model
       ↓
Spatial World Model
       ↓
Terrain / Regions / Settlements
       ↓
Buildings / Interiors / Objects
       ↓
NPC Population
       ↓
Lighting / Weather / Soundscape
       ↓
Simulation
       ↓
Mestre IA 4D
```

O objetivo não é gerar uma imagem bonita de uma cidade. É criar uma cidade **jogável e semanticamente compreendida**: portas são portas, pontes conectam regiões, NPCs possuem relações e conhecimento, objetos possuem função e o tempo altera o estado do lugar.

## Narração natural é requisito central

O Fênix deverá possuir um **Narrative Performance Engine** capaz de coordenar contexto sensorial, emoção, subtexto, ritmo, pausas, respiração, hesitação, volume, silêncio dramático, identidade vocal, música, soundscape, iluminação e áudio espacial.

O Mestre não deve falar continuamente. O Director AI deve poder escolher `NO_ACTION` quando silêncio, ambiente ou atuação dos NPCs forem narrativamente superiores.

## Estado emocional e NPCs

NPCs deverão separar:

```text
KNOWS
FEELS
WANTS
SAYS
DOES
```

Estados emocionais serão multidimensionais e persistentes, permitindo mentira, medo oculto, hesitação, confiança falsa, memória social e subtexto.

## Arquitetura-alvo

```text
                    SOURCES
          Rules / World / Adventure
                      │
              Knowledge Foundation
          ┌───────────┼───────────┐
          │           │           │
     Rule Compiler World Compiler Campaign Compiler
          └───────────┼───────────┘
                      │
               Knowledge Graph
                      │
               World Authority
                      │
              Spatial Model XYZ
                      │
             Perception / Knowledge
                      │
               Event Stream
                      │
             Temporal Memory T
                      │
                Causal Graph
                      │
              NPC Cognition
                      │
              GM Director AI
          ┌───────────┼───────────┐
       Rules      Narration     World Direction
          │           │           │
     Simulation  Performance  Music/FX/Lighting
          └───────────┼───────────┘
                      │
                 FÊNIX WORLD
                      │
          Desktop / Mobile / VR / AR
```

## VR e realidade espacial

VR é uma evolução planejada, não o cérebro do sistema. Desktop, navegador, streaming, mobile e VR deverão compartilhar o mesmo World Model. Tracking de cabeça, mãos, voz e gestos futuramente alimentarão percepção e interação sem criar um segundo universo de jogo.

## Estado atual

A fundação existente inclui Shared Core VTT-agnóstico, Fênix standalone, renderer desacoplado, battlemap, grid, Walls + Doors, Fog/LOS, memória de exploração, autenticação, campanhas, memberships, multiplayer, runtime distribuído, PostgreSQL opcional, leases/fencing, routing HTTP/WebSocket, idempotência e observabilidade.

Esses recursos são fundação existente. **Knowledge Foundation, Rule Compiler, World Compiler, Campaign Compiler, Creative Boundary Engine e o World Model 4D completo são objetivos arquiteturais, não funcionalidades declaradas como concluídas.**

## Prioridade técnica

A ordem estratégica passa a ser:

```text
VTT Reliability
      ↓
Knowledge Foundation
      ↓
Rule Compiler + World Compiler
      ↓
Campaign Compiler + Provenance
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
```

Essa ordem é deliberada: **não construir o cérebro antes de definir de onde ele obtém conhecimento confiável**.

## Modelo de negócio e operação

A direção comercial planejada para o Fênix é um modelo **híbrido inspirado na simplicidade operacional do self-hosting**, preservando a independência tecnológica e comercial do projeto.

### Licença principal

- o Mestre adquire uma licença do Fênix VTT;
- jogadores podem participar da mesa sem adquirir uma licença individual;
- o Mestre pode executar a sessão em sua própria máquina;
- renderização 2D/3D deve ocorrer localmente sempre que possível;
- campanhas e assets podem permanecer locais quando o Mestre escolher o modo self-hosted;
- a licença principal não deve depender de uma assinatura obrigatória para manter o VTT básico utilizável.

Os valores comerciais definitivos serão definidos apenas antes do lançamento. Como referência de planejamento, a estratégia considera uma licença perpétua na faixa de **R$ 249 a R$ 399**, sujeita a validação de mercado, custos, impostos e escopo final.

### Serviços opcionais

O modelo comercial poderá ser complementado por serviços que não sejam necessários para o funcionamento básico da licença local:

- **Fênix Cloud:** hospedagem 24/7, backups, armazenamento e conexão simplificada;
- **BYOK (Bring Your Own Key):** o Mestre conecta sua própria chave de um provedor de IA compatível e assume diretamente o consumo daquele provedor;
- **Fênix AI:** IA gerenciada pelo Fênix com franquia, créditos ou cobrança por consumo;
- **World Compiler / Campaign Compiler:** processamento pesado cobrado por créditos ou incluído em planos específicos;
- **voz e mídia premium:** TTS, geração de áudio, vídeo, modelos e outros recursos de alto custo sob demanda;
- **Marketplace:** conteúdo de criadores e parceiros, com participação do Fênix nas transações;
- **conteúdo oficial/licenciado:** packs de sistemas, mundos e campanhas quando houver autorização apropriada.

A diretriz econômica é simples: **o custo variável pesado não deve ficar escondido dentro de uma licença ilimitada**.

```text
FÊNIX LOCAL
VTT + servidor da mesa + renderização → máquina do Mestre

FÊNIX BYOK
VTT local → máquina do Mestre
IA → conta/chave do Mestre

FÊNIX CLOUD
VTT/mesa → local ou cloud
IA/compiladores/voz/storage → serviços Fênix sob demanda
```

Essa arquitetura reduz o custo fixo central do projeto, permite operação comercial gradual e evita que cada mesa ativa exija permanentemente uma instância ou GPU mantida pelo Fênix.

## Requisitos de sistema planejados

Os requisitos abaixo são **alvos de produto**, não requisitos finais certificados da versão `0.1.0-alpha.24`. Eles deverão ser revisados por benchmarks antes de cada release estável. O consumo real varia conforme tamanho do mapa, quantidade de tokens, iluminação, modelos 3D, resolução, efeitos e uso de IA local.

### Mestre / Host: mínimo planejado

| Componente | Requisito mínimo alvo |
| --- | --- |
| Sistema operacional | Windows 10/11 64-bit, Linux 64-bit ou macOS compatível |
| CPU | 4 núcleos / 8 threads, classe Intel Core i5 ou AMD Ryzen 5 |
| RAM | 8 GB |
| GPU | GPU compatível com WebGL 2; 4 GB de VRAM recomendados para cenas 3D |
| Armazenamento | 10 GB livres + espaço para campanhas e assets |
| Internet | 20 Mbps download / 10 Mbps upload para self-hosting de mesa pequena |
| Runtime de desenvolvimento/self-host atual | Node.js `>=20 <25` |
| Navegador | versão atual de navegador Chromium/Firefox compatível com WebGL 2 e WebSocket |

O perfil mínimo deve priorizar mesas 2D/2.5D e cenas 3D moderadas. Cenas 3D complexas, IA local e VR não são alvo desse perfil.

### Mestre / Host: recomendado

| Componente | Requisito recomendado alvo |
| --- | --- |
| CPU | 6 a 8 núcleos modernos, classe Core i5/i7 ou Ryzen 5/7 |
| RAM | 16 GB; 32 GB para criação pesada, IA local ou mundos 3D grandes |
| GPU | GPU dedicada com 8 GB de VRAM ou superior |
| Armazenamento | SSD/NVMe com pelo menos 30 GB livres para aplicação, cache e assets ativos |
| Internet | 100 Mbps download / 20 Mbps upload ou superior; conexão cabeada quando possível |
| Tela | 1920×1080 ou superior |
| Áudio | headset/microfone dedicado recomendado para voz e interação com Mestre IA |

### Jogador: mínimo planejado

| Componente | Requisito mínimo alvo |
| --- | --- |
| CPU | processador moderno de 4 núcleos |
| RAM | 8 GB |
| GPU | WebGL 2 compatível; integrada moderna para 2D/2.5D |
| Internet | 10 Mbps estáveis |
| Navegador | versão atual compatível com WebGL 2, WebSocket e WebRTC quando necessário |

### Jogador: recomendado para 3D

| Componente | Requisito recomendado alvo |
| --- | --- |
| CPU | 6 núcleos modernos |
| RAM | 16 GB |
| GPU | dedicada com 6 GB de VRAM ou superior |
| Armazenamento | SSD e espaço disponível para cache de assets |
| Internet | 50 Mbps ou superior |
| Tela | 1920×1080 ou superior |

### IA local e VR

IA local e VR constituem perfis separados e **não fazem parte dos requisitos mínimos do VTT**. O Fênix deverá permitir IA por cloud/BYOK para que o usuário não seja obrigado a possuir hardware de IA dedicado.

Para IA local, a necessidade de GPU/VRAM dependerá do modelo selecionado e será publicada por modelo suportado. Para VR, os requisitos serão definidos quando a fase de realidade espacial possuir implementação e benchmarks reais. Não devem ser prometidos requisitos de VR antes dessa validação.

### Diretriz de desempenho

O produto deve seguir a ordem:

```text
renderização local primeiro
        ↓
cloud rendering somente quando necessário
        ↓
workers/compiladores sob demanda
        ↓
GPU cloud sem permanência ociosa
```

O objetivo é manter o Fênix acessível em hardware intermediário e impedir que a infraestrutura central assuma desnecessariamente o custo de renderização de todas as mesas.

## Execução local

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run dev
```

Fênix standalone:

```powershell
npm run dev:vtt
```

## Segurança e direitos

- nenhum componente de IA pode contornar permissões ou revelar estado oculto;
- regras determinísticas e fatos autoritativos prevalecem sobre invenção do LLM;
- material importado mantém proveniência;
- conteúdo privado do Mestre deve permanecer isolado conforme o modelo de acesso da campanha;
- conteúdo proprietário não deve ser redistribuído como parte do Fênix sem autorização;
- geração e adaptação devem respeitar direitos e licenças aplicáveis.

## Critério de sucesso

A pergunta final deixa de ser apenas "a IA escreve boas descrições?".

O objetivo é que o Fênix consiga:

> **compreender as regras utilizadas, compreender o material do mundo e da campanha, transformá-los em um mundo jogável, acompanhar esse mundo em X + Y + Z + T, improvisar sem destruir sua coerência e dirigir uma experiência dramática natural.**

Quando isso ocorrer consistentemente, o Fênix terá evoluído de um VTT com IA para um **motor de RPG espaço-temporal dirigido por um Mestre IA 4D**.
