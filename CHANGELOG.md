# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico.

## [Não publicado]

Nenhuma alteração registrada após o hotfix RC.2.

## [1.0.0-rc.2] - 2026-08-03

### Corrigido

- A Central de Diagnóstico não exibe mais o erro bruto `Route POST ... not found` quando o módulo está conectado a um Engine antigo.
- O painel tenta automaticamente a rota de diagnóstico compatível por `GET` antes de interromper a operação.
- A exportação do relatório possui fallback local quando o endpoint de exportação ainda não existe no Engine conectado.
- O módulo verifica a versão do Engine ao iniciar e alerta o mestre quando Engine e módulo estão desencontrados.
- O relatório de diagnóstico passou a incluir uma verificação explícita de compatibilidade entre as versões.

### Observação de instalação

- Engine e módulo Foundry devem ser atualizados juntos. Depois da atualização, o processo antigo da API precisa ser encerrado e iniciado novamente.

## [1.0.0-rc.1] - 2026-08-03

### Adicionado

- Gate de Release Candidate com relatório JSON assinado e verificações de versão, segredos, documentação, dependências e entrega.
- SBOM CycloneDX gerado a partir do `package-lock.json` e incluído na distribuição.
- Endpoint público `/v1/release/readiness` com estado do RC sem dados sensíveis.
- Documentação consolidada de arquitetura, privacidade, troubleshooting, limitações e checklist de release.
- Configurações do módulo para endereço da API, token local do navegador e logs de depuração.

### Segurança

- Engine passa a escutar somente em `127.0.0.1` por padrão.
- Binding de rede exige token com pelo menos 24 caracteres, salvo desativação explícita e consciente.
- Autenticação por Bearer ou `X-Mestre-Orc-Token`, CORS por allowlist, rate limit e cabeçalhos defensivos.
- Logs do Fastify redigem autorização, token, chaves e passphrases.
- `fastify` fica bloqueado em `5.10.0` e `fast-uri` em `3.1.4`.

### Alterado

- Logs detalhados do módulo ficam desativados por padrão e dependem da opção de diagnóstico.
- READMEs históricos das alphas 10–16 foram consolidados em `docs/archive/ALPHA-HISTORY.md`.
- A versão foi promovida de `0.1.0-alpha.52` para `1.0.0-rc.1`.

### Limitações

- A validação física no Foundry VTT 13 e no Windows permanece pendente no Marco 13 e bloqueia a versão estável.

## [0.1.0-alpha.52] - 2026-08-03

### Adicionado

- Serviço de migração versionada para todas as fontes persistentes do Engine.
- Inspeção, dry-run, aplicação, snapshots e rollback por linha de comando.
- Migração automática segura durante a inicialização da API.
- Instalador, atualizador e rollback em PowerShell para Windows.
- Verificador de instalação para Node.js, versões, módulo e diretório de dados.
- Empacotador ZIP puro em Node.js e artefatos separados para Engine, Foundry e bundle Windows.
- Manifesto de release, checksums SHA-256 e workflow de GitHub Release.

### Segurança

- Atualizações são preparadas fora da instalação ativa e preservam `.env` e `data/`.
- JSON persistente inválido interrompe a migração sem sobrescrever o arquivo.
- Toda migração com dados existentes cria snapshot anterior.
- Migrações, estado de schema e artefatos locais permanecem fora do Git e das entregas.

## [0.1.0-alpha.51] - 2026-08-03

### Adicionado

- `SessionSimulator` determinístico para executar sessões completas sem depender de um cliente Foundry real.
- Simulação de abertura, entrada em sala, rodadas simultâneas, combate, memória e automações aprovadas.
- Testes separados de integração, recuperação de falha transitória e carga concorrente.
- Métricas de p50, p95, p99, vazão, taxa de erro, crescimento de heap e duplicações bloqueadas.
- Relatórios JSON opcionais com assinatura SHA-256.
- Comandos `test:integration`, `test:session`, `test:load` e `test:all`.

