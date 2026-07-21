# Prompt: Sistema de Resolução de Ações dos Jogadores — Mestre Orc Engine

## Objetivo
Implementar o fluxo completo de ações dos jogadores, desde a captura no chat do Foundry até a narração final no chat + áudio, substituindo os stubs atuais por implementações funcionais.

---

## Estado atual
- Abertura de sessão e transições de sala funcionam
- Endpoint `/v1/session/action` existe mas `intent-interpreter`, `rules-service` e `relationship-service` são stubs
- O módulo Foundry **ainda não captura** mensagens de chat dos jogadores para enviar ao Engine

---

## Fase 1 — Captura de ações no módulo Foundry

### Arquivo: `apps/foundry-module/scripts/main.js`

Implementar `installPlayerActionHook()` chamado no `init`:

```javascript
function installPlayerActionHook() {
  if (document.documentElement.dataset.mestreOrcActionHook === '1') return;
  document.documentElement.dataset.mestreOrcActionHook = '1';

  Hooks.on('chatMessage', (message, options) => {
    // Ignorar mensagens do GM, do sistema ou vazias
    if (!game.user?.isGM) return;
    if (message.speaker?.alias === 'Mestre Orc') return;
    if (!message.content || message.content.trim().length < 2) return;

    // Usar request() existente para enviar ao engine
    request('/v1/session/action', {
      method: 'POST',
      body: JSON.stringify({
        content: message.content,
        actorId: message.speaker?.entity === 'Token' ? message.speaker?.id : null
      })
    }).then((result) => {
      // Publicar narração de resolução no chat + áudio
      if (result?.narration) {
        ChatMessage.create({
          speaker: { alias: 'Mestre Orc' },
          content: narrationHtml(result.narration)
        });
        publishNarrationAudio(
          result.audio,
          result.narration,
          game.scenes?.active?.id ?? null
        );
      }
    }).catch((error) => {
      console.error(`${MODULE_ID} | falha ao processar ação`, error);
    });
  });
}
```

**Regras de filtro:**
- GM deve estar em sessão ativa (`roomNarrationState.active === true`)
- Ignorar mensagens que começam com `/` (comandos do chat)
- Ignorar mensagens de sistema (`message.speaker.entity === 'User'` e `message.speaker.id === game.user.id` apenas se for GM narrando)
- Debounce: mínimo 500ms entre requisições para evitar flood

---

## Fase 2 — Implementar `IntentInterpreter`

### Arquivo: `packages/intent-interpreter/src/index.js`

Substituir stub por classificador básico de intenção:

```javascript
export class IntentInterpreter {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  async interpret({ content = '', actorId = null } = {}) {
    try {
      const text = String(content).trim();
      if (!text) throw new Error('Ação vazia.');

      const lower = text.toLowerCase();
      
      // Classificação por padrões regex
      let type = 'GENERAL';
      if (/\?|pergunto|digo|falo|respondo|pergunta/.test(lower)) {
        type = 'SOCIAL';
      } else if (/ataco|golpeio|disparo|conjuro|magia|ataque|golpe|tiro/.test(lower)) {
        type = 'COMBAT';
      } else if (/examino|procuro|investigo|observo|escuto|cheiro|abro|toco|leio/.test(lower)) {
        type = 'INVESTIGATION';
      } else if (/ando|corro|pulo|me escondo|ataco|defendo|me movo|nado|escalo/.test(lower)) {
        type = 'MOVEMENT';
      }

      // Extrair alvo se presente
      const targetMatch = text.match(/(?:ao|à|para|no|na|do|da|em|com)\s+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)?)/);
      
      return {
        actorId,
        type,
        target: targetMatch ? targetMatch[1] : null,
        content: text,
        confidence: type === 'GENERAL' ? 0.5 : 0.8
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Intent] falha', { message: error.message });
      throw error;
    }
  }
}
```

---

## Fase 3 — Implementar `RulesService`

### Arquivo: `packages/rules-service/src/index.js`

Substituir stub por resolvedor básico de regras:

```javascript
export class RulesService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  async resolve({ intent, context } = {}) {
    try {
      const { type, target, content } = intent ?? {};
      const scene = context?.scene;
      const actors = context?.visibleActors ?? [];

      // Resolver regras por tipo de intenção
      let result = {
        type: type ?? 'GENERAL',
        target: target ?? null,
        difficulty: 10,
        success: false,
        roll: null,
        effect: null
      };

      switch (type) {
        case 'COMBAT':
          result = {
            ...result,
            difficulty: 12,
            effect: target ? `Ataque contra ${target}` : 'Ataque livre'
          };
          break;

        case 'INVESTIGATION':
          result = {
            ...result,
            difficulty: 8,
            effect: `Investigar: ${target ?? 'área'}`
          };
          break;

        case 'SOCIAL':
          result = {
            ...result,
            difficulty: 10,
            effect: target ? `Interagir com ${target}` : 'Interação social'
          };
          break;

        case 'MOVEMENT':
          result = {
            ...result,
            difficulty: 5,
            effect: `Movimento: ${target ?? 'tranquilamente'}`
          };
          break;

        default:
          result = {
            ...result,
            difficulty: 10,
            effect: content?.slice(0, 100) ?? 'Ação geral'
          };
      }

      return {
        required: false,
        intentType: type,
        result,
        contextSceneId: scene?.id
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Rules] falha', { message: error.message });
      throw error;
    }
  }
}
```

