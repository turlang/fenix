# Fênix Platform Architecture 2.0

## Decisão de produto

O Fênix passa a ter dois papéis simultâneos:

1. **Fênix VTT** — plataforma própria para jogar RPG, com Top View e First Person.
2. **Fênix Platform/Core** — Engine reutilizável por integrações com outros VTTs por meio de adapters.

Foundry VTT continua sendo a principal referência de ergonomia para interações consolidadas, mas o Core não depende de Foundry nem da UI do Fênix.

## Regra de autoridade

O mundo é único. Top View, First Person e VTTs externos são projeções/clients do mesmo estado autoritativo.

```text
Scene + Actors + Tokens + Sheets + Rules
                 |
          Authoritative Core
       /         |          \
Fênix Top    Fênix First    VTT Bridges
  View          Person      (Foundry/etc.)
```

Nenhum renderer decide movimento, visão, voo, colisão, identidade do token ou regras do sistema.

## Domínios

### Fênix Core

Os pacotes existentes de Cena, Token, Ator/Ficha, regras, realtime, Fog, iluminação e Mestre Fênix continuam sendo a autoridade.

### Platform Protocol

`packages/platform-protocol`

Envelope comum para eventos independentes de VTT: troca de cena, movimento/seleção de token, ação, chat e mudança de modo de visão.

### VTT Bridge SDK

`packages/vtt-bridge-sdk`

Adapters traduzem eventos externos para o protocolo Fênix e eventos Fênix para a API do VTT hospedeiro. Um adapter Foundry será uma implementação do SDK, não uma dependência do Core.

### First Person / Remote Render

`packages/render-stream-contract`

Primeira pessoa pode ser renderizada remotamente. O cliente envia **intenção** (`move`, `look`, `action`), nunca posição autoritativa.

Fluxo:

```text
Browser / thin client
      | input intent
      v
Fênix App Server -> Rules/Collision -> Token state
      |
      v
Render Node GPU -> video/audio -> WebRTC -> Browser
```

Top View continua podendo ser renderizada localmente no navegador. First Person pode usar `cloud`, `local` ou `auto`, porém a arquitetura principal aceita jogador sem GPU forte por meio de Cloud Render.

### Render Node Gateway

`packages/render-node-gateway`

O App Server solicita uma sessão de render. O gateway escolhe um Render Node saudável e recebe um descritor WebRTC. O contrato não é acoplado ao motor 3D; Unreal Pixel Streaming, outro engine ou implementação futura podem cumprir o mesmo contrato.

### AI Inference Gateway

`packages/ai-inference-gateway`

Roteamento de inferência entre GPU local e providers cloud. Políticas iniciais:

- `local-only`
- `local-preferred`
- `cloud-only`

O adapter OpenAI-compatible permite conectar runtimes locais compatíveis sem acoplamento a vendor. O `ai-provider` atual permanece ativo até a migração controlada do Mestre Fênix para o gateway.

### Content Ingestion, Localization & Knowledge

Importadores são adapters de entrada e não fazem parte do domínio autoritativo de regras. PDF, Foundry JSON/Bridge, DOCX e outras fontes devem ser normalizados para um **Fênix Adventure Model** VTT-agnóstico antes de alimentar o Mestre Fênix.

Fluxo normativo:

```text
Source Original
      ↓
Extraction / Source Adapter
      ↓
Normalization
      ↓
Language Detection + Localization
      ↓
Semantic Compiler
      ↓
Fênix Adventure Model
      ↓
Knowledge Engine / RAG
      ↓
Narration Context Builder
      ↓
Mestre Fênix
```

Regras de fronteira:

- a fonte original e sua proveniência são preservadas;
- localização é uma camada derivada e versionável, inicialmente priorizando `pt-BR`;
- tradução e adaptação narrativa são processos separados;
- fatos mecânicos estruturados têm precedência sobre prosa localizada ou gerada;
- conteúdo secreto/GM-only mantém política explícita de revelação;
- o Mestre Fênix recebe contexto recuperado relevante, não o documento completo como prompt bruto;
- geometria de mapa inferida de PDF não vira Cena autoritativa sem confiança suficiente e revisão do GM;
- Foundry e outras fontes externas fornecem conteúdo, não autoridade de regras.

A especificação normativa desta camada está em [`FENIX_CONTENT_IMPORT_LOCALIZATION.md`](./FENIX_CONTENT_IMPORT_LOCALIZATION.md).

## Infraestrutura híbrida alvo

```text
                         Internet
                            |
                    Fênix App Server
          Next/VTT + API + WS + Auth + Postgres
                  /                         \
          private network               private network
               /                             \
        AI GPU Node                    Render GPU Node(s)
     LLM / STT / TTS                  3D runtime / encoder
                                            |
                                       WebRTC stream
                                            |
                                      Player browser
```

AI GPU e Render GPU podem compartilhar a mesma máquina em um ambiente pequeno, mas são papéis separados. A arquitetura não pode assumir que sempre compartilharão VRAM ou processo.

## Primeira pessoa e ficha

A câmera é derivada da entidade autoritativa:

- posição vem do Token da cena;
- altura dos olhos vem da Ficha/Ator;
- alcance e tipos de visão vêm da Ficha + Sistema RPG;
- luz, portas, paredes, pisos, rampas e elevação vêm da Cena;
- capacidade de andar, correr, nadar, escalar ou voar vem da Ficha + Sistema RPG.

O renderer recebe o resultado resolvido. Ele não concede capacidades ao personagem.

## Sequência de implementação

1. **Architecture 2.0 Foundation** — protocolo, Bridge SDK, contratos de Cloud Render, Render Node Gateway e AI Gateway.
2. **AI Gateway Runtime** — ligar Mestre Fênix ao gateway e configurar Local LLM + fallback.
3. **VTT Bridge v1** — adapter Foundry usando o protocolo comum.
4. **Remote Render Broker API** — autenticação, autorização, criação/encerramento de sessões GPU e signalling.
5. **First Person Runtime Prototype** — uma cena real do Fênix renderizada remotamente e controlada por intents.
6. **Dual View Sync** — alternar Top View / First Person sobre a mesma cena e token persistente.
7. **GPU Scheduler/Scaling** — capacidade, filas, regiões, métricas e múltiplos Render Nodes.
8. **Universal Content Importer / PDF Semantic Adventure Compiler** — ingestão estruturada de PDF e Foundry, localização `pt-BR`, proveniência, Knowledge Engine/RAG e políticas de segredo conforme a especificação normativa.

## Guardrails

- `platform-protocol`, `vtt-bridge-sdk`, `render-stream-contract`, `render-node-gateway` e `ai-inference-gateway` não importam componentes de `apps/fenix-vtt`.
- VTT externo nunca vira fonte de regra; adapters traduzem eventos e conteúdo.
- cliente First Person nunca envia teleport/posição como autoridade.
- navegador nunca recebe credenciais da LLM local.
- navegador não se conecta diretamente ao AI GPU Node.
- AI e render são workloads GPU distintos, mesmo quando hospedados no mesmo servidor físico.
- importadores externos nunca escrevem diretamente em domínios autoritativos sem normalização/validação.
- texto original importado não é substituído destrutivamente por tradução.
- tradução/narração não alteram fatos mecânicos estruturados.
- material de terceiros só pode ser importado/armazenado conforme direitos e autorização aplicáveis; código sem licença compatível não é copiado para o projeto.