### Alterado

- `check` e `check:offline` passam a executar a suíte unitária, integração, sessão automatizada e carga.
- CI passa a preservar relatórios de sessão e carga como artefatos no Node.js 22.

## [0.1.0-alpha.50] - 2026-08-03

### Adicionado

- Central Mestre Orc unificada com navegação por áreas e visão operacional da campanha.
- Barra compacta no chat com Central, áudio e entrada por voz.
- Um único controle do Mestre Orc na barra da Scene.
- Ações rápidas contextuais para sessão, rodadas, combate e diagnóstico.
- Interface específica para jogadores com voz, áudio e Tutor de Ficha.
- Design system responsivo, estados de foco e suporte a redução de movimento.

### Alterado

- Botões individuais de memória, biblioteca, forja, mapas, tutores, automações, backup, diagnóstico, IA e vozes deixam de ser injetados diretamente no chat.
- Controles antigos da Scene são consolidados em um único acesso, preservando todas as funções.

## [0.1.0-alpha.49] - 2026-08-03

### Adicionado

- `DiagnosticService` com verificações combinadas do Engine e do cliente Foundry.
- Central de Diagnóstico exclusiva para GM no chat e nos controles da cena.
- Testes de API, sessão, campanha, Scene, microfone, contexto seguro, Foundry 13, IA, TTS e armazenamento.
- Métricas de latência, operações, falhas, filas idempotentes e eventos duplicados bloqueados.
- Captura limitada de erros, rejeições não tratadas e perda de conexão no cliente GM.
- Relatório JSON exportável com SHA-256 e histórico recente sanitizado.
- Endpoints de consulta, execução completa, eventos do cliente e exportação.

### Segurança

- Campos com aparência de chave, autorização, cookie, token, senha, passphrase ou credencial são removidos em qualquer profundidade.
- Stacks completas, conteúdo de documentos e caminhos de arquivos não são exportados.
- Telemetria mantida somente em memória, limitada por `DIAGNOSTIC_MAX_EVENTS`.

### Alterado

- `SessionDirector` passa a expor operações, falhas, filas pendentes e contagem de eventos duplicados bloqueados.
- Marco 13 foi adiado por decisão de roadmap; o Marco 14 passa a ser a alpha.49.


## [0.1.0-alpha.48] - 2026-08-03

### Adicionado

- Serviço de backup isolado por `worldId`, cobrindo memória, biblioteca, geradores, mapas, perfis de voz, tutores, automações e histórico narrativo.
- Arquivos `.mobackup` compactados com Gzip e verificados por SHA-256.
- Criptografia opcional AES-256-GCM com chave derivada por `scrypt`, sem persistir a senha.
- Inspeção obrigatória antes da restauração, com token temporário de uso único e prévia das fontes.
- Modos `MERGE` e `REPLACE`, remapeação explícita entre campanhas e rollback transacional em caso de falha.
- Snapshot automático pré-restauração e retenção configurável por campanha.
- Painel **Backup da campanha** no chat e nos controles da cena do Foundry.

### Segurança

- Operações restritas a GM.
- Campos com aparência de chave, token, senha ou credencial são removidos da exportação.
- Arquivos adulterados, Base64 inválido, senha incorreta e backups de outra campanha são bloqueados antes de qualquer gravação.

## [0.1.0-alpha.47] - 2026-08-03

### Adicionado

- `AutomationService` persistente, isolado por `worldId` e com trilha de auditoria.
- Painel **Automações** exclusivo para GM no chat e nos controles da cena.
- Sugestões por IA com allowlist, sanitização de contexto e fallback para Journal de planejamento.
- Fluxo separado de criação, aprovação, claim de execução, resultado, claim de reversão e resultado da reversão.
- Executores locais para chat, Journal, página de Journal, Note de Scene e recurso numérico permitido da ficha.
- Recibos de execução para desfazer documentos criados e restaurar valores anteriores.
- Endpoints de definições, fila, detalhe, sugestão, aprovação, rejeição, execução e rollback.

