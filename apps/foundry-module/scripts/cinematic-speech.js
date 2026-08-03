const MARKER_ALIASES = new Map([
  ['sussurro', 'whisper'], ['sussurrando', 'whisper'], ['whisper', 'whisper'], ['whispers', 'whisper'],
  ['medo', 'fear'], ['assustado', 'fear'], ['assustada', 'fear'], ['fear', 'fear'],
  ['tenso', 'tense'], ['tensa', 'tense'], ['tensão', 'tense'], ['ansioso', 'tense'], ['ansiosa', 'tense'], ['nervoso', 'tense'], ['nervosa', 'tense'],
  ['hesitante', 'hesitant'], ['hesitação', 'hesitant'], ['hesitant', 'hesitant'],
  ['foco', 'focus'], ['atento', 'focus'], ['atenta', 'focus'], ['misterioso', 'focus'], ['misteriosa', 'focus'],
  ['calmo', 'calm'], ['calma', 'calm'], ['sereno', 'calm'], ['serena', 'calm'],
  ['alegre', 'cheerful'], ['caloroso', 'cheerful'], ['calorosa', 'cheerful'], ['cheerful', 'cheerful'],
  ['entusiasmado', 'excited'], ['entusiasmada', 'excited'], ['animado', 'excited'], ['animada', 'excited'], ['excited', 'excited'],
  ['bravo', 'angry'], ['brava', 'angry'], ['irritado', 'angry'], ['irritada', 'angry'], ['angry', 'angry'],
  ['grito', 'shout'], ['gritando', 'shout'], ['shout', 'shout'], ['shouts', 'shout'],
  ['risada', 'laugh'], ['rindo', 'laugh'], ['laugh', 'laugh'], ['laughs', 'laugh'],
  ['suspiro', 'sigh'], ['suspira', 'sigh'], ['sigh', 'sigh'], ['sighs', 'sigh'],
  ['pausa', 'pause'], ['pause', 'pause'],
  ['pausa curta', 'short-pause'], ['short pause', 'short-pause'],
  ['pausa longa', 'long-pause'], ['long pause', 'long-pause']
]);

const DELIVERY_PROFILES = Object.freeze({
  default: { rate: 1, pitch: 1, volume: 1 },
  whisper: { rate: 0.9, pitch: 0.96, volume: 0.84 },
  fear: { rate: 0.93, pitch: 1.01, volume: 0.9 },
  tense: { rate: 0.94, pitch: 0.98, volume: 0.96 },
  hesitant: { rate: 0.9, pitch: 0.99, volume: 0.92 },
  focus: { rate: 0.97, pitch: 1, volume: 0.98 },
  calm: { rate: 0.94, pitch: 0.98, volume: 0.94 },
  cheerful: { rate: 1.03, pitch: 1.03, volume: 1 },
  excited: { rate: 1.06, pitch: 1.05, volume: 1 },
  angry: { rate: 1.01, pitch: 0.97, volume: 1 },
  shout: { rate: 1.05, pitch: 1.04, volume: 1 },
  laugh: { rate: 1.03, pitch: 1.04, volume: 0.98 },
  sigh: { rate: 0.91, pitch: 0.97, volume: 0.88 }
});

const PAUSE_DURATIONS = Object.freeze({
  pause: 340,
  'short-pause': 190,
  'long-pause': 650,
  sigh: 260,
  laugh: 150
});

