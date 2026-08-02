# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

## [Não publicado]

### Corrigido

- A entrega da alpha.36 agora pode ser preparada automaticamente sem `.git`, `.env`, `node_modules`, histórico de narração ou arquivos de log.
- A validação confere a versão do Engine, do módulo Foundry e do `package-lock.json`, além da existência dos scripts e estilos declarados no `module.json`.
- O validador impede que dados locais proibidos sejam rastreados pelo Git e verifica se o `.env.example` não contém chaves com aparência real.
- O `package-lock.json` deixa de depender de URLs internas de registro npm, evitando contaminar instalações em outros computadores.
- A execução de testes fica restrita à pasta `test/`, impedindo duplicação quando uma entrega já existe em `dist/`.

### Adicionado

- Comando `npm run release:prepare` para gerar uma pasta de distribuição higienizada em `dist/`.
- Comando `npm run check:offline` para validar estrutura e testes quando a auditoria remota do npm estiver indisponível.

## [0.1.0-alpha.37] - 2026-08-02

### Adicionado

- Coleta de uma declaração por personagem para rodadas fora de combate.
- Botão **Resolver rodada** no chat e nos controles de cena, com número da rodada e contador de declarações.
- Endpoint `POST /v1/session/round/resolve` para resolução consolidada e idempotente.
- `NPCCoordinator` determinístico para coordenar somente NPCs comprovadamente presentes.
- `WorldStateService` para registrar rodadas, eventos recentes e alterações de relacionamento durante a sessão.
- Adaptador consultivo do sistema ativo, com perfil específico para D&D 5e e fallback genérico.
- Prompt de IA específico para uma única narração consolidada da rodada.
- Testes de substituição de declaração, resolução múltipla, falha recuperável, NPCs e estado do mundo.

### Alterado

- `/v1/session/action` deixa de narrar imediatamente e passa a registrar a declaração na rodada atual.
- Uma nova declaração do mesmo personagem substitui a anterior; personagens diferentes continuam independentes.
- Debounce e deduplicação do chat passam a ser isolados por personagem, evitando descartar ações simultâneas de jogadores diferentes.
- A narração consolidada não inventa rolagens, dano, condições ou resultados mecânicos definitivos.

### Segurança e confiabilidade

- Se a IA ou a publicação falhar, as declarações permanecem disponíveis para nova tentativa.
- Resoluções repetidas com o mesmo `eventId` não geram uma segunda narração.
- Declarações sem personagem vinculado são rejeitadas antes de entrar na fila.

## [0.1.0-alpha.36] - 2026-07-22

### Adicionado

- Classificação automática de ambiente em masmorra/caverna, floresta, cidade/taverna ou perfil geral.
- Marcações contextuais de interpretação como `[sussurro]`, `[tenso]`, `[pausa]`, `[suspiro]`, `[risada]` e `[grito]` nos prompts de abertura, sala e resolução.
- Interpretador de roteiro expressivo no módulo Foundry, com perfis de ritmo, tom e volume por trecho.
- Pausas reais para marcações, reticências, travessões, quebras de linha e mudanças de parágrafo.
- Conversor de marcações em português para tags de áudio do ElevenLabs v3, preparando integração opcional futura.
- Testes automatizados para marcações, pausas, perfis ambientais e conversão de roteiro.

### Alterado

- O `AudioNarrationService` preserva parágrafos e quebras de linha em vez de reduzir toda a narração a uma frase contínua.
- O TTS do navegador deixa de pronunciar marcações entre colchetes e passa a reproduzir a narração como uma sequência expressiva.
- Frases curtas, frases cadenciadas, reticências e travessões passam a ser exigidos de acordo com o ambiente detectado.

### Arquitetura

- Talking Actors permanece uma integração opcional, não uma dependência rígida, preservando o roteamento privado por usuário do Mestre Orc.
- O pipeline próprio de áudio continua sendo o fallback seguro para entradas de sala direcionadas ao dono do token.

## [0.1.0-alpha.35] - 2026-07-22

### Adicionado

- Cinco direções cinematográficas rotativas para entradas de sala, combinando tom, imagem inicial, progressão do olhar e detalhe final.
- Métricas de cadência que observam comprimento das frases, variação rítmica e enumerações.
- Correções em linguagem natural para orientar a tentativa seguinte quando o estilo é rejeitado.

### Alterado