### Segurança e confiabilidade

- Nenhuma proposta é executada pela IA ou pela API; a alteração ocorre somente no cliente Foundry de um GM após um segundo clique explícito.
- Tipos de ação e caminhos de recursos usam allowlist; scripts, ownership e propriedades arbitrárias são bloqueados.
- Alterações de ficha são classificadas como risco alto e recebem confirmação adicional.
- Revisão otimista evita decisões sobre uma versão desatualizada da proposta.
- Tokens temporários vinculam o resultado à execução ou reversão reclamada.
- A reversão valida a propriedade dos documentos criados e bloqueia restauração de recursos que receberam alterações posteriores.
- Trilhas de auditoria possuem limites por proposta e por campanha para evitar crescimento indefinido.
- Propostas pendentes idênticas são deduplicadas.
- Campos com aparência de credencial são removidos do contexto, auditoria e recibos.
- `data/automation-proposals.json` permanece fora do Git e das entregas limpas.

## [0.1.0-alpha.46] - 2026-08-02

### Adicionado

- `TutorService` persistente e isolado por `worldId`, com histórico privado em `data/tutor-history.json`.
- Tutor de Ficha com snapshot curado de atributos, perícias, recursos, classes, magias, itens e efeitos.
- Tutor de Mestre com contexto da cena, Combat Tracker, grupo, memória persistente e Biblioteca da aventura.
- Painel **Tutores** no chat para jogadores e mestres, além de controle da cena exclusivo para o GM.
- Respostas estruturadas com nível de confiança, fatos ou referências usados, alertas e próximos passos.
- Endpoints separados para Tutor de Ficha, Tutor de Mestre e histórico privado.
- Fallback determinístico quando nenhum provedor de IA está configurado.
- Operações específicas dos tutores no orquestrador resiliente de IA.

### Segurança e confiabilidade

- Jogadores só podem consultar fichas que possuem; o mestre pode consultar fichas visíveis.
- O snapshot remove campos com aparência de credencial e limita profundidade, quantidade e tamanho dos dados.
- O Tutor de Ficha não recebe memória secreta, Biblioteca ou dados de outros personagens.
- O Tutor de Mestre é exclusivo para GM e pode consultar referências `GM_ONLY` sem publicá-las automaticamente.
- Nenhum tutor altera fichas, Scenes, Journals, combate, memória ou outros documentos.
- Fontes citadas pela IA são filtradas contra IDs realmente fornecidos no contexto.
- Histórico de jogador é visível somente ao próprio usuário e ao mestre.
- `data/tutor-history.json` permanece fora do Git e das entregas limpas.


## [0.1.0-alpha.45] - 2026-08-02

### Adicionado

- `MapService` persistente e isolado por `worldId`, com arquivo atômico em `data/map-blueprints.json`.
- Geração de plantas a partir de uma dungeon da Forja ou de uma descrição direta do mestre.
- Planejamento por IA com fallback procedural seguro quando o provedor está indisponível ou retorna JSON inválido.
- Layout determinístico de salas sem sobreposição, corredores ortogonais, paredes, aberturas, portas, luzes, Notes e pontos de entrada.
- Renderização SVG vetorial com grade, temas visuais e numeração das áreas.
- Painel **Mapas e Scenes** no chat e nos controles da cena.
- Criação assistida de Scene com upload do SVG, grade, visão, paredes, portas, iluminação, Journal e Notes numeradas.
- Endpoints para gerar, listar, consultar, vincular Scene e excluir plantas.
- Fallback e circuit breaker dos provedores de IA aplicados também ao planejamento dos mapas.

### Alterado

