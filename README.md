> **⚠️ COPYRIGHT NOTICE — ALL RIGHTS RESERVED**
>
> Copyright (c) 2026 **Evandro Ricardo / Mestre Orc**  
> Este software e todo o seu código-fonte são propriedade exclusiva do autor.  
> **É proibida** a cópia, modificação, distribuição, engenharia reversa ou qualquer uso sem autorização prévia e por escrito do proprietário.  
> Veja [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE).

---

# Mestre Orc / Fênix VTT

**Versão base atual:** `0.1.0-alpha.24`  
**Stack principal:** Node.js 20–24, Next.js 15, React 19, WebGL/3D, PostgreSQL, WebSocket e Shared Core de IA.

O Fênix evolui como VTT standalone com uma arquitetura preparada para IA, 3D, multiplayer e, futuramente, experiências espaciais/VR. O Foundry VTT 13 permanece como adapter de primeira classe durante essa evolução.

> **Visão:** transformar o Fênix de um VTT com IA em um motor de RPG persistente, dirigido por um **Mestre IA 4D**, capaz de compreender regras, mundo, campanha, espaço, tempo, percepção, memória e causalidade.

O roadmap detalhado está em [`ROADMAP.md`](ROADMAP.md).

## 1. Princípios do produto

### Conhecimento antes de autonomia

O Mestre IA não deve tratar a memória pré-treinada de um LLM como fonte de verdade para regras, lore ou estado da campanha. O conhecimento confiável vem do material autorizado, dos compiladores e do estado autoritativo do mundo.

```text
Rules / World / Adventure
          │
  Knowledge Foundation
    ┌─────┼─────┐
    │     │     │
  Rule  World Campaign
Compiler Compiler Compiler
    └─────┼─────┘
          │
    Campaign Model
          │
    World Authority
          │
      Mestre IA 4D
```

### Quatro fontes de verdade

O Mestre IA deverá distinguir:

1. **Rules Truth:** regras aplicáveis e resolução mecânica.
2. **World Truth:** o que realmente existe e seu estado.
3. **Character Knowledge:** o que cada personagem sabe, acredita ou percebe.
4. **Temporal Truth:** o que aconteceu, quando aconteceu e quais consequências permanecem.

### Criatividade limitada pela coerência

Improvisação é requisito central, mas não pode contradizer regras, fatos estabelecidos ou estado do mundo. O sistema deve registrar a origem das informações:

```text
CANON          estabelecido pela fonte
DERIVED        inferido a partir das fontes
GENERATED      criado para completar o mundo jogável
IMPROVISED     criado durante a sessão
PLAYER_CAUSED  consequência das ações dos jogadores
```

Fatos também poderão carregar propriedades como `immutable`, `mutable`, `hidden`, `uncertain`, `rumor` ou `false_information`.

## 2. Knowledge Foundation

### Rule Compiler

O Rule Compiler deverá transformar material de regras autorizado em conhecimento estruturado, preservando texto-fonte, conceitos mecânicos, condições, gatilhos, cálculos, exceções, relações, efeitos, proveniência e confiança da interpretação.

Sempre que uma regra puder ser formalizada, a resolução mecânica deve ser determinística:

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

### World Compiler

O World Compiler deverá transformar cenários, aventuras, campanhas e outras fontes legitimamente utilizáveis em um **World DNA** estruturado: geografia, locais, personagens, culturas, facções, história, política, cosmologia, criaturas, objetos, relações, segredos, cronologia, arquitetura, tecnologia, economia, estética, atmosfera e temas.

O objetivo não é resumir documentos. É extrair uma representação semântica capaz de alimentar um mundo jogável.

### Campaign Compiler

O Campaign Compiler combina sistema, mundo e aventura:

```text
SYSTEM + WORLD + CAMPAIGN = PLAYABLE CAMPAIGN MODEL
```

Campanhas criadas ou importadas devem produzir situações, conflitos, objetivos, personagens, segredos, ameaças e possibilidades, em vez de uma história rígida que force os jogadores por um único caminho.

### Material narrativo e mundos literários

Quando houver direito de uso apropriado, material narrativo poderá alimentar o World Compiler. A adaptação deverá separar fatos da fonte das inferências e do conteúdo criado pelo Fênix.

```text
Source Material
      ↓
Literary Analysis
      ↓
Knowledge Graph / World DNA
      ↓
RPG Adaptation
      ↓
World Model
      ↓
Spatial Compiler
      ↓
Playable World
```

