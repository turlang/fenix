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

1. **Architecture 2.0 Foundation** — protocolo, Bridge SDK, contratos de Cloud Render, Render Node Gateway e AI Gateway. (este marco)
2. **AI Gateway Runtime** — ligar Mestre Fênix ao gateway e configurar Local LLM + fallback.
3. **VTT Bridge v1** — adapter Foundry usando o protocolo comum.
4. **Remote Render Broker API** — autenticação, autorização, criação/encerramento de sessões GPU e signalling.
5. **First Person Runtime Prototype** — uma cena real do Fênix renderizada remotamente e controlada por intents.
6. **Dual View Sync** — alternar Top View / First Person sobre a mesma cena e token persistente.
7. **GPU Scheduler/Scaling** — capacidade, filas, regiões, métricas e múltiplos Render Nodes.

## Guardrails

- `platform-protocol`, `vtt-bridge-sdk`, `render-stream-contract`, `render-node-gateway` e `ai-inference-gateway` não importam componentes de `apps/fenix-vtt`.
- VTT externo nunca vira fonte de regra; adapters traduzem eventos.
- cliente First Person nunca envia teleport/posição como autoridade.
- navegador nunca recebe credenciais da LLM local.
- navegador não se conecta diretamente ao AI GPU Node.
- AI e render são workloads GPU distintos, mesmo quando hospedados no mesmo servidor físico.
