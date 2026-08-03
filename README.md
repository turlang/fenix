# Mestre Orc Engine

Versão `0.1.0-alpha.50` — Node.js 20–24 e Foundry VTT 13.

O fluxo atual localiza a Scene ativa, procura o Journal correspondente no diretório do Foundry e extrai exclusivamente uma caixa read-aloud reconhecida. São aceitos os formatos antigo e atual do Plutonium/5eTools, `blockquote` HTML e citação Markdown; blocos secretos ou exclusivos do GM são ignorados. A âncora canônica é interpretada pelo primeiro provedor de IA saudável da ordem configurada, validada e publicada no chat com áudio. Groq, OpenAI, Anthropic e endpoints OpenAI-compatible podem operar com fallback automático. A saída pode usar o TTS do navegador ou voz neural externa com perfis persistentes para narrador e NPCs. O mestre também pode gerar e arquivar aventuras, NPCs e dungeons originais com bloqueio de repetição, planejar mapas vetoriais e convertê-los em Scenes editáveis do Foundry. A alpha.50 acrescenta a Central Mestre Orc unificada, uma barra compacta no chat e um único controle na Scene. Sessão, narração, combate, memória, biblioteca, criação, tutores, automações, provedores, vozes, backups e diagnóstico permanecem acessíveis por navegação organizada e responsiva.

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
AI_PROVIDER_ORDER=groq,openai,anthropic,compatible
AI_PROVIDER_TIMEOUT_MS=45000
AI_PROVIDER_FAILURE_THRESHOLD=3
AI_PROVIDER_COOLDOWN_MS=60000
OPENAI_API_KEY=
OPENAI_MODEL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
AI_COMPATIBLE_MODEL=
AI_COMPATIBLE_BASE_URL=
MESTRE_ORC_NARRATION_MEMORY_FILE=./data/narration-history.json
MESTRE_ORC_CAMPAIGN_MEMORY_FILE=./data/campaign-memory.json
ADVENTURE_LIBRARY_FILE=./data/adventure-library.json
GENERATOR_ARCHIVE_FILE=./data/generated-content.json
GENERATOR_SIMILARITY_THRESHOLD=0.62
GENERATOR_MAX_ATTEMPTS=3
MAP_BLUEPRINT_FILE=./data/map-blueprints.json
MAP_GENERATION_MAX_ATTEMPTS=2
TUTOR_HISTORY_FILE=./data/tutor-history.json
AUTOMATION_PROPOSALS_FILE=./data/automation-proposals.json
BACKUP_DIRECTORY=./data/backups
BACKUP_RETENTION_PER_CAMPAIGN=20
DIAGNOSTIC_MAX_EVENTS=300
PDFTOTEXT_COMMAND=pdftotext
MESTRE_ORC_AUDIO_ENABLED=true
MESTRE_ORC_AUDIO_MODE=browser-tts
MESTRE_ORC_AUDIO_LANGUAGE=pt-BR
MESTRE_ORC_AUDIO_RATE=0.90
MESTRE_ORC_AUDIO_PITCH=0.85
MESTRE_ORC_AUDIO_VOLUME=1.00
NEURAL_VOICE_ENABLED=true
VOICE_PROVIDER_ORDER=elevenlabs,openai,compatible
VOICE_PROFILE_FILE=./data/voice-profiles.json
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
ELEVENLABS_API_KEY=
ELEVENLABS_TTS_VOICE_ID=
COMPATIBLE_TTS_BASE_URL=
```

Abra `http://localhost:3001/health`. Os campos esperados incluem `"ai":"configured"`, `"aiProviders"`, `"audio"`, `"neuralVoice"`, `"voiceProfiles":"persistent-file"`, `"campaignMemory":"persistent-file"`, `"adventureLibrary":"persistent-file"`, `"generatedContent":"persistent-file"` , `"mapBlueprints":"persistent-file"`, `"tutors"` com modos `SHEET` e `GM` e `"automations"` com aprovação obrigatória e `"backups"` com integridade SHA-256, além de `"diagnostics"` habilitado com logs sanitizados e verificações do cliente.

