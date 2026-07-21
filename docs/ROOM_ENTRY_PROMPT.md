# Prompt: Sistema de Narração Automática de Salas — Mestre Orc Engine

## Objetivo
Implementar detecção automática de transição entre salas em dungeons do Foundry VTT, de modo que o narrador descreva automaticamente cada nova sala quando os personagens entram nela pela primeira vez na sessão.

---

## Escopo e arquitetura

### Problema atual
O motor só narra a cena ativa uma vez, no início da sessão (`/v1/session/start`). Em dungeons com múltiplas salas numeradas, o GM precisa narrar manualmente cada transição.

### Solução esperada
1. **Módulo Foundry** detecta quando um token de jogador entra em uma Note (sala numerada) no mapa.
2. Correlaciona a Note com uma página do Journal pelo número/nome.
3. Extrai o read-aloud canônico daquela sala.
4. Chama o endpoint `POST /v1/session/room-entry` no Engine.
5. Engine gera narração curta (1–2 parágrafos, 50–120 palavras) usando o mesmo pipeline de safety/quality/novelty.
6. Publica no chat e reproduz áudio (browser TTS + socket).

---

## Checklist de implementação

### 1) AI Provider — `packages/ai-provider/src/index.js`
- [x] Adicionar método `createRoomEntry(context)` na classe `NarrativeProvider` e na classe `GroqNarrativeProvider`
- [x] Criar prompt `roomEntryPrompt(context)` com as mesmas regras de abertura mas sem "O que vocês fazem?" final, foco na sala específica, atores presentes e âncora canônica da sala
- [x] Chamar Groq com `maxTokens: 400`, `temperature: 0.7`, `topP: 0.9`

### 2) Narration Service — `packages/narration-service/src/index.js`
- [x] Adicionar método `describeRoom(roomContext)` com loop de tentativas igual a `createOpening`
- [x] Usar `NarrationQualityGuard` com `requireDecisionEnding: false` (salas não terminam com pergunta)
- [x] Histórico separado por sala: `roomKey = "room:${sceneId}:${roomName}"`
- [x] Aplicar `evaluateOpeningSafety` contra o texto da sala (não da cena toda)
- [x] Registrar record no `narrationMemory` com `areaName = roomContext.room.name`

### 3) Session Director — `packages/session-director/src/index.js`
- [x] Adicionar método `describeRoom(roomContext)` que:
  - Reconstrói contexto combinando `this.session.context` com dados da sala
  - Chama `this.narrationService.describeRoom(context)`
  - Cria diretiva de áudio
  - Publica via `foundryPublisher.postNarration(opening)`

### 4) Session Runtime — `packages/session-runtime/src/index.js`
- [x] Expor `describeRoom(roomContext)` no objeto retornado

### 5) API Fastify — `apps/api/src/server.js`
- [x] Novo endpoint `POST /v1/session/room-entry` com schema:
  - `body.required: ['room', 'source']`
  - `room: { id: string, name: string }`
  - `source: { canonicalAnchor: boolean, text: string, type?: string, extractionMode?: string }`
  - `scene?: object`, `visibleActors?: array`, `campaign?: object`
- [x] Tratar erros com código `ROOM_ENTRY_FAILED`

### 6) Módulo Foundry — `apps/foundry-module/scripts/main.js`
- [x] Estado `roomNarrationState` com:
  - `active` (boolean)
  - `sessionId`
  - `narratedRooms` (Set de chaves `${sceneId}:${roomLabel}`)
  - `lastRoomCheck` (timestamp para debounce)
- [x] Funções auxiliares:
  - `noteBounds(note)` — extrai `x`, `y`, `width`, `height` da Note
  - `tokenCenterPixels(token)` — centro do token em pixels do mapa
  - `isTokenInsideNote(token, note)` — ponto dentro do retângulo
  - `extractNoteRoomLabel(note)` — nome da sala da Note
  - `normalizeLabel(value)` — normalização para comparação
  - `labelsRelated(left, right)` — comparação numérica ou por substring
  - `findJournalPageForNote(note, journal)` — encontra página do Journal correspondente
  - `visiblePlayerTokens()` — tokens de jogadores visíveis
- [x] `checkRoomTransitions()`:
  - Para cada token visível, encontra Note de sala por bounding box
  - Pula se sala já foi narrada (`narratedRooms`)
  - Busca Journal da cena e página correspondente
  - Extrai read-aloud estruturado ou direto
  - Monta snapshot com `room`, `source`, `visibleActors`
  - Chama `request('/v1/session/room-entry', { method: 'POST', body: JSON.stringify(snapshot) })`
  - Marca sala como narrada, publica chat message e áudio
