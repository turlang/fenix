export class NarrationOutput {
  constructor({ publish = null, logger = console } = {}) {
    this.publish = publish;
    this.logger = logger;
  }

  async publishNarration(content, metadata = {}) {
    try {
      const normalized = String(content ?? '').trim();
      if (!normalized) throw new TypeError('Narração inválida.');
      if (typeof this.publish === 'function') {
        return await this.publish(normalized, metadata);
      }
      this.logger.info?.('[Fênix][NarrationOutput] narração pronta', {
        characters: normalized.length,
        channel: metadata.channel ?? 'default'
      });
      return { published: false, content: normalized };
    } catch (error) {
      this.logger.error?.('[Fênix][NarrationOutput] falha', { message: error.message });
      throw error;
    }
  }
}
