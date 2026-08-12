export class FoundryPublisher {
  constructor({ publishChat, logger = console } = {}) {
    this.publishChat = publishChat;
    this.logger = logger;
  }

  async publishNarration(content, metadata = {}) {
    try {
      const normalized = String(content ?? '').trim();
      if (!normalized) throw new TypeError('Narração inválida.');
      if (this.publishChat) return await this.publishChat(normalized, metadata);
      this.logger.info?.('[Mestre Orc][FoundryPublisher] narração pronta', {
        characters: normalized.length,
        channel: metadata.channel ?? 'chat'
      });
      return { published: false, content: normalized };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][FoundryPublisher] falha', { message: error.message });
      throw error;
    }
  }

  // Compatibilidade com integrações anteriores à extração do Shared Core.
  async postNarration(content, metadata = {}) {
    return this.publishNarration(content, metadata);
  }
}
