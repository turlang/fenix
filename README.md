# Mestre Orc Engine

Versão `0.1.0-alpha.41` — Node.js 20–24 e Foundry VTT 13.

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
MESTRE_ORC_CAMPAIGN_MEMORY_FILE=./data/campaign-memory.json
ADVENTURE_LIBRARY_FILE=./data/adventure-library.json
PDFTOTEXT_COMMAND=pdftotext
MESTRE_ORC_AUDIO_ENABLED=true
MESTRE_ORC_AUDIO_MODE=browser-tts
MESTRE_ORC_AUDIO_LANGUAGE=pt-BR
MESTRE_ORC_AUDIO_RATE=0.90
MESTRE_ORC_AUDIO_PITCH=0.85
MESTRE_ORC_AUDIO_VOLUME=1.00
```

Abra `http://localhost:3001/health`. Os campos esperados são `"ai":"groq"`, `"audio":"browser-tts"`, `"campaignMemory":"persistent-file"` e `"adventureLibrary":"persistent-file"`.

## Comandos

- `npm run dev`: inicia a API.
- `npm test`: executa os testes automatizados.
- `npm run audit`: verifica vulnerabilidades conhecidas nas dependências de produção.
- `npm run validate`: valida estrutura, versões, arquivos do módulo e proteção contra dados locais.
- `npm run check:offline`: executa validação e testes quando o endpoint de auditoria do registro npm estiver indisponível.
- `npm run check`: executa estrutura, auditoria de segurança e testes antes de cada entrega.
- `npm run release:prepare`: gera em `dist/` uma cópia limpa, sem `.git`, `.env`, dependências ou histórico local.


## Memória persistente da campanha

A alpha.40 mantém em `data/campaign-memory.json` os fatos observados, o estado e a localização dos NPCs, as relações entre personagens e NPCs, as missões, os itens e o último `World State`. Cada campanha é isolada pelo `worldId` do Foundry. O arquivo é ignorado pelo Git e removido automaticamente das entregas limpas.

Ao reiniciar a API, a próxima sessão recupera o estado persistido e continua a numeração das rodadas. Eventos repetidos com o mesmo `eventId` não são gravados duas vezes. Registros marcados como `secret` continuam disponíveis no painel do mestre, mas não entram no contexto enviado à narração.

O mestre pode abrir **Memória da campanha** no chat ou nos controles da cena para consultar, criar, atualizar e remover registros. A API também oferece:

- `GET /v1/campaign-memory/:campaignId`
- `POST /v1/campaign-memory/:campaignId/:collection`
- `DELETE /v1/campaign-memory/:campaignId/:collection/:recordId`

As coleções válidas são `facts`, `npcs`, `relationships`, `quests` e `items`.



## Biblioteca semântica da aventura

A alpha.41 adiciona uma biblioteca persistente por campanha para importar material em **TXT, Markdown, HTML, DOCX e PDF**. O conteúdo é extraído, dividido por seções e indexado localmente em `data/adventure-library.json`. O arquivo permanece fora do Git e das entregas limpas.

O mestre abre **Biblioteca da aventura** no chat ou nos controles da cena. O painel permite importar, pesquisar, alterar a proteção e remover documentos. Arquivos repetidos são detectados por SHA-256. O limite atual é 12 MB por arquivo.

Cada documento possui um modo de segurança:

- `REFERENCE_ONLY`: todo o conteúdo fica disponível apenas na busca do mestre e nunca é enviado à IA. É o padrão.
- `READ_ALOUD_ONLY`: somente seções identificadas como “read aloud”, “texto para ler”, “descrição para jogadores” ou equivalentes entram no contexto narrativo.
- `PLAYER_SAFE`: libera o documento para recuperação narrativa, mas seções com títulos como segredo, armadilha, solução, estatísticas, tesouro ou notas do mestre continuam bloqueadas.

A busca usa relevância lexical por título, seção, frase e termos normalizados. Antes de cada rodada, turno, resumo de combate ou entrada de sala, o Engine recupera apenas alguns trechos `PLAYER_SAFE` relacionados ao contexto atual. O prompt proíbe citar o documento ou usar a referência para inventar resultados mecânicos.

DOCX é extraído pelo próprio Engine, sem dependência externa. Para PDF, o Engine usa `pdftotext` quando disponível e possui um fallback para PDFs textuais simples. PDFs digitalizados exigem OCR ou conversão para TXT. No Windows, `PDFTOTEXT_COMMAND` pode apontar para o executável do Poppler.

Endpoints:

- `GET /v1/adventure-library/:campaignId`
- `POST /v1/adventure-library/:campaignId/import`
- `GET /v1/adventure-library/:campaignId/search?q=...`
- `POST /v1/adventure-library/:campaignId/:documentId/mode`
- `DELETE /v1/adventure-library/:campaignId/:documentId`