## Comandos

- `npm run dev`: inicia a API.
- `npm test`: executa os testes automatizados.
- `npm run audit`: verifica vulnerabilidades conhecidas nas dependências de produção.
- `npm run validate`: valida estrutura, versões, arquivos do módulo e proteção contra dados locais.
- `npm run check:offline`: executa validação e testes quando o endpoint de auditoria do registro npm estiver indisponível.
- `npm run check`: executa estrutura, auditoria de segurança e testes antes de cada entrega.
- `npm run release:prepare`: gera em `dist/` uma cópia limpa, sem `.git`, `.env`, dependências ou histórico local.





## Central Mestre Orc unificada

A alpha.50 substitui os atalhos espalhados por uma interface única. No chat permanecem somente **Central Mestre Orc**, **áudio** e **microfone**. Nos controles da Scene existe somente um botão do módulo.

A Central possui navegação por Visão geral, Sessão, Narração, Combate, Campanha, Criação, Assistentes e Sistema. Jogadores veem apenas voz, áudio e Tutor de Ficha; ferramentas administrativas permanecem exclusivas para GM. A tela apresenta estado da API, sessão, Scene, combate, voz, filas de rodada e ações rápidas, com layout adaptado para desktop e dispositivos menores.

## Central de Diagnóstico

A alpha.49 adiciona o painel **Central de Diagnóstico**, exclusivo para usuários GM no chat e nos controles da cena. O botão **Executar diagnóstico completo** combina informações do Engine com uma coleta limitada do cliente Foundry:

- disponibilidade e versão da API;
- latência entre Foundry e Engine;
- sessão, `worldId`, Scene, rodada e combate reconhecidos;
- filas idempotentes, operações pendentes e eventos duplicados bloqueados;
- estado dos provedores de IA e voz neural;
- roteamento de áudio, suporte a TTS local e reconhecimento de voz;
- permissão do microfone, contexto HTTPS/localhost e versão do Foundry;
- leitura e gravação dos arquivos persistentes;
- último erro sanitizado e eventos recentes limitados;
- uso de memória e tempo de atividade do Engine.

Endpoints:

- `GET /v1/diagnostics/:campaignId`
- `POST /v1/diagnostics/:campaignId/run`
- `POST /v1/diagnostics/:campaignId/events`
- `POST /v1/diagnostics/:campaignId/export`

O relatório exportado é JSON, inclui SHA-256 e remove campos com aparência de chave, token, cookie, senha ou credencial. A telemetria permanece em memória e é limitada por `DIAGNOSTIC_MAX_EVENTS` (padrão `300`).

## Backup, exportação e restauração segura

A alpha.48 adiciona o painel **Backup da campanha**, exclusivo para usuários GM no chat e nos controles da cena. Cada backup reúne somente os dados persistentes pertencentes ao `worldId` ativo:

- memória da campanha;
- Biblioteca da aventura;
- aventuras, NPCs e dungeons gerados;
- plantas de mapas e vínculos com Scenes;
- perfis de voz;
- histórico dos tutores;
- propostas e auditoria das automações;
- histórico narrativo associado à campanha.

Chaves de API, tokens, senhas e campos com aparência de credencial são removidos antes da compactação. O arquivo `.mobackup` usa Gzip e SHA-256; quando o mestre informa uma senha, o conteúdo também é protegido com AES-256-GCM e chave derivada por `scrypt`. A senha nunca é armazenada.

A restauração possui duas fases. Primeiro, o arquivo é inspecionado e recebe um token temporário de uso único. Depois, o GM escolhe:

- `MERGE`: preserva registros atuais e combina o conteúdo do backup;
- `REPLACE`: substitui os dados persistentes da campanha pelo snapshot validado.

Antes de qualquer restauração, o Engine cria automaticamente um snapshot local. Se uma das fontes falhar durante a gravação, os fragmentos anteriores são reaplicados. Backups de outro `worldId` exigem remapeação explicitamente marcada pelo mestre.