- Dungeons arquivadas podem ser usadas como fonte estruturante de uma planta sem precisar ativá-las previamente.
- O `/health` passa a informar a persistência dos mapas e os estilos disponíveis.
- O gerador de IA passa a expor uma operação específica para plantas abstratas, separada da geração textual de dungeons.

### Segurança e confiabilidade

- A geração da planta e a criação da Scene são operações separadas e exigem confirmação do mestre.
- `readAloud` e `secret` são mantidos em campos distintos; segredos não aparecem na resposta resumida da API.
- Plantas equivalentes são bloqueadas por assinatura SHA-256.
- Gerações simultâneas da mesma campanha são serializadas.
- A exclusão da planta não remove Scene, Journal ou SVG já criados.
- `data/map-blueprints.json` permanece fora do Git e das entregas limpas.


## [0.1.0-alpha.44] - 2026-08-02

### Adicionado

- `GeneratorService` persistente para aventuras, NPCs e dungeons, isolado por `worldId`.
- Painel **Forja de conteúdo** no chat e nos controles da cena do Foundry.
- Arquivo automático de cada geração com título, resumo, tags, metadados, conteúdo Markdown, assinatura e número sequencial.
- Comparação local por SHA-256 e similaridade lexical contra todo o histórico do mesmo tipo.
- Novas tentativas automáticas quando a IA devolve conteúdo semelhante ao arquivo.
- Ativação separada para integrar aventuras e dungeons à Biblioteca e NPCs à memória persistente.
- Endpoints para gerar, listar, consultar, ativar, arquivar e remover artefatos.
- Fallback e circuit breaker dos provedores de IA aplicados também aos geradores.

### Alterado

- Aventuras e dungeons ativadas entram na Biblioteca em `REFERENCE_ONLY`.
- NPCs ativados entram na memória como registros secretos e estado `GENERATED`.
- O `/health` passa a informar persistência e tipos disponíveis na Forja.
- Prompts de geração exigem conteúdo original e JSON estruturado, sem copiar material publicado.

### Segurança e confiabilidade

- Nenhum resultado repetitivo é salvo quando todas as tentativas excedem o limite de similaridade.
- Geração e ativação são operações distintas para impedir que conteúdo não revisado altere a campanha.
- `data/generated-content.json` permanece fora do Git e das entregas limpas.
- Exclusão na Forja não remove automaticamente integrações já ativadas, evitando perda acidental de memória ou documentos.

## [0.1.0-alpha.43] - 2026-08-02

### Adicionado

- `NeuralVoiceService` com suporte a OpenAI TTS, ElevenLabs e endpoints OpenAI-compatible.
- `VoiceProfileService` persistente e isolado por `worldId`, com perfil do narrador e perfis individuais de NPC.
- Configurações de idioma, modelo, voice ID, velocidade, direção vocal, estabilidade, similaridade, expressividade e speaker boost.
- Endpoints de saúde, síntese e CRUD de perfis de voz.
- Painel **Vozes dos NPCs** no chat e nos controles da cena, com edição e prévia.
- Seleção automática do perfil de NPC ao narrar o turno de um combatente NPC.
- Cache de áudio e deduplicação de requisições simultâneas para evitar sínteses pagas repetidas.

### Alterado

- As diretivas de áudio passam a aceitar `browser-tts`, `neural-auto` e `neural-only`.
- O áudio neural é gerado pela API, transmitido sem credenciais e reproduzido como `Blob` no Foundry.
- O fallback para voz local pode ser permitido ou bloqueado em cada perfil.
- O `/health` passa a informar a configuração sanitizada da voz neural.

### Segurança e confiabilidade

- Chaves de OpenAI, ElevenLabs e endpoints compatíveis nunca são enviadas ao Foundry.
- Respostas de erro são sanitizadas antes de chegar ao cliente.
- O módulo não cria nem clona vozes; somente referencia vozes já disponíveis no provedor.
- O painel informa que a voz neural é gerada por inteligência artificial.
- Arquivos persistentes de perfis permanecem fora do Git e das entregas limpas.