## Combate e Combat Tracker

A alpha.40 sincroniza o combate ativo do Foundry com o Engine. O turno atual, o combatente ativo, a rodada e a lista de combatentes são normalizados antes de qualquer resolução. Enquanto o Combat Tracker estiver ativo, o fluxo de rodada fora de combate fica suspenso para evitar duas resoluções concorrentes.

Mensagens e cards do sistema entram na economia de ações do turno como `ACTION`, `BONUS_ACTION`, `REACTION`, `MOVEMENT` ou `FREE_ACTION`. Prefixos como `Ação bônus:`, `Reação:` e `Movimento:` também são reconhecidos. Uma nova declaração do mesmo personagem e do mesmo tipo substitui a anterior antes da narração; tipos diferentes permanecem separados. A reação pode vir de outro combatente, mas é limitada a uma por personagem em cada rodada.

O Engine só trata total, dano, crítico ou falha como confirmados quando a mensagem do Foundry contém uma rolagem marcada como autoritativa. Sem esse dado, a IA recebe uma proibição explícita de inventar acerto, dano, condição, deslocamento ou consumo de recurso.

Por padrão, o mestre pode avançar a iniciativa normalmente: o módulo narra o turno anterior e, na mudança de rodada, produz um resumo cinematográfico. As opções **Narrar turno automaticamente** e **Resumir rodada de combate automaticamente** podem ser desligadas nas configurações. Os botões **Narrar turno** e **Resumo da rodada de combate** continuam disponíveis para controle manual.

Endpoints do combate:

- `POST /v1/session/combat/sync`
- `POST /v1/session/combat/action`
- `POST /v1/session/combat/turn/resolve`
- `POST /v1/session/combat/round/summary`
- `POST /v1/session/combat/end`

Turnos narrados e resumos de rodada são gravados na memória da campanha com deduplicação por evento. A aplicação de dano, condições ou consumo de recursos continua sob responsabilidade do sistema e do mestre; o Mestre Orc narra os resultados confirmados, mas não altera fichas automaticamente.

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

A pasta precisa conter diretamente `module.json`, `scripts/main.js`, `scripts/read-aloud.js`, `scripts/room-transition-state.js`, `scripts/chat-action-filter.js`, `scripts/audio-routing.js`, `scripts/token-vision.js`, `scripts/cinematic-speech.js`, `scripts/voice-input.js`, `scripts/combat-tracker.js`, `scripts/adventure-library-panel.js` e `styles/mestre-orc.css`.

O botão **Áudio ligado/desligado** aparece junto ao chat para cada usuário. Nas configurações do módulo é possível ajustar voz, velocidade, tom e volume. O mestre pode desativar a transmissão para os demais clientes.

O botão **Falar ação** permite entrada por voz durante uma sessão ativa. O jogador precisa controlar um token próprio ou possuir um personagem vinculado ao usuário. Ao clicar, o módulo interrompe temporariamente o TTS para não capturar a própria narração, mostra a transcrição parcial e publica o resultado como mensagem do personagem. O cliente do GM recebe essa mensagem pelo hook normal do chat e a registra na fila da rodada. A opção **Enviar transcrição automaticamente** pode ser desativada para preencher o campo do chat e permitir revisão antes do envio.

O reconhecimento usa `SpeechRecognition`/`webkitSpeechRecognition` do navegador, com idioma configurável e `pt-BR` como padrão. Recomenda-se Chrome ou Edge atualizado, com permissão de microfone e acesso ao Foundry por HTTPS ou `localhost`. Quando o navegador não oferece o recurso, o botão informa que a entrada por voz está indisponível sem afetar o chat textual.

O roteiro pode conter marcações como `[sussurro]`, `[tenso]`, `[pausa]`, `[suspiro]`, `[risada]` e `[grito]`. O módulo não pronuncia os colchetes: ele separa a narração em trechos, altera ritmo, tom e volume e aplica pausas reais para reticências, travessões e quebras de linha. As marcações desconhecidas permanecem no texto para não apagar conteúdo canônico por engano.

Depois que a sessão é iniciada, o módulo acompanha os tokens por hooks e por uma verificação recorrente a cada 1,5 segundo. Ele identifica o número da sala no marcador e usa esse número para procurar a seção ou o Journal numerado correspondente dentro da pasta relacionada à cena. O módulo extrai somente o read-aloud seguro e publica uma descrição curta.

Na transição, o token que entrou torna-se o observador. O módulo usa a fonte de visão individual dele (`light`, com fallback conservador para `fov`, `shape` ou `los`) e testa pontos do volume de cada outro token. Somente atores não ocultos, não invisíveis, dentro da mesma sala numerada e dentro desse polígono chegam ao contexto da IA. Se a fonte de visão não estiver disponível, nenhum ator é enviado. A descrição escolhe poucos fatos visuais imediatos da âncora, evita inventários e rejeita linguagem de relatório antes da publicação.