Endpoints:

- `GET /v1/backups/:campaignId`
- `POST /v1/backups/:campaignId`
- `POST /v1/backups/:campaignId/:backupId/export`
- `POST /v1/backups/:campaignId/inspect`
- `POST /v1/backups/:campaignId/restore`
- `DELETE /v1/backups/:campaignId/:backupId`

Configuração:

```env
BACKUP_DIRECTORY=./data/backups
BACKUP_RETENTION_PER_CAMPAIGN=20
```

Os arquivos de backup e snapshots automáticos permanecem fora do Git e das entregas públicas.

## Automações assistidas e aprovadas pelo mestre

A alpha.47 adiciona o painel **Automações**, exclusivo para usuários GM no chat e nos controles da cena. A IA pode sugerir ações usando apenas o contexto autorizado, mas cada resultado entra em uma fila persistente com estado `PENDING`. Aprovar e executar são operações separadas; nenhuma sugestão é aplicada automaticamente.

A allowlist inicial contém somente ações pequenas e reversíveis:

- publicar mensagem pública, para GMs ou para usuários escolhidos;
- criar um Journal privado;
- adicionar uma página a um Journal existente;
- criar uma Note na Scene vinculada a um Journal;
- atualizar um recurso numérico permitido da ficha, como PV, exaustão, recursos ou moeda.

Alterações de ficha são classificadas como risco alto, exigem confirmação adicional e aceitam apenas caminhos pré-definidos. O Foundry registra um recibo com os documentos criados ou o valor anterior; esse recibo habilita o botão **Desfazer**. A reversão verifica a marca de propriedade do documento e, em recursos numéricos, confirma que o valor não mudou depois da execução. Scripts arbitrários, exclusões de mundo, mudanças de ownership, rolagens inventadas e alterações fora da allowlist são rejeitados.

Ciclo de uma proposta:

`PENDING → APPROVED → EXECUTING → EXECUTED`

Também existem os estados `FAILED`, `REJECTED`, `ROLLING_BACK` e `ROLLED_BACK`. Revisões otimistas e tokens temporários de execução impedem duplo clique e execução concorrente.

Endpoints:

- `GET /v1/automations/definitions`
- `GET /v1/automations/:campaignId`
- `GET /v1/automations/:campaignId/:proposalId`
- `POST /v1/automations/:campaignId/suggest`
- `POST /v1/automations/:campaignId`
- `POST /v1/automations/:campaignId/:proposalId/approve`
- `POST /v1/automations/:campaignId/:proposalId/reject`
- `POST /v1/automations/:campaignId/:proposalId/execute/claim`
- `POST /v1/automations/:campaignId/:proposalId/execute/result`
- `POST /v1/automations/:campaignId/:proposalId/rollback/claim`
- `POST /v1/automations/:campaignId/:proposalId/rollback/result`

Configuração:

```env
AUTOMATION_PROPOSALS_FILE=./data/automation-proposals.json
```

O arquivo contém payloads, recibos e trilha de auditoria da campanha. Ele permanece fora do Git e das entregas públicas.

## Tutor de Ficha e Tutor de Mestre

A alpha.46 adiciona o painel **Tutores**, disponível no chat para jogadores e mestres. O mestre também pode abri-lo pelos controles da cena.

O **Tutor de Ficha** trabalha somente com um snapshot curado da ficha selecionada ou do personagem vinculado ao usuário. São enviados atributos, perícias, recursos, classes, magias, itens e efeitos relevantes, com limites de tamanho e remoção de campos com aparência de credencial. Jogadores só podem consultar fichas que possuem; o mestre pode consultar fichas visíveis no mundo. A resposta informa confiança, fatos usados, alertas e próximos passos. Nenhuma alteração é aplicada à ficha.

O **Tutor de Mestre** é exclusivo para usuários GM e pode considerar:

