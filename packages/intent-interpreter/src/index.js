export class IntentInterpreter {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async interpret({ content = '', actorId = null } = {}) {
    try {
      const text = String(content).trim();
      if (!text) throw new Error('Ação vazia.');
      const lower = text.toLowerCase();
      let type = 'GENERAL';
      if (/\?|\b(?:pergunto|digo|falo|respondo|pergunta)\b/i.test(lower)) type = 'SOCIAL';
      else if (/\b(?:ataco|golpeio|disparo|conjuro|magia|ataque|golpe|tiro)\b/i.test(lower)) type = 'COMBAT';
      else if (/\b(?:examino|procuro|investigo|observo|escuto|cheiro|abro|toco|leio)\b/i.test(lower)) type = 'INVESTIGATION';
      else if (/\b(?:ando|corro|pulo|me escondo|defendo|me movo|nado|escalo)\b/i.test(lower)) type = 'MOVEMENT';

      const directObject = text.match(/\b(?:ataco|golpeio|examino|procuro|investigo|observo|escuto|abro|toco|leio)\s+(?:o|a|os|as|um|uma)?\s*([\p{L}][\p{L}'’-]*)/iu);
      const prepositional = text.match(/(?:ao|à|para|no|na|do|da|em|com)\s+(?:o|a|os|as|um|uma)?\s*([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)?)/iu);
      const target = (directObject?.[1] ?? prepositional?.[1] ?? null)?.trim() ?? null;
      return { actorId, type, target, content: text, confidence: type === 'GENERAL' ? 0.5 : 0.8 };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Intent] falha', { message: error.message });
      throw error;
    }
  }
}