const ELEVENLABS_TAGS = Object.freeze({
  whisper: '[whispers]',
  fear: '[whispers]',
  tense: '[whispers]',
  hesitant: '[curious]',
  focus: '[curious]',
  calm: '',
  cheerful: '[excited]',
  excited: '[excited]',
  angry: '[shouts]',
  shout: '[shouts]',
  laugh: '[laughs]',
  sigh: '[sighs]',
  pause: '[pause]',
  'short-pause': '[short pause]',
  'long-pause': '[long pause]'
});

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function normalizeMarker(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveCinematicMarker(value) {
  const normalized = normalizeMarker(value);
  return MARKER_ALIASES.get(normalized) ?? null;
}

export function stripCinematicMarkers(value) {
  return String(value ?? '')
    .replace(/\[([^\]]{1,50})\]/g, (match, marker) => resolveCinematicMarker(marker) ? '' : match)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function normalizeCinematicScriptText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function deliveryFor(marker, base) {
  const profile = DELIVERY_PROFILES[marker] ?? DELIVERY_PROFILES.default;
  return {
    rate: clamp(base.rate * profile.rate, 0.5, 1.5, base.rate),
    pitch: clamp(base.pitch * profile.pitch, 0, 2, base.pitch),
    volume: clamp(base.volume * profile.volume, 0, 1, base.volume)
  };
}

export function naturalizeBrowserProsody(options = {}) {
  const enabled = options.enabled !== false;
  const requestedRate = clamp(options.rate, 0.5, 1.5, 0.96);
  const requestedPitch = clamp(options.pitch, 0, 2, 1);
  const requestedVolume = clamp(options.volume, 0, 1, 1);
  if (!enabled) return { rate: requestedRate, pitch: requestedPitch, volume: requestedVolume };
  return {
    rate: clamp(0.96 + ((requestedRate - 0.96) * 0.55), 0.78, 1.18, 0.96),
    pitch: clamp(1 + ((requestedPitch - 1) * 0.35), 0.9, 1.1, 1),
    volume: requestedVolume
  };
}

function appendPause(segments, duration, reason) {
  const milliseconds = Math.max(0, Math.round(Number(duration) || 0));
  if (!milliseconds) return;
  const previous = segments.at(-1);
  if (previous?.type === 'pause') {
    previous.duration = Math.max(previous.duration, milliseconds);
    previous.reason = previous.reason || reason;
    return;
  }
  segments.push({ type: 'pause', duration: milliseconds, reason });
}

function appendSpeech(segments, text, marker, base) {
  const normalized = String(text ?? '').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return;
  const delivery = deliveryFor(marker, base);
  const previous = segments.at(-1);
  if (previous?.type === 'speech' && previous.marker === marker &&
      previous.rate === delivery.rate && previous.pitch === delivery.pitch && previous.volume === delivery.volume) {
    previous.text = `${previous.text} ${normalized}`.trim();
    return;
  }
  segments.push({ type: 'speech', text: normalized, marker, ...delivery });
}

function splitPunctuation(text, marker, base, segments) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const expression = /(\n{2,}|\n|\.{3}|…|—)/g;
  let cursor = 0;
  for (const match of source.matchAll(expression)) {
    appendSpeech(segments, source.slice(cursor, match.index), marker, base);
    const token = match[0];
    if (/^\n{2,}$/.test(token)) appendPause(segments, 380, 'paragraph');
    else if (token === '\n') appendPause(segments, 190, 'line-break');
    else if (token === '—') appendPause(segments, 145, 'dash');
    else appendPause(segments, 280, 'ellipsis');
    cursor = match.index + token.length;
  }
  appendSpeech(segments, source.slice(cursor), marker, base);
}

export function parseCinematicSpeechScript(value, options = {}) {
  const base = naturalizeBrowserProsody({
    enabled: options.naturalProsody !== false,
    rate: options.rate,
    pitch: options.pitch,
    volume: options.volume
  });
  const script = normalizeCinematicScriptText(value);
  if (!script) return [];

  const segments = [];
  const markerExpression = /\[([^\]]{1,50})\]/g;
  let cursor = 0;
  let activeMarker = 'default';

  for (const match of script.matchAll(markerExpression)) {
    splitPunctuation(script.slice(cursor, match.index), activeMarker, base, segments);
    const marker = resolveCinematicMarker(match[1]);
    if (marker) {
      const pauseDuration = PAUSE_DURATIONS[marker];
      if (pauseDuration) appendPause(segments, pauseDuration, marker);
      if (!['pause', 'short-pause', 'long-pause'].includes(marker)) activeMarker = marker;
    } else {
      appendSpeech(segments, match[0], activeMarker, base);
    }
    cursor = match.index + match[0].length;
  }
  splitPunctuation(script.slice(cursor), activeMarker, base, segments);

  while (segments[0]?.type === 'pause') segments.shift();
  while (segments.at(-1)?.type === 'pause') segments.pop();
  return segments;
}

export function toElevenLabsV3Script(value) {
  return normalizeCinematicScriptText(value).replace(/\[([^\]]{1,50})\]/g, (match, marker) => {
    const resolved = resolveCinematicMarker(marker);
    return resolved ? (ELEVENLABS_TAGS[resolved] ?? '') : match;
  });
}

export const cinematicSpeechInternals = {
  DELIVERY_PROFILES,
  PAUSE_DURATIONS,
  ELEVENLABS_TAGS,
  normalizeMarker
};