## [0.1.0-alpha.42] - 2026-08-02

### Adicionado

- Orquestrador de múltiplos provedores com ordem configurável e fallback automático.
- Suporte nativo a Groq, OpenAI Responses API, Anthropic Messages API e endpoints OpenAI-compatible.
- Circuit breaker independente por provedor com estados `CLOSED`, `OPEN` e `HALF_OPEN`.
- Métricas de requisições, sucessos, falhas, fallbacks, latência e horários de recuperação.
- Endpoints `GET /v1/ai/providers` e `POST /v1/ai/providers/:providerId/reset`.
- Painel **Saúde da IA** no chat e nos controles da cena do Foundry.
- Configurações de timeout, limite de falhas, cooldown e prioridade no `.env.example`.

### Alterado

- O `/health` passa a informar o estado sanitizado de todos os provedores configurados.
- A Groq passa a usar o mesmo contrato de transporte resiliente aplicado aos demais provedores.
- Provedores configurados e omitidos da ordem explícita são anexados ao final como fallback.

### Segurança e confiabilidade

- Erros públicos e métricas nunca incluem chaves ou mensagens brutas potencialmente sensíveis.
- Falhas permanentes de autenticação ou configuração abrem o circuito imediatamente.
- Falhas temporárias preservam a operação por meio dos provedores seguintes.
- Quando todos os provedores falham, a API retorna `AI_PROVIDERS_UNAVAILABLE` e mantém os eventos pendentes para nova tentativa.

## [0.1.0-alpha.41] - 2026-08-02

### Adicionado

- `AdventureLibrary` persistente e isolada por `worldId` da campanha.
- Importação de TXT, Markdown, HTML, DOCX e PDF com limite de 12 MB.
- Extrator DOCX nativo e suporte a `pdftotext`, com fallback para PDFs textuais simples.
- Divisão por seções, indexação local, busca por relevância e deduplicação por SHA-256.
- Modos `REFERENCE_ONLY`, `READ_ALOUD_ONLY` e `PLAYER_SAFE`.
- Painel **Biblioteca da aventura** no chat e nos controles da cena.
- Endpoints de listagem, importação, busca, alteração de modo e remoção.
- Recuperação de referências seguras para rodadas, turnos, resumos de combate e entradas de sala.

### Alterado

- Prompts narrativos podem receber um conjunto curto de referências importadas relevantes e liberadas.
- O status da sessão informa o resumo da biblioteca carregada.
- O `/health` informa formatos suportados e persistência da biblioteca.

### Segurança e confiabilidade

- O modo padrão nunca envia conteúdo importado à IA.
- Seções identificadas como segredo, solução, armadilha, estatísticas, tesouro ou notas do mestre permanecem reservadas mesmo em documentos liberados.
- Somente trechos `PLAYER_SAFE` entram no contexto narrativo, com limite de quantidade e caracteres.
- A proteção contra cópia também compara a narração de sala com as referências importadas utilizadas.
- Arquivos originais não são mantidos; apenas texto extraído, metadados e trechos indexados são persistidos.
- A biblioteca local é removida automaticamente das entregas limpas.

## [0.1.0-alpha.40] - 2026-08-02

### Adicionado

- `CombatService` independente para sincronizar combate, rodada, turno, combatente ativo e economia de ações.
- Integração do módulo Foundry com os hooks `combatStart`, `updateCombat`, criação/remoção de combatentes e encerramento do combate.
- Registro separado de ação, ação bônus, reação, movimento e ação livre, com substituição segura por slot.
- Limite de uma reação por personagem em cada rodada.
- Extração conservadora de item, alvos e rolagens confirmadas de mensagens do Foundry e cards do D&D 5e.
- Narração breve por turno e resumo cinematográfico da rodada, ambos com áudio e idempotência.
- Botões manuais **Narrar turno** e **Resumo da rodada de combate** no chat e nos controles da cena.
- Opções para narrar automaticamente ao avançar a iniciativa e resumir automaticamente na mudança de rodada.
- Endpoints de sincronização, ação, resolução de turno, resumo de rodada e encerramento do combate.
- Persistência de eventos e resumos de combate na memória da campanha.
- Testes para economia de ações, reações, referência de turno, rolagens e integração completa do runtime.