- Prompts de abertura, sala e resolução passam a priorizar voz oral, verbos concretos, pausas e progressão espacial.
- A tensão é construída pela cadência e pelo enquadramento, sem declarar emoções dos personagens ou inventar ameaças.
- A abertura permite consequências sensoriais inevitáveis; entradas de sala permanecem visuais e usam metáforas breves somente para reformular fatos confirmados.
- Entradas de sala têm alvo de 55–110 palavras e usam criatividade moderadamente maior, mantendo SafetyGuard, QualityGuard e NoveltyGuard.

### Corrigido

- Descrições em formato de inventário, cadência uniforme e fórmulas como “há”, “existe”, “encontra-se” ou “a sala possui” são regeneradas.
- Frases que apenas declaram “uma tensão” ou “uma atmosfera” deixam de ser aceitas como substituto para uma narração emocional.
- Sons, cheiros e temperatura introduzidos em descrições de sala são rejeitados para manter o recorte individual estritamente visual.

## [0.1.0-alpha.34] - 2026-07-21

### Corrigido

- A abertura deixa de citar tokens ou personagens existentes em outras salas da cena.
- A lista interna de nomes de tokens da Scene agora atravessa todo o fluxo `Foundry → Adapter → Context → NarrationService`.
- Cada entrada de sala também envia essa proteção, inclusive quando a sessão foi iniciada antes da atualização do módulo.
- Respostas que mencionam personagens jogadores ou tokens fora da visão são rejeitadas e regeneradas antes de chegar ao chat ou ao áudio.

### Alterado

- A abertura é exclusivamente ambiental; nenhum ator da Scene é entregue ao provider de IA.
- Entradas de sala podem citar apenas NPCs ou criaturas comprovadamente visíveis pelo token observador.
- Nomes de tokens presentes em narrações históricas são substituídos antes de essas versões serem usadas para orientar novidade.

### Segurança

- A lista de exclusão nunca é incluída no prompt enviado ao provider; ela é usada somente pelos controles locais do Engine.
- O filtro compara nomes completos sem confundir trechos dentro de outras palavras.

## [0.1.0-alpha.33] - 2026-07-21

### Corrigido

- O estado de narração agora usa a combinação `token + sala`; a primeira entrada não bloqueia outros tokens que chegam depois.
- O `eventId` do Engine e as chaves de publicação incluem o token observador, preservando idempotência sem eliminar entregas legítimas.
- Entradas simultâneas de tokens diferentes na mesma sala são tratadas como eventos independentes.

### Alterado

- Áudio de sala é enviado somente aos usuários ativos com permissão `OWNER` sobre o token que realizou a entrada.
- Mensagens de entrada de sala são publicadas como sussurro para os mesmos destinatários do áudio.
- Aberturas de sessão e consequências de ações continuam no chat público.

### Segurança

- Uma narração de sala sem proprietário ativo é descartada em vez de ser publicada acidentalmente no chat público.

## [0.1.0-alpha.32] - 2026-07-21

### Adicionado

- Cálculo de percepção por token usando a fonte de visão individual do Foundry VTT 13.
- Contrato `perception` no endpoint de entrada de sala, com modo, observador, tipo de polígono e quantidade de atores comprovadamente visíveis.
- Testes unitários para luz, campo de visão, fallback conservador, cegueira, ocultação e deduplicação de atores.
- Avaliador de estilo que rejeita linguagem técnica, inventário e fórmulas de relatório antes da publicação.

### Alterado

- Atores da sala agora precisam estar na mesma sala numerada e dentro do polígono visual do token que realizou a transição.
- O payload de atores de sala foi reduzido a `id`, `name` e `type`; dados internos do Actor não são enviados nessa rota.
- O prompt de sala descreve poucos detalhes visuais imediatos, em linguagem de mesa mais natural, sem sons ou sensações inventadas.
- Quando a visão individual não pode ser comprovada, o Engine descarta todos os atores recebidos e usa somente a âncora canônica em modo conservador.

### Segurança

- Tokens ocultos, invisíveis, fora da sala ou fora da visão do observador deixam de participar da narrativa.
- O polígono `light` tem prioridade e não é ampliado por `los`, evitando revelar atores em regiões não iluminadas.

## [0.1.0-alpha.31] - 2026-07-21

### Adicionado

