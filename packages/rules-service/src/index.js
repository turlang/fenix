function normalizeSystemId(context = {}) {
  return String(context?.campaign?.systemId ?? context?.campaign?.system ?? 'generic').trim().toLowerCase() || 'generic';
}

function adapterFor(systemId) {
  if (systemId === 'dnd5e') {
    return {
      systemId: 'dnd5e',
      name: 'D&D 5e',
      mode: 'ADVISORY',
      automaticRolls: false
    };
  }
  return {
    systemId: systemId || 'generic',
    name: systemId && systemId !== 'generic' ? systemId : 'Sistema genérico',
    mode: 'GENERIC_ADVISORY',
    automaticRolls: false
  };
}

function mechanicsFor(type, systemId) {
  if (systemId !== 'dnd5e') {
    return {
      actionEconomy: type === 'MOVEMENT' ? 'movement' : 'action',
      check: type === 'MOVEMENT' ? null : 'system-check',
      ability: null,
      skill: null
    };
  }

  const mechanics = {
    COMBAT: { actionEconomy: 'action', check: 'attack-roll', ability: null, skill: null },
    INVESTIGATION: { actionEconomy: 'action', check: 'ability-check', ability: 'int', skill: 'inv' },
    SOCIAL: { actionEconomy: 'action', check: 'ability-check', ability: 'cha', skill: null },
    MOVEMENT: { actionEconomy: 'movement', check: null, ability: null, skill: null },
    GENERAL: { actionEconomy: 'action', check: 'ability-check', ability: null, skill: null }
  };
  return mechanics[type] ?? mechanics.GENERAL;
}

export class RulesService {
  constructor({ logger = console } = {}) { this.logger = logger; }

  async resolve({ intent, context } = {}) {
    try {
      const { type = 'GENERAL', target = null, content = '' } = intent ?? {};
      const systemId = normalizeSystemId(context);
      const adapter = adapterFor(systemId);
      const mechanics = mechanicsFor(type, systemId);
      const effects = {
        COMBAT: target ? `Ataque contra ${target}` : 'Ataque livre',
        INVESTIGATION: `Investigar: ${target ?? 'área'}`,
        SOCIAL: target ? `Interagir com ${target}` : 'Interação social',
        MOVEMENT: `Movimento: ${target ?? 'tranquilamente'}`,
        GENERAL: String(content).slice(0, 100) || 'Ação geral'
      };
      const difficulties = { COMBAT: 12, INVESTIGATION: 8, SOCIAL: 10, MOVEMENT: 5, GENERAL: 10 };
      return {
        required: false,
        intentType: type,
        adapter,
        mechanics,
        result: {
          type,
          target,
          difficulty: difficulties[type] ?? 10,
          success: false,
          roll: null,
          effect: effects[type] ?? effects.GENERAL,
          authoritative: false,
          pendingMasterDecision: Boolean(mechanics.check)
        },
        contextSceneId: context?.scene?.id ?? null
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Rules] falha', { message: error.message });
      throw error;
    }
  }
}