### Alterado

- Rodadas fora de combate ficam bloqueadas enquanto o Combat Tracker está ativo.
- Eventos mecânicos confirmados pelo Foundry são preservados no contexto de regras; resultados não confirmados permanecem consultivos.
- A ordem narrativa do turno passa a ser determinística: movimento, ação, ação bônus, ação livre e reação.

### Segurança e confiabilidade

- A API rejeita ações de outro combate ou de um turno que não seja o atual.
- Ações comuns só podem pertencer ao combatente ativo; reações são anexadas ao turno corrente sem alterar a iniciativa.
- Falhas de IA ou publicação não marcam o turno como resolvido e preservam seus eventos para nova tentativa.
- O módulo não aplica dano, condições ou consumo de recursos automaticamente e não inventa resultados ausentes.

## [0.1.0-alpha.39] - 2026-08-02

### Adicionado

- Memória persistente por campanha para fatos, NPCs, relações, missões, itens e `World State`.
- Gravação atômica em `data/campaign-memory.json`, isolada pelo `worldId` do Foundry.
- Recuperação do estado e continuação da numeração das rodadas após reiniciar a API.
- Deduplicação de atualizações por `eventId`.
- Registro automático de fatos de rodada, reações e localização de NPCs.
- Detecção conservadora de declarações explícitas sobre início/conclusão de missões e aquisição/remoção de itens.
- Endpoints para consultar, atualizar e remover registros da memória.
- Painel **Memória da campanha** no chat e nos controles da cena do mestre.
- Testes de persistência em arquivo, isolamento de segredos, recuperação após reinício e integração da API.

### Alterado

- A narração consolidada recebe fatos conhecidos, estados de NPCs, relações, missões ativas e itens relevantes para manter continuidade.
- O `WorldStateService` pode ser restaurado a partir da memória persistente.
- O processo de entrega remove qualquer arquivo JSON local da pasta `data/`.

### Segurança e confiabilidade

- Registros marcados como `secret` não são enviados ao contexto narrativo.
- Arquivos de memória permanecem fora do Git e das entregas limpas.
- Operações de escrita são serializadas para evitar corrupção por gravações concorrentes.

## [0.1.0-alpha.38] - 2026-08-02

### Adicionado

- Botão **Falar ação** disponível no chat para jogadores e mestre.
- Reconhecimento de voz nativo com suporte a `SpeechRecognition` e `webkitSpeechRecognition`.
- Transcrição parcial visível durante a fala e normalização do texto final.
- Idioma de reconhecimento configurável, com `pt-BR` como padrão.
- Opção para enviar automaticamente ou inserir a transcrição no campo do chat para revisão.
- Sincronização por socket do estado da sessão entre o cliente do GM e os jogadores.
- Testes unitários do controlador de voz e testes de integração com o pipeline do chat.

### Alterado

- O TTS é interrompido quando o microfone começa a escutar, evitando que a narração seja capturada como ação.
- Mensagens de voz usam o personagem ou token controlado como `speaker` e entram pela mesma fila segura das mensagens digitadas.
- Mensagens manuais do GM continuam ignoradas, mas ações de voz do GM vinculadas a um personagem são aceitas.

### Segurança e confiabilidade

- A captura só inicia durante uma sessão ativa e exige personagem próprio ou token controlado.
- Estados de início, escuta, transcrição e envio impedem capturas simultâneas ou envios duplicados.
- Erros de permissão, ausência de microfone, rede, idioma e falta de fala produzem mensagens específicas sem quebrar o chat textual.

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