---

## Fase 4 — Implementar `RelationshipService`

### Arquivo: `packages/relationship-service/src/index.js`

Substituir stub por resolvedor social:

```javascript
export class RelationshipService {
  constructor({ logger = console } = { }) {
    this.logger = logger;
  }

  async resolve({ intent, context } = { }) {
    try {
      const { type, target, content } = intent ?? {};
      
      // Se não for interação social, retornar neutro
      if (type !== 'SOCIAL' && type !== 'COMBAT') {
        return {
          npcId: null,
          disposition: 0,
          relationshipType: 'NEUTRAL',
          effect: null
        };
      }

      // Buscar NPC correspondente no contexto
      const npc = target 
        ? context?.visibleActors?.find((actor) => {
            const actorName = String(actor?.name ?? '').toLowerCase();
            const targetLower = String(target).toLowerCase();
            return actorName.includes(targetLower) || targetLower.includes(actorName);
          }) ?? null
        : null;

      // Determinar disposição baseada no tipo de ação
      let disposition = 0;
      let relationshipType = 'NEUTRAL';

      if (type === 'COMBAT' && npc) {
        disposition = -20;
        relationshipType = 'HOSTILE';
      } else if (type === 'SOCIAL' && npc) {
        disposition = 5;
        relationshipType = 'FRIENDLY';
      } else if (type === 'SOCIAL') {
        disposition = 2;
        relationshipType = 'NEUTRAL';
      }

      return {
        npcId: npc?.id ?? null,
        npcName: npc?.name ?? target,
        disposition,
        relationshipType,
        effect: relationshipType === 'HOSTILE' 
          ? 'Relação deteriorada' 
          : relationshipType === 'FRIENDLY'
            ? 'Relação melhorou'
            : 'Sem mudança significativa'
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Relationship] falha', { message: error.message });
      throw error;
    }
  }
}
```

---

## Fase 5 — Melhorar prompt de narração de resolução no AI Provider

### Arquivo: `packages/ai-provider/src/index.js`

Melhorar `narrateResolution` para usar dados de regras e relacionamento:

```javascript
async narrateResolution({ intent, rules, relationship, context }) {
  try {
    if (!this.provider?.narrateResolution) {
      throw createServiceError(
        'A Groq não está configurada para narrar a resolução da ação.',
        { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
      );
    }

    const actors = (context.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 6);
    const npcInfo = relationship?.npcName 
      ? `O NPC "${relationship.npcName}" está presente (disposição: ${relationship.disposition}).`
      : 'Nenhum NPC específico identificado.';

    const prompt = [
      'Você é o narrador de uma mesa de RPG. Narre as consequências da ação do jogador abaixo.',
      'Seja direto e cinematográfico. Não explique regras. Não faça rollbacks. Preserve a agência dos jogadores.',
      'Termine em um ponto claro de decisão ou resultado.',
      '',
      `Cena: ${context?.scene?.name ?? 'sem nome'}`,
      `Ação do personagem: ${intent?.content ?? 'ação não especificada'}`,
      `Tipo de ação: ${intent?.type ?? 'GENERAL'}`,
      `Atores presentes: ${actors.length ? actors.join(', ') : 'nenhum identificado'}`,
      npcInfo,
      '',
      `Resultado de regras: ${rules?.result?.effect ?? 'sem regra aplicada'}`
    ].join('\n');

    return this.#requestText(prompt, { 
      maxTokens: 500, 
      temperature: 0.65, 
      topP: 0.9 
    });
  } catch (error) {
    this.logger.error?.('[Mestre Orc][Narration] falha na resolução', { message: error.message });
    throw error;
  }
}
```

---

## Fase 6 — Adicionar endpoint de status de sessão no módulo Foundry

### Arquivo: `apps/foundry-module/scripts/main.js`

Adicionar verificação de sessão ativa antes de capturar ações:

```javascript
async function ensureSessionActive() {
  if (!roomNarrationState.active) return false;
  
  try {
    const status = await request('/v1/session/status');
    return status?.state === 'COLLECTING_ACTIONS';
  } catch {
    return false;
  }
}

// Modificar chatMessage hook para verificar sessão
Hooks.on('chatMessage', async (message, options) => {
  if (!game.user?.isGM) return;
  if (message.speaker?.alias === 'Mestre Orc') return;
  if (!message.content || message.content.trim().length < 2) return;
  if (!await ensureSessionActive()) return;
  
  // ... resto do código
});
```

