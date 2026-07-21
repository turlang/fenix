export class IntentInterpreter {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async interpret({ content = '', actorId = null } = {}) {
    try {
      const text = String(content).trim();
      if (!text) throw new Error('Ação vazia.');
      const lower = text.toLowerCase();
      const type = /\?|pergunto|digo|falo|respondo/.test(lower) ? 'SOCIAL' :
        /ataco|golpeio|disparo|conjuro/.test(lower) ? 'COMBAT' :
        /examino|procuro|investigo|observo|escuto/.test(lower) ? 'INVESTIGATION' : 'GENERAL';
      return { actorId, type, content: text };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Intent] falha', { message: error.message });
      throw error;
    }
  }
}
