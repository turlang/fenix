const MODULE_NOTICE_PATTERNS = [
  /\bwelcome\s+to\s+plutonium\b/i,
  /\bfoundry\s+nor\s+forge\s+support\s+piracy\b/i,
  /\bplutonium\b[\s\S]*\bdiscord\b/i,
  /\bstreamer\s+mode\b/i,
  /^i\s+understand$/i
];

const AUTOMATED_CARD_PATTERNS = [
  /<\s*(button|form)\b/i,
  /\b(chat-card|item-card|dice-roll)\b/i,
  /\bdata-(?:action|document-id|uuid)\s*=/i
];

function hasRecipients(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? '').trim());
}

export function actionMessageRejectionReason(message, plainText = '') {
  if (!message) return 'MISSING_MESSAGE';
  if (hasRecipients(message.whisper) || message.blind === true) return 'PRIVATE_MESSAGE';
  if (message.roll || (Array.isArray(message.rolls) && message.rolls.length > 0)) return 'ROLL_MESSAGE';

  const rawContent = String(message.content ?? '');
  const normalizedText = String(plainText || rawContent).replace(/\s+/g, ' ').trim();
  const flagNamespaces = Object.keys(message.flags ?? {}).join(' ');
  if (/plutonium/i.test(flagNamespaces) || MODULE_NOTICE_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return 'MODULE_NOTICE';
  }
  if (AUTOMATED_CARD_PATTERNS.some((pattern) => pattern.test(rawContent))) return 'AUTOMATED_CARD';
  return null;
}

export function isSupportedPlayerChatStyle(message, chatStyles = {}) {
  const style = message?.style ?? message?.type;
  if (style == null) return true;
  const allowed = [chatStyles.OOC, chatStyles.IC, chatStyles.EMOTE].filter((value) => value != null);
  return allowed.length === 0 || allowed.includes(style);
}
