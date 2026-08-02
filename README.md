# Mestre Orc Engine

Versão `0.1.0-alpha.36` — Node.js 20–24 e Foundry VTT 13.

O fluxo atual localiza a Scene ativa, procura o Journal correspondente no diretório do Foundry e extrai exclusivamente uma caixa read-aloud reconhecida. São aceitos os formatos antigo e atual do Plutonium/5eTools, `blockquote` HTML e citação Markdown; blocos secretos ou exclusivos do GM são ignorados. A âncora canônica é interpretada com Groq, validada e publicada no chat com áudio.

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

Abra `http://localhost:3001/health`. Os campos esperados são `"ai":"groq"` e `"audio":"browser-tts"`.

## Comandos

- `npm run dev`: inicia a API.
- `npm test`: executa os testes automatizados.
- `npm run audit`: verifica vulnerabilidades conhecidas nas dependências de produção.
- `npm run validate`: valida estrutura, versões, arquivos do módulo e proteção contra dados locais.
- `npm run check:offline`: executa validação e testes quando o endpoint de auditoria do registro npm estiver indisponível.
- `npm run check`: executa estrutura, auditoria de segurança e testes antes de cada entrega.
- `npm run release:prepare`: gera em `dist/` uma cópia limpa, sem `.git`, `.env`, dependências ou histórico local.

## Segurança e operação

- Nunca inclua `.env`, `node_modules` ou dados gerados em commits e releases.
- Em produção, configure `NODE_ENV=production` e informe somente origens confiáveis em `CORS_ALLOWED_ORIGINS`.
- A API limita o corpo das requisições e valida a ação recebida.
- Erros internos não expõem detalhes em produção; cada resposta inclui um identificador de requisição.
- O servidor encerra conexões corretamente ao receber `SIGINT` ou `SIGTERM`.

## Módulo Foundry

Copie o conteúdo de `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A pasta precisa conter diretamente `module.json`, `scripts/main.js`, `scripts/read-aloud.js`, `scripts/room-transition-state.js`, `scripts/chat-action-filter.js`, `scripts/audio-routing.js`, `scripts/token-vision.js`, `scripts/cinematic-speech.js` e `styles/mestre-orc.css`.

O botão **Áudio ligado/desligado** aparece junto ao chat para cada usuário. Nas configurações do módulo é possível ajustar voz, velocidade, tom e volume. O mestre pode desativar a transmissão para os demais clientes.

O roteiro pode conter marcações como `[sussurro]`, `[tenso]`, `[pausa]`, `[suspiro]`, `[risada]` e `[grito]`. O módulo não pronuncia os colchetes: ele separa a narração em trechos, altera ritmo, tom e volume e aplica pausas reais para reticências, travessões e quebras de linha. As marcações desconhecidas permanecem no texto para não apagar conteúdo canônico por engano.

Depois que a sessão é iniciada, o módulo acompanha os tokens por hooks e por uma verificação recorrente a cada 1,5 segundo. Ele identifica o número da sala no marcador e usa esse número para procurar a seção ou o Journal numerado correspondente dentro da pasta relacionada à cena. O módulo extrai somente o read-aloud seguro e publica uma descrição curta.

Na transição, o token que entrou torna-se o observador. O módulo usa a fonte de visão individual dele (`light`, com fallback conservador para `fov`, `shape` ou `los`) e testa pontos do volume de cada outro token. Somente atores não ocultos, não invisíveis, dentro da mesma sala numerada e dentro desse polígono chegam ao contexto da IA. Se a fonte de visão não estiver disponível, nenhum ator é enviado. A descrição escolhe poucos fatos visuais imediatos da âncora, evita inventários e rejeita linguagem de relatório antes da publicação.

A voz narrativa segue três batidas: impacto inicial, progressão do olhar e detalhe final. A tensão nasce da cadência, das pausas e do enquadramento, sem declarar emoções dos personagens nem inventar ameaças. Cada nova tentativa recebe outra combinação de tom, entrada, movimento e fecho; listas de objetos, ritmo uniforme e fórmulas como “há”, “existe” ou “a sala possui” são rejeitadas automaticamente.

O Engine detecta quatro perfis de interpretação pelo contexto: masmorras/cavernas, florestas, cidades/tavernas e ambiente geral. Cada perfil orienta marcações, pontuação e variação rítmica próprias, sem permitir que o modelo invente sons, ameaças ou criaturas para justificar a emoção.

A abertura da sessão é estritamente ambiental e nunca recebe nomes de tokens. Nas entradas de sala, personagens jogadores e tokens ausentes ou fora da visão são proibidos; somente NPCs ou criaturas comprovadamente visíveis pelo token observador podem ser citados. O Engine remove nomes de versões históricas antes de enviá-las à IA e rejeita qualquer resposta que tente reintroduzi-los.

O chat e o áudio da sala são direcionados exclusivamente aos jogadores ativos com permissão `OWNER` sobre o token que acabou de entrar. A mensagem é criada como sussurro; ela nunca cai no chat público quando não existe destinatário. O mesmo token recebe cada sala uma vez por sessão, mas outro token pode entrar depois na mesma sala e receber uma narração independente, construída a partir da própria visão. O histórico narrativo da sala continua compartilhado entre sessões para evitar repetição textual.

As publicações de áudio usam uma chave estável por sessão e uma impressão digital do texto compartilhada entre as abas do mesmo navegador. O Engine também mantém idempotência por sala e ação, impedindo duas chamadas concorrentes de gerar respostas diferentes para o mesmo evento.

Durante uma sessão ativa, mensagens públicas e textuais de jogadores no chat são classificadas como ações sociais, combate, investigação, movimento ou ação geral. O Engine identifica o alvo, produz o resultado básico de regras e relacionamento e devolve a consequência narrada em texto e áudio. Whispers, avisos de módulos, cards automatizados, rolagens, comandos iniciados por `/`, mensagens do GM e mensagens do próprio Mestre Orc são ignorados.

### Talking Actors e vozes neurais

O Talking Actors pode coexistir com o Mestre Orc, mas não é uma dependência obrigatória desta versão. O requisito de áudio privado por proprietário do token continua sendo controlado pelo socket do Mestre Orc e pelo TTS local. Isso evita que uma integração externa reproduza uma narração de sala para toda a mesa.

O arquivo `scripts/cinematic-speech.js` já inclui conversão das marcações em português para tags compatíveis com ElevenLabs v3. Essa camada deixa preparado um futuro adaptador opcional para Talking Actors/ElevenLabs sem acoplar o motor narrativo a um único provedor.

## Pipeline validado

```text
Scene ativa
→ Journal de mesmo nome ou pasta da cena
→ área inicial
→ caixa read-aloud
→ visão individual do token
→ Groq
→ SafetyGuard
→ NarrationQualityGuard
→ NoveltyGuard
→ chat
→ AudioNarrationService
→ TTS local e transmissão pelo socket do Foundry
```

Os arquivos `README-ALPHA*.md` preservam o histórico de evolução das versões anteriores.

## Publicação no GitHub

Crie um repositório vazio no GitHub e execute na raiz do projeto:

```powershell
git init
git branch -M main
git add .
git commit -m "chore: prepare Mestre Orc Engine alpha.36"
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Antes do primeiro push, confirme com `git status` que `.env`, `node_modules`, `dist/` e `data/narration-history.json` não aparecem na lista. Para preparar uma pasta de entrega higienizada, execute `npm run release:prepare`.