A voz narrativa segue três batidas: impacto inicial, progressão do olhar e detalhe final. A tensão nasce da cadência, das pausas e do enquadramento, sem declarar emoções dos personagens nem inventar ameaças. Cada nova tentativa recebe outra combinação de tom, entrada, movimento e fecho; listas de objetos, ritmo uniforme e fórmulas como “há”, “existe” ou “a sala possui” são rejeitadas automaticamente.

O Engine detecta quatro perfis de interpretação pelo contexto: masmorras/cavernas, florestas, cidades/tavernas e ambiente geral. Cada perfil orienta marcações, pontuação e variação rítmica próprias, sem permitir que o modelo invente sons, ameaças ou criaturas para justificar a emoção.

A abertura da sessão é estritamente ambiental e nunca recebe nomes de tokens. Nas entradas de sala, personagens jogadores e tokens ausentes ou fora da visão são proibidos; somente NPCs ou criaturas comprovadamente visíveis pelo token observador podem ser citados. O Engine remove nomes de versões históricas antes de enviá-las à IA e rejeita qualquer resposta que tente reintroduzi-los.

O chat e o áudio da sala são direcionados exclusivamente aos jogadores ativos com permissão `OWNER` sobre o token que acabou de entrar. A mensagem é criada como sussurro; ela nunca cai no chat público quando não existe destinatário. O mesmo token recebe cada sala uma vez por sessão, mas outro token pode entrar depois na mesma sala e receber uma narração independente, construída a partir da própria visão. O histórico narrativo da sala continua compartilhado entre sessões para evitar repetição textual.

As publicações de áudio usam uma chave estável por sessão e uma impressão digital do texto compartilhada entre as abas do mesmo navegador. O Engine também mantém idempotência por sala e ação, impedindo duas chamadas concorrentes de gerar respostas diferentes para o mesmo evento.

Durante uma sessão ativa, mensagens públicas e textuais de jogadores no chat são registradas como declarações da rodada fora de combate. Cada personagem mantém somente sua declaração mais recente; uma nova mensagem do mesmo personagem substitui a anterior sem apagar as ações dos demais. Whispers, avisos de módulos, cards automatizados, rolagens, comandos iniciados por `/`, mensagens manuais do GM e mensagens do próprio Mestre Orc são ignorados. Uma mensagem do GM marcada pelo módulo como entrada de voz é aceita quando estiver vinculada a um personagem.

O botão **Resolver rodada** mostra o número da rodada e a quantidade de personagens que já declararam ações. Ao acioná-lo, o Engine executa uma única vez o pipeline `Action Interpreter → Rules Adapter → Relationship Service → NPC Coordinator → World State → narração consolidada`. O adaptador do sistema ativo opera em modo consultivo e não inventa rolagens, dano ou resultados mecânicos. A narração e o áudio são publicados uma única vez para a rodada inteira; se a IA falhar, as declarações permanecem na fila para nova tentativa.

### Talking Actors e vozes neurais

O Talking Actors pode coexistir com o Mestre Orc, mas não é uma dependência obrigatória desta versão. O requisito de áudio privado por proprietário do token continua sendo controlado pelo socket do Mestre Orc e pelo TTS local. Isso evita que uma integração externa reproduza uma narração de sala para toda a mesa.

O arquivo `scripts/cinematic-speech.js` já inclui conversão das marcações em português para tags compatíveis com ElevenLabs v3. Essa camada deixa preparado um futuro adaptador opcional para Talking Actors/ElevenLabs sem acoplar o motor narrativo a um único provedor.

## Pipeline validado

```text
Início de sessão
→ Scene ativa
→ Journal de mesmo nome ou pasta da cena
→ área inicial
→ caixa read-aloud
→ Groq + SafetyGuard + QualityGuard + NoveltyGuard
→ abertura no chat e áudio

Rodada fora de combate
→ texto digitado ou ação reconhecida por voz
→ uma declaração por personagem
→ Action Interpreter
→ Rules Adapter do sistema ativo
→ Relationship Service
→ NPC Coordinator
→ World State
→ uma narração consolidada
→ chat + AudioNarrationService
```

Os arquivos `README-ALPHA*.md` preservam o histórico de evolução das versões anteriores.

## Publicação no GitHub

Crie um repositório vazio no GitHub e execute na raiz do projeto:

```powershell
git init
git branch -M main
git add .
git commit -m "feat: add voice action input alpha.38"
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Antes do primeiro push, confirme com `git status` que `.env`, `node_modules`, `dist/` e `data/narration-history.json` não aparecem na lista. Para preparar uma pasta de entrega higienizada, execute `npm run release:prepare`.
