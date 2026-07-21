function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return compact(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((player|gm|jogador|mestre)\s*version\)/gi, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

const FOCUSES = Object.freeze([
  'sons produzidos pelos elementos confirmados',
  'luz e profundidade visíveis no local',
  'texturas diretamente indicadas pela fonte',
  'aproximação gradual e revelação do local',
  'posição do grupo diante do acesso',
  'movimento dos elementos confirmados na fonte',
  'escala e geometria do cenário',
  'contraste visual entre terreno aberto e passagem'
]);

const TONES = Object.freeze([
  'descoberta contida',
  'aventura cautelosa',
  'atenção crescente',
  'exploração sóbria',
  'observação silenciosa',
  'curiosidade cuidadosa'
]);

const PACES = Object.freeze([
  'lento e atmosférico',
  'cinematográfico e progressivo',
  'direto com detalhes sensoriais',
  'crescente, do panorama ao detalhe',
  'contido, com pausas e imagens precisas'
]);

const ENTRIES = Object.freeze([
  'começar por um som antes de revelar sua origem',
  'começar pelo último trecho da aproximação do grupo',
  'começar por uma imagem ampla e fechar o enquadramento',
  'começar por um elemento físico confirmado na fonte',
  'começar por um detalhe do terreno que conduz ao cenário',
  'começar pelo contraste entre o caminho percorrido e o local encontrado'
]);

const PERSPECTIVES = Object.freeze([
  'panorama para detalhe',
  'detalhe para panorama',
  'aproximação em movimento',
  'observação estática do limiar',
  'revelação em camadas'
]);

export class OpeningNarrativePlanner {
  buildSceneKey(context = {}) {
    const scene = normalizeKey(context.scene?.name || context.scene?.id || 'scene');
    const area = normalizeKey(context.source?.areaName || context.source?.sceneSectionName || context.source?.name || 'opening');
    return `${scene}:${area}`;
  }

  createPlan({ context = {}, history = [], attempt = 0 } = {}) {
    const sceneKey = this.buildSceneKey(context);
    const used = new Set(history.map((entry) => entry?.plan?.signature).filter(Boolean));
    const base = hash(sceneKey) + history.length + attempt * 17;
    const combinations = FOCUSES.length * TONES.length * PACES.length * ENTRIES.length * PERSPECTIVES.length;

    for (let offset = 0; offset < combinations; offset += 1) {
      const index = base + offset;
      const focus = FOCUSES[index % FOCUSES.length];
      const tone = TONES[Math.floor(index / FOCUSES.length) % TONES.length];
      const pace = PACES[Math.floor(index / (FOCUSES.length * TONES.length)) % PACES.length];
      const entry = ENTRIES[Math.floor(index / (FOCUSES.length * TONES.length * PACES.length)) % ENTRIES.length];
      const perspective = PERSPECTIVES[Math.floor(index / (FOCUSES.length * TONES.length * PACES.length * ENTRIES.length)) % PERSPECTIVES.length];
      const signature = [focus, tone, pace, entry, perspective].join('|');
      if (used.has(signature)) continue;
      return { sceneKey, focus, tone, pace, entry, perspective, signature };
    }

    const cycle = history.length + attempt;
    return {
      sceneKey,
      focus: FOCUSES[cycle % FOCUSES.length],
      tone: TONES[cycle % TONES.length],
      pace: PACES[cycle % PACES.length],
      entry: ENTRIES[cycle % ENTRIES.length],
      perspective: PERSPECTIVES[cycle % PERSPECTIVES.length],
      signature: `cycle-${cycle}`
    };
  }
}

export function createOpeningNarrativePlanner() {
  return new OpeningNarrativePlanner();
}
