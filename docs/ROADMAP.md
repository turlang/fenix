# Roadmap mínimo e obrigatório

## Marco 1 — Início de sessão ✅
- [x] sincronização automática;
- [x] cena ativa obrigatória;
- [x] Journal explicitamente vinculado;
- [x] abertura narrativa baseada apenas na cena;
- [x] publicação automática no chat;
- [x] reprodução TTS local e transmissão para os clientes conectados.

## Marco 2 — Rodada fora de combate ✅ — alpha.37
- [x] coleta de uma declaração por personagem;
- [x] substituição segura da declaração do mesmo personagem;
- [x] botão Resolver rodada com contador;
- [x] Action Interpreter;
- [x] Rules Adapter consultivo do sistema ativo;
- [x] NPC Coordinator;
- [x] World State da sessão;
- [x] narração e áudio consolidados;
- [x] preservação da fila quando a resolução falha.

## Marco 2.1 — Entrada por voz ✅ — alpha.38
- [x] botão pressionar para falar no chat;
- [x] reconhecimento nativo `SpeechRecognition`/`webkitSpeechRecognition`;
- [x] transcrição parcial em tempo real;
- [x] identificação do token ou personagem vinculado;
- [x] envio automático para a fila da rodada;
- [x] modo de revisão no campo do chat;
- [x] sincronização do estado da sessão entre GM e jogadores;
- [x] interrupção do TTS durante a escuta;
- [x] tratamento de permissão, microfone, idioma, rede e navegador incompatível.

## Marco 3 — Memória ✅ — alpha.39
- [x] fatos persistentes por campanha;
- [x] estado e localização dos NPCs;
- [x] relações sociais por personagem e NPC;
- [x] missões e itens com status e responsáveis;
- [x] recuperação do World State e da numeração após reinício;
- [x] gravação atômica e deduplicação por evento;
- [x] painel do mestre no Foundry;
- [x] API de consulta, atualização e remoção;
- [x] proteção de registros secretos contra vazamento na narração.

## Marco 4 — Combate ✅ — alpha.40
- [x] integração automática com o Combat Tracker;
- [x] sincronização de combate, rodada, turno e combatente ativo;
- [x] economia separada de ação, ação bônus, reação, movimento e ação livre;
- [x] substituição segura de eventos do mesmo tipo antes da resolução;
- [x] uma reação por personagem em cada rodada;
- [x] leitura conservadora de rolagens confirmadas pelo Foundry;
- [x] narração breve e idempotente por turno;
- [x] resumo cinematográfico da rodada;
- [x] resolução automática ao avançar a iniciativa, com controles manuais do mestre;
- [x] registro dos turnos e resumos na memória persistente.

## Marco 5 — Biblioteca semântica de aventuras ✅ — alpha.41
- [x] importação de TXT, Markdown, HTML, DOCX e PDF;
- [x] extração DOCX sem dependência externa;
- [x] `pdftotext` com fallback para PDFs textuais;
- [x] persistência e isolamento por campanha;
- [x] deduplicação por SHA-256;
- [x] divisão por seções e busca por relevância;
- [x] modos `REFERENCE_ONLY`, `READ_ALOUD_ONLY` e `PLAYER_SAFE`;
- [x] bloqueio conservador de segredos, armadilhas, soluções e estatísticas;
- [x] painel de importação e consulta no Foundry;
- [x] recuperação segura em rodadas, salas e combate.

## Marco 6 — Provedores resilientes ✅ — alpha.42
- [x] Groq, OpenAI, Anthropic e endpoint OpenAI-compatible;
- [x] ordem configurável de prioridade;
- [x] fallback automático por operação narrativa;
- [x] circuit breaker `CLOSED`, `OPEN` e `HALF_OPEN`;
- [x] cooldown e limite de falhas configuráveis;
- [x] métricas sanitizadas de saúde e latência;
- [x] painel do mestre no Foundry;
- [x] endpoints de consulta e rearme manual;
- [x] preservação dos eventos quando todos os provedores falham.

## Marco 7 — Voz neural e perfis avançados de NPC ✅ — alpha.43
- [x] OpenAI TTS, ElevenLabs e endpoint OpenAI-compatible;
- [x] perfis persistentes e isolados por campanha;
- [x] perfil do narrador e perfil individual por NPC;
- [x] idioma, modelo, voice ID, velocidade e direção vocal;
- [x] estabilidade, similaridade, expressividade e speaker boost quando suportados;
- [x] seleção automática da voz do NPC no turno de combate;
- [x] cache e deduplicação de sínteses simultâneas;
- [x] fallback opcional para SpeechSynthesis;
- [x] painel do mestre no Foundry e prévia de voz;
- [x] credenciais restritas à API e aviso de voz gerada por IA.

## Marco 8 — Geradores persistentes ✅ — alpha.44
- [x] gerador de aventuras completas em Markdown;
- [x] gerador de NPCs com personalidade, segredos, vínculos e direção vocal;
- [x] gerador de dungeons com áreas numeradas, fluxo, encontros, pistas e armadilhas;
- [x] arquivo persistente e isolado por campanha;
- [x] assinatura SHA-256 e comparação lexical contra todo o histórico;
- [x] novas tentativas automáticas quando a IA repete conteúdo;
- [x] serialização de gerações simultâneas para impedir duplicação por corrida;
- [x] ativação separada e segura pelo mestre;
- [x] aventuras e dungeons integradas à Biblioteca como `REFERENCE_ONLY`;
- [x] NPCs integrados à memória como registros `secret`;
- [x] painel Forja de conteúdo no chat e nos controles da cena;
- [x] fallback e circuit breaker aplicados às operações de geração.

## Marco 9 — Mapas automáticos e Scenes ✅ — alpha.45
- [x] geração a partir de dungeon arquivada ou descrição direta;
- [x] planejamento abstrato por IA com fallback procedural;
- [x] layout sem sobreposição e corredores ortogonais;
- [x] SVG vetorial com grade, temas e áreas numeradas;
- [x] paredes com aberturas, portas comuns, secretas e trancadas;
- [x] iluminação por área e ponto inicial do grupo;
- [x] painel Mapas e Scenes no Foundry;
- [x] criação de Scene, upload do SVG, Journal e Notes;
- [x] persistência, deduplicação e vínculo com a Scene criada;
- [x] isolamento de read-aloud e segredos do mestre.

## Marco 10 — Tutor de Ficha e Tutor de Mestre ✅ — alpha.46
- [x] Tutor de Ficha disponível para jogadores e mestres;
- [x] snapshot curado de atributos, perícias, recursos, classes, magias, itens e efeitos;
- [x] bloqueio de consulta a ficha não pertencente ao jogador;
- [x] respostas com confiança, fatos usados, alertas e próximos passos;
- [x] Tutor de Mestre exclusivo para GM;
- [x] contexto de cena, combate, grupo, memória e Biblioteca;
- [x] acesso controlado do mestre a referências `GM_ONLY`;
- [x] orientação consultiva sem alterações automáticas;
- [x] fallback determinístico quando não há provedor de IA;
- [x] fallback e circuit breaker aplicados às consultas;
- [x] histórico persistente, privado por usuário e isolado por campanha;
- [x] painel no chat e controle de cena para o mestre.

## Próximo marco liberado
- Marco 11 — automações assistidas e ações aprovadas pelo mestre.
