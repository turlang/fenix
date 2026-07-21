export class FoundryPublisher {
  constructor({ publishChat, logger = console } = {}) {
    this.publishChat = publishChat;
    this.logger = logger;
  }
  async postNarration(content) {
    try {
      if (!content || typeof content !== 'string') throw new TypeError('Narração inválida.');
      if (this.publishChat) return await this.publishChat(content);
      this.logger.info?.('[Mestre Orc][Publisher] narração pronta', { characters: content.length });
      return { published: false, content };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Publisher] falha', { message: error.message });
      throw error;
    }
  }
}
