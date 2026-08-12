export const objectBodySchema = {
  body: { type: 'object', additionalProperties: true }
};

export const actionSchema = {
  body: {
    type: 'object',
    required: ['content'],
    additionalProperties: true,
    properties: {
      campaignId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      sessionId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      commandId: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
      content: { type: 'string', minLength: 1, maxLength: 4000 },
      actorId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      messageId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }
    }
  }
};

export const roomEntrySchema = {
  body: {
    type: 'object',
    required: ['room', 'source'],
    additionalProperties: false,
    properties: {
      campaignId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      sessionId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      commandId: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
      room: {
        type: 'object',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          name: { type: 'string', minLength: 1, maxLength: 300 }
        }
      },
      source: {
        type: 'object',
        required: ['canonicalAnchor', 'text'],
        additionalProperties: false,
        properties: {
          canonicalAnchor: { type: 'boolean' },
          text: { type: 'string', minLength: 1, maxLength: 5000 },
          type: { type: 'string', maxLength: 100 },
          extractionMode: { type: 'string', maxLength: 100 }
        }
      },
      scene: { type: 'object', additionalProperties: true },
      visibleActors: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: true } },
      campaign: { type: 'object', additionalProperties: true }
    }
  }
};
