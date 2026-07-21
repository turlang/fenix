# Roadmap de Prompts Restantes — Mestre Orc Engine

## Status atual
- [x] Abertura de sessão (`/v1/session/start`)
- [x] Transição de salas (`/v1/session/room-entry`)
- [ ] Resolução de ações dos jogadores (`/v1/session/action`) **← PRÓXIMA FASE**
- [ ] Integração final e deploy

---

## Prompt 1 — Resolução de Ações dos Jogadores (JÁ CRIADO)

**Arquivo:** `docs/ACTION_RESOLUTION_PROMPT.md`  
**Status:** Prompt existe, implementação pendente

### O que falta implementar:

#### 1.1 Captura de ações no módulo Foundry
**Arquivo:** `apps/foundry-module/scripts/main.js`

Implementar `installPlayerActionHook()`:
- Hook `chatMessage` que intercepta mensagens de jogadores
- Filtros: GM apenas, ignorar `/comandos`, ignorar mensagens do Mestre Orc, ignorar sistema
- Debounce de 500ms
- Enviar ao endpoint `/v1/session/action`
- Publicar narração de resolução no chat + áudio

#### 1.2 IntentInterpreter
**Arquivo:** `packages/intent-interpreter/src/index.js`

Substituir stub por classificador:
- Classificar em SOCIAL, COMBAT, INVESTIGATION, MOVEMENT, GENERAL
- Extrair alvo via regex
- Retornar `confidence`

#### 1.3 RulesService
**Arquivo:** `packages/rules-service/src/index.js`

Substituir stub por resolvedor:
- Retornar `difficulty`, `success`, `roll`, `effect` por tipo
- Tipos: COMBAT (dificuldade 12), INVESTIGATION (8), SOCIAL (10), MOVEMENT (5)

#### 1.4 RelationshipService
**Arquivo:** `packages/relationship-service/src/index.js`

Substituir stub por resolvedor social:
- Retornar `npcName`, `disposition`, `relationshipType`, `effect`
- COMBAT: -20, HOSTILE
- SOCIAL: +5, FRIENDLY
- Neutro: 0

#### 1.5 Prompt de resolução no AI Provider
**Arquivo:** `packages/ai-provider/src/index.js`

Melhorar `narrateResolution`:
- Incluir atores presentes, NPC, resultado de regras
- Temperatura 0.65 (determinística)
- Sem "O que vocês fazem?" no final

#### 1.6 Endpoint de status no módulo Foundry
**Arquivo:** `apps/foundry-module/scripts/main.js`

Adicionar `ensureSessionActive()`:
- Verificar `/v1/session/status` antes de processar ação
- Retornar `false` se estado não for `COLLECTING_ACTIONS`

---

## Prompt 2 — Testes de Resolução de Ações (NÃO CRIADO)

**Arquivo:** `test/action-resolution.test.js`  
**Status:** Não existe

### Cenários necessários:

```javascript
test('IntentInterpreter classifica combate', async () => {
  const interpreter = new IntentInterpreter();
  const result = await interpreter.interpret({ content: 'Ataco o goblin com minha espada', actorId: 'actor-1' });
  assert.equal(result.type, 'COMBAT');
  assert.equal(result.target, 'goblin');
});

test('IntentInterpreter classifica investigação', async () => {
  const interpreter = new IntentInterpreter();
  const result = await interpreter.interpret({ content: 'Examino a porta em busca de armadilhas' });
  assert.equal(result.type, 'INVESTIGATION');
});

test('RulesService retorna dificuldade por tipo', async () => {
  const service = new RulesService();
  const result = await service.resolve({ intent: { type: 'COMBAT', target: 'goblin' }, context: { scene: { id: 'scene-1' } } });
  assert.equal(result.result.difficulty, 12);
});

test('RelationshipService ajusta disposição em combate', async () => {
  const service = new RelationshipService();
  const result = await service.resolve({
    intent: { type: 'COMBAT', target: 'goblin' },
    context: { visibleActors: [{ id: 'npc-1', name: 'Goblin Chefão', type: 'npc' }] }
  });
  assert.equal(result.disposition, -20);
  assert.equal(result.relationshipType, 'HOSTILE');
});

test('SessionDirector.processAction retorna narração', async () => {
  const narrator = { async narrateResolution({ intent }) { return `O ${intent.target} reage.`; } };
  const runtime = createSessionRuntime({ narrator });
  await runtime.start(snapshot);
  const result = await runtime.processAction({ content: 'Examino o baú', actorId: 'actor-1' });
  assert.ok(result.narration);
  assert.ok(result.intent.type);
});
```

---

## Prompt 3 — Integração Final e Validação (NÃO CRIADO)

**Arquivo:** `docs/INTEGRATION_PROMPT.md`  
**Status:** Não existe

### O que deve conter:

#### 3.1 Fluxo completo end-to-end
```
1. GM clica "Iniciar sessão" → abertura
2. Token entra na Sala 2 → narração de transição
3. Jogador digita "Examino o baú" → captura → interpretação → regras → narração de resolução
4. Todos os passos devem aparecer no chat + áudio
```

#### 3.2 Checklist de integração
- [ ] Módulo Foundry chama `/v1/session/start` no botão
- [ ] Módulo Foundry detecta transição de salas automaticamente
- [ ] Módulo Foundry captura ações de jogadores via chatMessage
- [ ] Engine processa ações e retorna narração
- [ ] Narração aparece no chat do Foundry
- [ ] Áudio é reproduzido localmente (GM) e transmitido (jogadores)
- [ ] Memória persiste narrações entre sessões
- [ ] Guards (safety/quality/novelty) bloqueiam conteúdo inadequado

#### 3.3 Validação obrigatória
```bash
npm ci --ignore-scripts
npm test                    # 35+ testes existentes + novos
npm run validate           # estrutura do projeto
npm run check              # validação completa
```

#### 3.4 Critérios de aceite final
- [ ] 35 testes existentes verdes
- [ ] 5+ testes de resolução de ação verdes
- [ ] 5+ testes de transição de sala verdes
- [ ] Nenhum `console.log` solto (apenas logger estruturado)
- [ ] Nenhuma dependência externa nova
- [ ] Documentação atualizada (README.md com novos endpoints)

#### 3.5 Deploy
```powershell
git init
git branch -M main
git add .
git commit -m "feat: sistema completo de narração automática com transição de salas e resolução de ações"
git remote add origin <URL_DO_REPOSITORIO>
git push -u origin main
```

---

## Resumo: o que está faltando

| # | Prompt | Status | Arquivo |
|---|--------|--------|---------|
| 1 | Resolução de ações | ✅ Prompt criado, ⏳ Implementação pendente | `docs/ACTION_RESOLUTION_PROMPT.md` |
| 2 | Testes de resolução | ❌ Não criado | `test/action-resolution.test.js` |
| 3 | Integração final e deploy | ❌ Não criado | `docs/INTEGRATION_PROMPT.md` |

---

## Ordem recomendada de implementação

1. **Prompt 1** — Implementar Fases 1-6 do `ACTION_RESOLUTION_PROMPT.md`
   - Começar pelo módulo Foundry (Fase 1)
   - Depois os 3 services stubs (Fases 2-4)
   - Depois o prompt AI (Fase 5)
   - Finalizar com status/hook (Fase 6)

2. **Prompt 2** — Criar `test/action-resolution.test.js`
   - Reutilizar padrão dos testes existentes
   - Mock simples do AI provider

3. **Prompt 3** — Criar `docs/INTEGRATION_PROMPT.md`
   - Consolidar todos os fluxos
   - Checklist final
   - Deploy