---

## Checklist de implementação

### `packages/intent-interpreter/src/index.js`
- [ ] Adicionar classificação `MOVEMENT`
- [ ] Extrair alvo da ação via regex
- [ ] Retornar `confidence` baseado em tipo

### `packages/rules-service/src/index.js`
- [ ] Retornar estrutura rica com `difficulty`, `success`, `roll`, `effect`
- [ ] Resolver regras por tipo de intenção
- [ ] Incluir `contextSceneId`

### `packages/relationship-service/src/index.js`
- [ ] Retornar `npcName`, `disposition`, `relationshipType`, `effect`
- [ ] Resolver NPC por nome parcial no `context.visibleActors`
- [ ] Ajustar disposição baseada em COMBAT (-20) ou SOCIAL (+5)

### `packages/ai-provider/src/index.js`
- [ ] Melhorar prompt de `narrateResolution` com atores, NPC, resultado de regras
- [ ] Manter temperatura 0.65 para consistência

### `apps/foundry-module/scripts/main.js`
- [ ] Implementar `installPlayerActionHook()`
- [ ] Chamar no `init` ao lado de `installRoomTracking()`
- [ ] Filtar mensagens: GM apenas, não-Mestre Orc, não-comandos `/`
- [ ] Debounce de 500ms
- [ ] Verificar sessão ativa via `/v1/session/status`

---

## Cenários de teste para `test/action-resolution.test.js`

```javascript
test('IntentInterpreter classifica combate', async () => {
  const interpreter = new IntentInterpreter();
  const result = await interpreter.interpret({ content: 'Ataco o goblin com minha espada', actorId: 'actor-1' });
  assert.equal(result.type, 'COMBAT');
  assert.equal(result.target, 'goblin');
  assert.equal(result.confidence, 0.8);
});

test('IntentInterpreter classifica investigação', async () => {
  const interpreter = new IntentInterpreter();
  const result = await interpreter.interpret({ content: 'Examino a porta em busca de armadilhas' });
  assert.equal(result.type, 'INVESTIGATION');
});

test('RulesService retorna dificuldade por tipo', async () => {
  const service = new RulesService();
  const result = await service.resolve({ 
    intent: { type: 'COMBAT', target: 'goblin' }, 
    context: { scene: { id: 'scene-1' } }
  });
  assert.equal(result.result.difficulty, 12);
  assert.equal(result.result.effect, 'Ataque contra goblin');
});

test('RelationshipService ajusta disposição em combate', async () => {
  const service = new RelationshipService();
  const result = await service.resolve({
    intent: { type: 'COMBAT', target: 'goblin' },
    context: { 
      visibleActors: [{ id: 'npc-1', name: 'Goblin Chefão', type: 'npc' }] 
    }
  });
  assert.equal(result.disposition, -20);
  assert.equal(result.relationshipType, 'HOSTILE');
});

test('SessionDirector.processAction retorna narração', async () => {
  const narrator = { 
    async narrateResolution({ intent, rules, relationship, context }) {
      return `O ${intent.target} reage à ação de ${intent.content.split(' ')[0]}.`;
    }
  };
  const runtime = createSessionRuntime({ narrator });
  const session = await runtime.start(snapshot);
  const result = await runtime.processAction({ 
    content: 'Examino o baú', 
    actorId: 'actor-1' 
  });
  assert.ok(result.narration);
  assert.ok(result.intent.type);
});
```

---

## Critérios de aceite
- [ ] Mensagens de chat de jogadores são capturadas automaticamente pelo módulo Foundry
- [ ] Ação é enviada ao Engine via `/v1/session/action`
- [ ] `IntentInterpreter` classifica corretamente: SOCIAL, COMBAT, INVESTIGATION, MOVEMENT, GENERAL
- [ ] `RulesService` retorna dificuldade e efeito adequados por tipo
- [ ] `RelationshipService` ajusta disposição de NPCs对应
- [ ] Narração de resolução aparece no chat + áudio
- [ ] Filtros funcionam: ignora comandos `/`, mensagens de GM, mensagens do Mestre Orc
- [ ] 35 testes existentes continuam verdes
- [ ] Novos testes de resolução de ação passam

---

## Observações
- Manter temperatura baixa (0.65) para resoluções, pois são mais determinísticas que aberturas
- Não adicionar "O que vocês fazem?" no final de resoluções
- O endpoint `/v1/session/action` já existe e chama `director.processAction()`
- Os stubs em `intent-interpreter`, `rules-service` e `relationship-service` já estão no lugar; basta substituir as implementações