A materialização espacial deve ser incremental: regiões distantes podem permanecer semanticamente representadas até que precisem ganhar maior resolução espacial.

## 3. World Model e Mestre IA 4D

No Fênix, **4D significa X + Y + Z + T**, isto é, três dimensões espaciais mais tempo. Não significa consciência humana. Significa consciência operacional do estado espaço-temporal do jogo.

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

Geometria, posição, distância, alcance, visibilidade e demais fatos determinísticos devem ser calculados pelo sistema, não inventados pelo LLM.

O Fênix deve separar realidade, percepção e conhecimento. Uma criatura pode existir no World Model sem poder ser revelada a um personagem que ainda não a percebeu. Da mesma forma, rumores e crenças incorretas podem coexistir com a verdade do mundo.

O tempo também integra o estado. Mudanças devem registrar quando ocorreram, quem as provocou, quem as percebeu e quais consequências produziram. Essa base permitirá memória temporal, grafos causais e evolução persistente do mundo.

## 4. Mundo virtual, 3D e VR

O espaço visual deve ser derivado do mesmo modelo semântico da campanha:

```text
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
NPCs / Lighting / Weather / Soundscape
      ↓
Simulation
      ↓
Mestre IA 4D
```

O objetivo não é gerar apenas cenários visualmente atraentes. Elementos precisam ter significado para a simulação: portas são portas, pontes conectam regiões, NPCs possuem relações e conhecimento e objetos possuem função.

A renderização deve ocorrer **localmente sempre que possível**. Cloud rendering será opcional e usado apenas quando trouxer benefício suficiente para justificar seu custo.

VR é uma evolução planejada, não uma arquitetura paralela. Desktop, navegador, mobile, streaming e futuras interfaces VR/AR deverão compartilhar o mesmo World Model.

## 5. Narração e NPCs

A narração natural é requisito central. O futuro **Narrative Performance Engine** deverá coordenar contexto sensorial, emoção, subtexto, ritmo, pausas, respiração, hesitação, volume, silêncio, identidade vocal, música, soundscape, iluminação e áudio espacial.

O Director AI deve poder escolher `NO_ACTION`. Nem todo acontecimento exige fala do Mestre.

NPCs deverão separar:

```text
KNOWS
FEELS
WANTS
SAYS
DOES
```

Isso permitirá memória social, mentira, medo oculto, hesitação, confiança falsa e subtexto sem confundir estado interno com informação disponível aos jogadores.

## 6. Sistemas, conteúdo e direitos

O Fênix poderá distribuir nativamente apenas regras e conteúdos cuja licença permita esse uso, incluindo sistemas abertos e materiais compatíveis com OGL, ORC, Creative Commons ou outras permissões aplicáveis.

O Mestre poderá fornecer materiais aos quais tenha acesso legítimo para uso privado em sua campanha. Conteúdo importado deve manter proveniência e isolamento e não poderá ser incorporado ao produto ou redistribuído sem autorização apropriada.

Regras determinísticas e fatos autoritativos prevalecem sobre invenções do LLM. Nenhum componente de IA poderá contornar permissões ou revelar estado oculto.

## 7. Estado atual e direção técnica

A fundação existente inclui Shared Core VTT-agnóstico, Fênix standalone, renderer desacoplado, battlemap, grid, Walls + Doors, Fog/LOS, memória de exploração, autenticação, campanhas, memberships, multiplayer, runtime distribuído, PostgreSQL opcional, leases/fencing, routing HTTP/WebSocket, idempotência e observabilidade.

**Não são declarados como concluídos:** Knowledge Foundation completa, Rule Compiler, World Compiler, Campaign Compiler, Creative Boundary Engine e World Model 4D completo.

A sequência estratégica é:

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

Consulte [`ROADMAP.md`](ROADMAP.md) para marcos e fases detalhadas.

## 8. Modelo de negócio

A direção comercial planejada é um modelo híbrido baseado em **licença principal + self-hosting + serviços opcionais**.

### Licença principal

- licença adquirida pelo Mestre;
- jogadores entram sem licença individual;
- VTT básico permanece utilizável sem assinatura obrigatória;
- Mestre pode hospedar a própria mesa;
- renderização 2D/3D prioritariamente local;
- campanhas e assets podem permanecer locais no modo self-hosted.