- Áudio de entrada de sala direcionado aos usuários ativos com permissão `OWNER` sobre os tokens presentes na sala.
- Lista explícita de destinatários em cada diretiva de áudio de sala.
- Filtro no cliente que ignora silenciosamente áudio destinado a outros jogadores.

### Alterado

- Atores enviados no contexto da sala agora são somente os personagens realmente detectados naquela sala.
- O GM não reproduz localmente o áudio direcionado quando não é um dos destinatários.
- Abertura da sessão e demais narrações sem lista de destinatários continuam gerais.

## [0.1.0-alpha.30] - 2026-07-21

### Corrigido

- Idempotência passa a ocorrer no Engine antes da geração: uma sala ou ação produz apenas uma resposta por sessão.
- Chamadas simultâneas aguardam a mesma operação; somente o primeiro solicitante publica chat e áudio.
- O módulo envia identificadores estáveis para entradas de sala e mensagens de jogadores.
- A trava de publicação usa armazenamento compartilhado entre abas do mesmo navegador.
- Diretivas repetidas recebidas pelo socket são bloqueadas pela chave de publicação antes do TTS.

## [0.1.0-alpha.29] - 2026-07-21

### Corrigido

- Avisos privados do Plutonium deixam de ser interpretados como ações de jogadores.
- Whispers, rolagens, cards automatizados, mensagens de módulos e estilos não textuais são descartados antes de chamar o Engine.
- Conteúdo idêntico recebido com IDs diferentes é processado no máximo uma vez a cada 30 segundos.
- Respostas de ações usam a mesma deduplicação de chat e áudio das demais narrações.
- O hook redundante de composição foi removido; somente mensagens efetivamente criadas são processadas.

## [0.1.0-alpha.28] - 2026-07-21

### Corrigido

- A mesma narração de áudio é bloqueada por chave de publicação e por impressão digital do texto, mesmo quando chega com IDs diferentes pelo socket.
- As trocas de sala são verificadas a cada 1,5 segundo durante a sessão e não dependem exclusivamente do hook `updateToken`.
- O número da sala também é resolvido diretamente pelo Journal e pela página vinculados ao marcador.
- Marcadores renderizados e documentos da Scene são combinados para evitar perda temporária durante a montagem do canvas.

### Diagnóstico

- A versão realmente carregada aparece em notificação e no console ao abrir o Foundry.
- Movimento, verificação, entrada detectada, Journal ausente e transição concluída usam mensagens visíveis no console.

## [0.1.0-alpha.27] - 2026-07-21

### Corrigido

- A sala ocupada no início é apenas registrada; ela não dispara uma segunda mensagem depois da abertura.
- O rastreamento compara a sala anterior de cada token com a sala atual e só narra uma entrada real.
- A lista de Notes da própria Scene é usada quando os marcadores do canvas ainda não foram renderizados.
- Mudanças iniciadas por jogadores continuam sendo processadas no cliente do GM.
- Falhas temporárias podem ser tentadas novamente após novo movimento do token.

### Adicionado

- Deduplicação de mensagens por sessão e sala.
- Bloqueio de requisições simultâneas para a mesma sala.
- Aviso visível quando a sala é detectada, mas o read-aloud correspondente não é encontrado.
- Testes unitários do estado de transição por token.

### Manutenção

- O endpoint `/health` passa a ler a versão diretamente do `package.json`.

## [0.1.0-alpha.26] - 2026-07-21

### Segurança

- `fast-uri` vulnerável é substituído pela versão corrigida `3.1.4` nas cadeias do AJV.
- O override é restrito às dependências que usam a linha 3.x, preservando a linha 4.x usada pelo serializador do Fastify.
- `npm audit` volta a encerrar sem vulnerabilidades conhecidas.
- A auditoria de dependências passa a fazer parte obrigatória de `npm run check` e da CI.

## [0.1.0-alpha.25] - 2026-07-21

### Corrigido

- Extração read-aloud compatível com as classes antiga e atual do Plutonium/5eTools.
- Suporte seguro a `blockquote` HTML e citações Markdown, sem usar o restante da página.
- A abertura encontra a primeira área numerada quando os Journals estão separados dentro da pasta da cena.
- A transição correlaciona o número tanto com o nome da página quanto com o nome do Journal.
- O número do marcador também é lido do texto renderizado pelo Foundry, cobrindo Notes cujo documento não possui `label` próprio.
- Journals de outras aventuras deixam de competir quando existe uma pasta relacionada à cena ativa.