- cena ativa e seus contadores básicos;
- estado do Combat Tracker;
- resumo do grupo;
- fatos, NPCs, relações, missões, itens e eventos da memória persistente;
- trechos relevantes da Biblioteca, inclusive material `GM_ONLY`.

As orientações separam fatos, inferências e sugestões. Quando uma regra não está presente no contexto, o tutor recomenda uma decisão provisória e reversível e orienta a consulta ao material oficial, sem reproduzir textos extensos. O tutor não altera Scene, Journal, ficha, combate, memória ou qualquer documento.

O histórico fica em `data/tutor-history.json`, isolado por `worldId`. Jogadores veem somente as próprias consultas; o mestre pode revisar o histórico completo da campanha.

Endpoints:

- `POST /v1/tutors/:campaignId/sheet`
- `POST /v1/tutors/:campaignId/gm`
- `GET /v1/tutors/:campaignId/history`

Configuração:

```env
TUTOR_HISTORY_FILE=./data/tutor-history.json
```


## Mapas automáticos e Scenes editáveis

A alpha.45 adiciona o painel **Mapas e Scenes**, disponível no chat e nos controles da cena do Foundry. O mestre pode usar uma dungeon arquivada na Forja ou escrever uma descrição direta. A IA produz um grafo abstrato de áreas e conexões; o Engine valida o resultado e calcula de forma determinística:

- posicionamento das salas sem sobreposição;
- corredores ortogonais;
- paredes com aberturas reais para portas;
- portas comuns, secretas e trancadas;
- iluminação por área;
- pontos de entrada do grupo;
- Notes numeradas e páginas de Journal;
- uma imagem SVG vetorial com grade, rótulos e tema visual.

A geração apenas arquiva a planta em `data/map-blueprints.json`. A criação da Scene exige uma ação separada do mestre. Ao confirmar, o módulo envia o SVG ao armazenamento do mundo, cria a Scene com grade e visão de token, insere `Wall`, `AmbientLight` e `Note`, cria um Journal com uma página por área e registra o vínculo no Engine.

Quando o provedor de IA está indisponível ou retorna uma estrutura inválida, o serviço usa um layout procedural seguro baseado na dungeon ou na descrição. Isso mantém o fluxo funcional sem transformar texto secreto em conteúdo visível. `readAloud` e `secret` permanecem campos separados; segredos só entram nas páginas reservadas do Journal.

Configurações:

```env
MAP_BLUEPRINT_FILE=./data/map-blueprints.json
MAP_GENERATION_MAX_ATTEMPTS=2
```

Endpoints:

- `GET /v1/maps/:campaignId`
- `GET /v1/maps/:campaignId/:mapId`
- `POST /v1/maps/:campaignId/generate`
- `POST /v1/maps/:campaignId/:mapId/scene-created`
- `DELETE /v1/maps/:campaignId/:mapId`

A exclusão de uma planta não apaga automaticamente a Scene, o Journal ou o SVG já criados. Essa separação evita perda acidental de conteúdo editado dentro do Foundry.


## Forja persistente de aventuras, NPCs e dungeons

A alpha.44 adiciona a **Forja de conteúdo**, disponível no chat e nos controles da cena do Foundry. O mestre pode solicitar:

- aventuras completas, com premissa, estrutura, NPCs, locais, conflitos, pistas e desfechos;
- NPCs com identidade, objetivos, segredos, vínculos, direção vocal e ganchos de interação;
- dungeons com fluxo textual, áreas numeradas, textos para jogadores, segredos, encontros, armadilhas, pistas e recompensas.

Cada resultado é salvo primeiro como `ARCHIVED` em `data/generated-content.json`. A geração recebe o histórico dos conteúdos do mesmo tipo, e o Engine ainda executa uma comparação local por assinatura e similaridade lexical. Se o resultado repetir título, premissa, estrutura ou vocabulário central, ele é descartado e uma nova tentativa é solicitada. Quando todas as tentativas continuam repetitivas, nada é salvo e a API retorna `GENERATOR_REPETITION_BLOCKED`.

