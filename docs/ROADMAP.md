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

## Marco 3 — Memória — próximo
- fatos persistentes;
- estado dos NPCs;
- relações sociais;
- missões e itens;
- recuperação após reinício.

## Marco 4 — Combate
- integração com Combat Tracker;
- resolução por turno;
- ações, bônus e reações;
- narração breve por turno e resumo da rodada.

## Fora de escopo até os marcos anteriores funcionarem
- importação semântica de PDF/DOCX;
- mapas automáticos;
- múltiplos provedores com fallback;
- geradores de aventuras/NPCs/dungeons;
- voz neural externa e perfis avançados de NPC.