A faixa de **R$ 249 a R$ 399** é apenas referência de planejamento para uma possível licença perpétua. O preço final dependerá de validação de mercado, escopo, custos e impostos.

### Serviços opcionais

- **Fênix Cloud:** hospedagem 24/7, backups, storage e conexão simplificada.
- **BYOK:** uso de chave própria de provedor de IA compatível.
- **Fênix AI:** IA gerenciada por franquia, créditos ou consumo.
- **Compilers:** processamento pesado do World/Campaign Compiler por créditos ou planos.
- **Mídia premium:** voz, áudio, vídeo e geração pesada sob demanda.
- **Marketplace:** conteúdo de criadores e parceiros com participação do Fênix.
- **Conteúdo oficial/licenciado:** sistemas, mundos e campanhas quando houver autorização.

> **Diretriz econômica:** custos variáveis pesados não devem ficar escondidos dentro de uma licença ilimitada.

```text
FÊNIX LOCAL   → VTT, servidor e renderização na máquina do Mestre
FÊNIX BYOK    → VTT local + IA paga diretamente pelo Mestre
FÊNIX CLOUD   → hospedagem, IA e processamento sob demanda
```

## 9. Requisitos de sistema planejados

Estes são **alvos de produto**, não requisitos certificados da versão `0.1.0-alpha.24`. Os valores serão ajustados por benchmarks antes de releases estáveis.

### Mestre / Host

| Componente | Mínimo planejado | Recomendado |
| --- | --- | --- |
| CPU | 4 núcleos / 8 threads, classe Core i5 ou Ryzen 5 | 6–8 núcleos modernos, Core i5/i7 ou Ryzen 5/7 |
| RAM | 8 GB | 16 GB; 32 GB para criação pesada/IA local |
| GPU | WebGL 2; 4 GB VRAM para 3D | dedicada com 8 GB VRAM ou superior |
| Armazenamento | 10 GB livres + campanhas/assets | SSD/NVMe, 30 GB livres ou mais |
| Internet | 20 Mbps down / 10 Mbps up | 100 Mbps down / 20 Mbps up ou superior |
| Tela | 1280×720 funcional | 1920×1080 ou superior |
| Áudio | dispositivo de entrada/saída | headset e microfone dedicado |

O perfil mínimo prioriza 2D/2.5D e cenas 3D moderadas. IA local, mundos 3D pesados e VR exigirão perfis próprios.

### Jogador

| Componente | Mínimo planejado | Recomendado para 3D |
| --- | --- | --- |
| CPU | 4 núcleos modernos | 6 núcleos modernos |
| RAM | 8 GB | 16 GB |
| GPU | WebGL 2; integrada moderna para 2D/2.5D | dedicada com 6 GB VRAM ou superior |
| Internet | 10 Mbps estáveis | 50 Mbps ou superior |
| Tela | 1280×720 | 1920×1080 ou superior |
| Navegador | versão atual com WebGL 2/WebSocket | versão atual com WebGL 2/WebSocket/WebRTC |

### IA local e VR

IA local e VR **não fazem parte dos requisitos mínimos do VTT**. A necessidade de GPU/VRAM da IA será publicada por modelo suportado. Requisitos de VR serão definidos apenas após implementação e benchmarks reais.

### Runtime atual de desenvolvimento

O repositório exige Node.js `>=20 <25`.

```text
renderização local primeiro
        ↓
cloud rendering quando necessário
        ↓
workers e compilers sob demanda
        ↓
GPU cloud sem permanência ociosa
```

## 10. Execução local

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

## 11. Documentação

- [`ROADMAP.md`](ROADMAP.md): evolução, fases e prioridades.
- [`CHANGELOG.md`](CHANGELOG.md): histórico de mudanças.
- [`SECURITY.md`](SECURITY.md): política de segurança.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): diretrizes de contribuição.
- [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE): direitos e condições de uso.

## Critério de sucesso

O objetivo final é que o Fênix consiga **compreender as regras utilizadas, compreender o mundo e a campanha, transformá-los em um espaço jogável, acompanhar esse mundo em X + Y + Z + T, improvisar sem destruir sua coerência e dirigir uma experiência dramática natural**.

Quando isso ocorrer consistentemente, o Fênix terá evoluído de um VTT com IA para um **motor de RPG espaço-temporal dirigido por um Mestre IA 4D**.
