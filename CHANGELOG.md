# Changelog

Este projeto segue o formato do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento semântico durante a fase alfa.

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