### Segurança

- Blocos secretos, ocultos ou marcados como exclusivos do GM são descartados pelo extrator.

## [0.1.0-alpha.24] - 2026-07-21

### Alterado

- Transições passam a usar exclusivamente o número da sala como chave de correlação.
- O Journal é escolhido pela relação com o nome da cena e pela seção numerada encontrada em suas páginas.
- O vínculo individual do marcador com página ou Journal não participa mais da busca.
- O fallback para o primeiro read-aloud foi removido das transições para impedir a narração da sala errada.

## [0.1.0-alpha.23] - 2026-07-21

### Corrigido

- Sessão ativa é recuperada automaticamente ao recarregar o Foundry.
- Salas amplas usam a Note numerada mais próxima quando o token não toca o ícone.
- Distância máxima de detecção passa a acompanhar a escala da grade.
- Logs de verificação de transição ficam visíveis no nível padrão do console.

## [0.1.0-alpha.22] - 2026-07-21

### Corrigido

- Geometria de Notes passa a considerar `x/y` como centro do ícone no Foundry.
- Área mínima de detecção ampliada para duas células, cobrindo a entrada da sala.
- O cliente do GM agora processa movimentos iniciados pelos jogadores.
- Detecção também é reagendada em `canvasReady` e `updateNote`.
- CORS permite Foundry em endereços privados de rede local na porta `30000`.
- Logs indicam quantidade de tokens, Notes e ausência de read-aloud correspondente.

## [0.1.0-alpha.21] - 2026-07-21

### Corrigido

- O botão de início consulta o status do Engine antes de abrir uma sessão.
- Sessões já ativas são reconectadas sem nova chamada a `/v1/session/start` e sem abertura duplicada.
- O rastreamento de salas e ações volta a ser ativado após atualizar o navegador ou recarregar o módulo.

## [0.1.0-alpha.20] - 2026-07-21

### Corrigido

- CORS agora permite por padrão o Foundry local em `localhost:30000` e `127.0.0.1:30000`.
- O preflight de `/v1/session/start`, `/room-entry` e `/action` volta a receber o cabeçalho de origem permitido.

## [0.1.0-alpha.19] - 2026-07-21

### Adicionado

- Captura automática de ações enviadas por jogadores no chat do Foundry.
- Verificação da sessão ativa e proteção contra flood de requisições.
- Classificação de intenções sociais, combate, investigação, movimento e ações gerais.
- Extração de alvos e nível de confiança da classificação.
- Resolução básica de dificuldade, efeito e relacionamento com NPCs.
- Cinco testes de resolução em `test/action-resolution.test.js`.

### Alterado

- Prompt de resolução passou a usar atores presentes, alvo, regras e disposição do NPC.
- Módulo usa o evento de mensagem criada para capturar com segurança mensagens enviadas pelos clientes dos jogadores.

## [0.1.0-alpha.18] - 2026-07-21

### Adicionado

- Detecção automática de entrada de tokens em Notes de salas.
- Correlação de Notes com páginas de Journal por número, nome ou conteúdo.
- Endpoint `POST /v1/session/room-entry`.
- Narração curta de salas com SafetyGuard, QualityGuard e NoveltyGuard.
- Histórico independente por combinação de cena e sala.
- Reprodução TTS local e transmissão por socket nas transições.
- Cinco cenários automatizados em `test/room-entry.test.js`.

### Alterado

- `NarrationQualityGuard` agora permite configurar encerramento, quantidade mínima de parágrafos e limite mínimo crítico por contexto.
- Engine e módulo Foundry atualizados para a versão alpha.18.

## [0.1.0-alpha.17] - 2026-07-21

### Adicionado

- Configuração centralizada e validada.
- Testes da configuração operacional.
- CI para Node.js 20, 22 e 24.
- Dependabot para npm e GitHub Actions.
- Templates de issues e pull requests.
- Guias de segurança e contribuição.

### Alterado

- CORS passou a aceitar apenas origens configuradas.
- API passou a validar ações e limitar entradas.
- Tratamento de erros passou a ocultar detalhes internos em produção.
- Servidor passou a realizar encerramento controlado.

### Segurança

- Arquivos sensíveis, dependências instaladas e dados gerados foram excluídos da distribuição.
