# Mestre Orc / Fênix Engine

Versão base `0.1.0-alpha.24` — Node.js 20–24, Foundry VTT 13 e Fênix VTT standalone.

## Preview

![Preview do Mestre Orc Engine](docs/preview.svg)

O projeto mantém um Shared Core VTT-agnóstico para contexto, intenção, regras, relacionamentos, narração e áudio. O Foundry VTT continua como adapter de primeira classe, enquanto `apps/fenix-vtt` executa o mesmo Core como cliente standalone com Next.js, WebGL2 e sincronização multiplayer por WebSocket.

## Engine

Instale as dependências e crie a configuração local:

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run dev
```

Preencha o `.env` sem versionar chaves:

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:30000,http://127.0.0.1:30000,http://localhost:3000,http://localhost:3001
GROQ_API_KEY=sua_chave
GROQ_MODEL=seu_modelo_disponivel
MESTRE_ORC_NARRATION_MEMORY_FILE=./data/narration-history.json
MESTRE_ORC_AUDIO_ENABLED=true
MESTRE_ORC_AUDIO_MODE=browser-tts
MESTRE_ORC_AUDIO_LANGUAGE=pt-BR
MESTRE_ORC_AUDIO_RATE=0.90
MESTRE_ORC_AUDIO_PITCH=0.85
MESTRE_ORC_AUDIO_VOLUME=1.00
```

Abra `http://localhost:3001/health`. Com IA e áudio configurados, os campos esperados incluem `"ai":"groq"`, `"audio":"browser-tts"` e `"realtime":"websocket"`.

## Fênix VTT standalone

Em outro terminal:

```powershell
npm run dev:vtt
```

O cliente usa `NEXT_PUBLIC_FENIX_API_URL` para localizar o Engine. Em desenvolvimento o padrão é `http://localhost:3001`.

O fluxo standalone atual possui:

- shell Next.js 15 + React 19 + Tailwind CSS 4;
- renderer WebGL2 atrás de `MapRendererPort`;
- `StandaloneVttAdapter` consumindo o mesmo Shared Core;
- `RealtimeSessionHub` com estado autoritativo de cena, tokens e presença;
- WebSocket `/v1/realtime` via adapter Fastify;
- papéis GM/Player e autorização de movimento por `actorId`;
- troca de cena restrita ao GM;
- `ROOM_ENTERED` produzido pelo movimento do token e narrado pelo Shared Core;
- broadcast de narração e diretiva de áudio para todos os peers da mesma sessão;
- reconexão com `STATE_SYNC`, revisão de estado e histórico recente de narração.

Para testar duas janelas em desenvolvimento, a primeira pode permanecer como GM. Uma segunda janela pode usar parâmetros como `?role=player&actor=hero-ayla&name=Jogador`.

> Segurança: esses parâmetros são apenas conveniência de desenvolvimento. Com `NODE_ENV=production`, o authorizer de desenvolvimento recusa conexões realtime; uma camada de autenticação real deve fornecer identidade GM/Player antes do deploy multiplayer público.

## Comandos

- `npm run dev`: inicia a API/Engine.
- `npm run dev:vtt`: inicia o Fênix VTT.
- `npm run build:vtt`: gera o build standalone do Next.js.
- `npm test`: executa os testes `node:test`.
- `npm run test:realtime-integration`: valida o adapter WebSocket real após instalação das dependências.
- `npm run validate`: valida estrutura e versões.
- `npm run check`: executa validação + testes do Core.

## Segurança e operação

- Nunca inclua `.env`, `node_modules` ou dados gerados em commits e releases.
- Em produção, configure `NODE_ENV=production` e somente origens confiáveis em `CORS_ALLOWED_ORIGINS`.
- O upgrade WebSocket valida `Origin` antes de aceitar a conexão.
- O gateway limita mensagens por peer e o WebSocket limita payload.
- Jogadores não podem mover tokens de outros atores e não podem alterar a cena autoritativa.
- A identidade realtime de desenvolvimento é recusada em produção até existir autenticação explícita.
- Erros internos HTTP não expõem detalhes em produção; cada resposta inclui identificador de requisição.
- O servidor encerra conexões corretamente ao receber `SIGINT` ou `SIGTERM`.

## Módulo Foundry

Copie o conteúdo de `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A pasta precisa conter diretamente `module.json`, `scripts/main.js` e `styles/mestre-orc.css`.

O botão **Áudio ligado/desligado** aparece junto ao chat para cada usuário. Nas configurações do módulo é possível ajustar voz, velocidade, tom e volume. O mestre pode desativar a transmissão para os demais clientes.

Depois que a sessão é iniciada, o módulo acompanha os tokens e identifica o número da sala mais próxima. Esse número é usado para procurar a seção correspondente no Journal relacionado à cena; o vínculo individual do marcador não é usado. O módulo extrai somente o read-aloud seguro e publica uma descrição curta com áudio. Cada sala é narrada uma vez por sessão e mantém histórico próprio entre sessões.

Durante uma sessão ativa, mensagens de jogadores no chat são classificadas como ações sociais, combate, investigação, movimento ou ação geral. O Engine identifica o alvo, produz o resultado básico de regras e relacionamento e devolve a consequência narrada em texto e áudio. Comandos iniciados por `/`, mensagens do GM e mensagens do próprio Mestre Orc são ignorados.

## Arquitetura validada

```text
Foundry VTT --------------------┐
                               ├→ VTT Contracts → Shared Core → NarrationOutput
Fênix VTT → Realtime Gateway --┘                       │
    │                                                   ├→ texto
    ├→ WebGL2 / MapRendererPort                        └→ áudio
    ├→ Presence / Token / Scene State                       ↓
    └→ WebSocket ←──────────── broadcast ───────────── peers
```

O `SessionDirector` não conhece Foundry, Fastify, WebSocket, React ou WebGL. O gateway realtime é uma camada de aplicação/transporte e o módulo Foundry preserva a lógica alpha.24 de correlação por número de sala.

## CI

A pipeline exige:

1. validação + testes do Core em Node.js 20, 22 e 24;
2. `package-lock.json` portátil, sem registry privado;
3. `npm ci` usando o registry público;
4. import do Fastify e `@fastify/websocket`;
5. integração WebSocket real com `injectWS`;
6. build de produção do Fênix VTT.

Os arquivos `README-ALPHA*.md` preservam o histórico de evolução das versões anteriores.