- [x] `scheduleRoomCheck()` com debounce de 1000ms
- [x] `installRoomTracking()`:
  - Hook `updateToken` (apenas GM, ignore ações de outros usuários)
  - Hook `deleteToken`, `createToken`, `renderScene`, `onConflictResolution`
- [x] Modificar `startSession` para:
  - Chamar `resetRoomNarrationState()` após `collectSnapshot()`
  - Chamar `void checkRoomTransitions()` após publicar abertura

---

## Requisitos funcionais

### Detecção de sala
- Mapeia tokens via **bounding box** de Notes no mapa (não precisa de walls; usa geometria retangular)
- Hooks do Foundry: `updateToken`, `createToken`, `deleteToken`, `renderScene`, `onConflictResolution`
- Debounce: máximo 1 verificação por segundo

### Correlação Journal
- Label da Note (`Sala 7`, `7. Área da armadilha`) deve casar com página do Journal por:
  1. Número principal igual (`"7"`)
  2. Nome relacionado por `labelsRelated`
  3. Conteúdo da página contendo o label

### Narração de sala
- 1–2 parágrafos curtos (50–120 palavras)
- **Não** termina com "O que vocês fazem?"
- Reutiliza SafetyGuard (proíbe cópia da âncora, conteúdo de GM, padrões proibidos)
- Reutiliza QualityGuard (rejeita textos curtos demais, especulação, controle de personagem)
- Reutiliza NoveltyGuard (evita repetição entre salas)
- Histórico separado por `scene:room` (não mistura salas diferentes)

### Áudio
- Mesmo padrão da abertura: `publishNarrationAudio(result.audio, result.opening, scene.id)`
- Browser TTS + socket broadcast para jogadores

### Estado da sessão
- `SessionDirector.state` permanece `COLLECTING_ACTIONS` durante transição de sala
- A descrição de sala não interfere em ações de jogadores ou sessões existentes

---

## Restrições técnicas
- Nenhuma dependência externa nova (reutilizar jQuery/helpers existentes do módulo)
- Não versionar `.env`, `node_modules` ou `data/narration-history.json`
- Respeitar `AGENTS.md` (caminhos de comando em `.kilo/`, não `.kilocode/`)
- Testes em `node:test` (ESM), sem bibliotecas extras

---

## Validação
```bash
npm ci --ignore-scripts
npm test
npm run check
```

Os 35 testes existentes devem permanecer verdes, e `test/room-entry.test.js` deve ser adicionado/ajustado conforme os cenários abaixo.

---

## Cenários de teste

### `test/room-entry.test.js`
1. **Gera narração curta sem decisão final**
   - Mock `createRoomEntry` retorna texto de 80+ palavras
   - `describeRoom` retorna texto sem `O que vocês fazem?`
   - QualityGuard aceita (`hardSafe: true`)

2. **Rejeita cópia integral da âncora**
   - Mock retorna exatamente `roomContext.source.text`
   - Deve lançar `NARRATION_SAFETY_FAILED` (código correto)

3. **QualityGuard aceita descrição de sala curta**
   - Texto de 20+ palavras, 1 parágrafo, sem decisão final
   - `requireDecisionEnding: false` deve permitir

4. **QualityGuard rejeita texto longo**
   - Texto com 200+ palavras
   - Deve falhar com `EXCESSIVE_LENGTH`

5. **Novelty separa histórico por sala**
   - Mesmo nome de sala em `scene-1` e `scene-2`
   - `memory.records` deve ter 2 entradas com `sceneKey` diferente

---

## Observações para o desenvolvedor
- O arquivo `apps/foundry-module/scripts/main.js` já contém toda a lógica de room tracking pronta; basta ativar os hooks corretamente
- O endpoint `/v1/session/room-entry` já existe em `apps/api/src/server.js`
- O método `describeRoom` já existe em `packages/session-runtime/src/index.js` e `packages/session-director/src/index.js`
- Ações futuras: se quiser suportar salas cheias com múltiplos tokens visíveis, troque o `break` no loop de `checkRoomTransitions` por contagem de maioria
- Em produção, talvez queira logar cada transição de sala para debug (`logger.info?.(...)`)

---

## Critérios de aceite
- [ ] Ao mover um token de jogador para dentro de uma Note em dungeon, a sala é narrada automaticamente uma vez por sessão
- [ ] Narração não repete entre sessões (guarded por NoveltyGuard)
- [ ] Narração não vaza conteúdo secreto do Journal (SafetyGuard)
- [ ] Áudio é reproduzido localmente e transmitido via socket
- [ ] Não interfere em sessão em andamento ou ações de jogadores
- [ ] 35 testes existentes continuam verdes