A ativação é deliberadamente separada da geração:

- aventuras e dungeons são importadas na Biblioteca da aventura como `REFERENCE_ONLY`;
- NPCs são adicionados à memória persistente como registros `secret` e estado `GENERATED`;
- arquivar novamente não apaga documentos ou memórias que já tenham sido ativados;
- excluir remove apenas o registro da Forja, evitando apagar conteúdo de campanha por acidente.

Configurações:

```env
GENERATOR_ARCHIVE_FILE=./data/generated-content.json
GENERATOR_SIMILARITY_THRESHOLD=0.62
GENERATOR_MAX_ATTEMPTS=3
```

Endpoints:

- `GET /v1/generators/:campaignId`
- `GET /v1/generators/:campaignId/:artifactId`
- `POST /v1/generators/:campaignId/generate`
- `POST /v1/generators/:campaignId/:artifactId/activate`
- `POST /v1/generators/:campaignId/:artifactId/archive`
- `DELETE /v1/generators/:campaignId/:artifactId`

A Forja usa o mesmo orquestrador de IA resiliente da narração. Portanto, fallback e circuit breaker também se aplicam às gerações. O prompt proíbe copiar aventuras publicadas, personagens conhecidos ou texto protegido e trata sugestões mecânicas como material ajustável pelo mestre.


## Voz neural e perfis avançados de NPC

A alpha.43 adiciona uma camada de síntese neural no servidor sem remover o TTS local. `MESTRE_ORC_AUDIO_MODE` aceita:

- `browser-tts`: mantém o `SpeechSynthesis` do navegador e não chama provedores externos;
- `neural-auto`: tenta gerar o áudio no servidor e usa o TTS local quando o perfil autoriza fallback;
- `neural-only`: exige áudio neural e não reproduz voz local quando a geração falha.

São suportados `elevenlabs`, `openai` e `compatible`. A ordem de tentativa é definida por `VOICE_PROVIDER_ORDER`. O endpoint compatível usa o contrato `/audio/speech`, permitindo integrar um serviço local ou outro provedor que implemente o formato da OpenAI. As chaves permanecem somente na API e nunca são enviadas ao Foundry.

O mestre abre **Perfis de voz** no chat ou nos controles da cena. Cada campanha, isolada pelo `worldId`, pode manter:

- um perfil do narrador;
- perfis individuais vinculados ao ID de cada NPC;
- provedor, modelo, voice ID e idioma;
- velocidade, estabilidade, similaridade, expressividade e speaker boost;
- instruções de interpretação;
- ativação do perfil e permissão de fallback para o navegador.

Quando o Combat Tracker identifica um NPC ativo, a diretiva de áudio inclui automaticamente seu `npcId` e o servidor resolve o perfil correspondente. Narrações ambientais continuam usando o perfil `narrator`. Se nenhum perfil neural válido existir, o comportamento segue a política de fallback configurada.

O áudio é armazenado apenas em cache temporário por uma chave derivada do texto e do perfil. Chamadas simultâneas iguais compartilham a mesma geração, reduzindo cobranças duplicadas. O cache não persiste amostras de voz, e o projeto não oferece clonagem, treinamento ou upload de voz. A interface identifica a reprodução neural como **voz gerada por inteligência artificial**.

Endpoints:

- `GET /v1/voice/providers`
- `GET /v1/voice-profiles/:campaignId`
- `POST /v1/voice-profiles/:campaignId`
- `DELETE /v1/voice-profiles/:campaignId/:profileId`
- `POST /v1/audio/synthesize`

Configuração completa disponível em `.env.example`. Para usar ElevenLabs, informe a chave e uma voz padrão; para OpenAI, configure `OPENAI_API_KEY`; para um endpoint compatível, informe `COMPATIBLE_TTS_BASE_URL`.


## Múltiplos provedores de IA e fallback

A alpha.42 substitui o acoplamento exclusivo à Groq por um orquestrador resiliente. Os provedores configurados são tentados na ordem de `AI_PROVIDER_ORDER`; o primeiro é o primário e os demais atuam como fallback. São suportados:

- `groq`: Chat Completions em `https://api.groq.com/openai/v1`;
- `openai`: Responses API;
- `anthropic`: Messages API;
- `compatible`: qualquer endpoint compatível com Chat Completions da OpenAI, inclusive servidores locais sem chave.

O circuit breaker acompanha falhas consecutivas por provedor. Ao atingir `AI_PROVIDER_FAILURE_THRESHOLD`, ou diante de erro permanente de configuração/autenticação, o circuito é aberto e o provedor é ignorado até `AI_PROVIDER_COOLDOWN_MS`. Depois do intervalo, uma chamada de teste entra em estado `HALF_OPEN`; se funcionar, o provedor volta a `CLOSED`. Declarações, turnos e rodadas continuam preservados quando todos os provedores falham.

A telemetria não expõe chaves nem a resposta bruta de erro. O mestre consulta **Saúde da IA** no chat ou nos controles da cena, podendo atualizar métricas e rearmar manualmente um circuito. Endpoints:

- `GET /v1/ai/providers`
- `POST /v1/ai/providers/:providerId/reset`

Configuração completa disponível em `.env.example`. Para desativar um provedor, deixe sua chave/modelo ausentes. Provedores configurados que não aparecem explicitamente em `AI_PROVIDER_ORDER` são adicionados ao final da cadeia.


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

A pasta precisa conter diretamente `module.json`, `scripts/main.js`, `scripts/read-aloud.js`, `scripts/room-transition-state.js`, `scripts/chat-action-filter.js`, `scripts/audio-routing.js`, `scripts/token-vision.js`, `scripts/cinematic-speech.js`, `scripts/voice-input.js`, `scripts/combat-tracker.js`, `scripts/adventure-library-panel.js`, `scripts/ai-provider-panel.js`, `scripts/voice-profile-panel.js` e `styles/mestre-orc.css`.

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

O Talking Actors pode coexistir com o Mestre Orc, mas não é uma dependência obrigatória. O áudio privado por proprietário do token continua sendo controlado pelo socket e pelo roteamento do próprio Mestre Orc. A voz neural da alpha.43 é gerada pela API e reproduzida somente nos clientes destinatários; quando necessário, o módulo volta ao `SpeechSynthesis` local.

O arquivo `scripts/cinematic-speech.js` continua interpretando marcações como `[sussurro]`, `[tenso]` e `[pausa]`. Perfis neurais usam instruções próprias de interpretação, sem depender do Talking Actors e sem acoplar o motor narrativo a um único fornecedor.

## Pipeline validado

```text
Início de sessão
→ Scene ativa
→ Journal de mesmo nome ou pasta da cena
→ área inicial
→ caixa read-aloud
→ orquestrador de IA + SafetyGuard + QualityGuard + NoveltyGuard
→ abertura no chat
→ perfil do narrador
→ voz neural com fallback ou TTS local

Rodada fora de combate
→ texto digitado ou ação reconhecida por voz
→ uma declaração por personagem
→ Action Interpreter
→ Rules Adapter do sistema ativo
→ Relationship Service
→ NPC Coordinator
→ World State
→ uma narração consolidada
→ perfil do narrador ou do NPC ativo
→ chat + voz neural com fallback ou TTS local
```

Os arquivos `README-ALPHA*.md` preservam o histórico de evolução das versões anteriores.

## Publicação no GitHub

Crie um repositório vazio no GitHub e execute na raiz do projeto:

```powershell
git init
git branch -M main
git add .
git commit -m "feat: add neural voices and npc profiles alpha.43"
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Antes do primeiro push, confirme com `git status` que `.env`, `node_modules`, `dist/` e `data/narration-history.json`, `data/campaign-memory.json`, `data/adventure-library.json` e `data/voice-profiles.json` não aparecem na lista. Para preparar uma pasta de entrega higienizada, execute `npm run release:prepare`.
