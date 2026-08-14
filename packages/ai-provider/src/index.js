import { buildNarratorSystemPrompt } from './system-prompt.js';

export class NarrativeProvider {
  constructor({ generateText }) {
    if (typeof generateText !== 'function') throw new TypeError('generateText é obrigatório.');
    this.generateText = generateText;
  }

  async createOpening(context) {
    return this.generateText({ purpose: 'SESSION_OPENING', responseMode: 'text', context });
  }

  async createRoomEntry(context) {
    return this.generateText({ purpose: 'ROOM_ENTRY', responseMode: 'text', context });
  }

  async narrateResolution(payload) {
    return this.generateText({ purpose: 'ACTION_RESOLUTION', responseMode: 'text', ...payload });
  }
}

function compactText(value, limit = 9000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function openingPrompt(context) {
  const actors = (context.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 8);
  const plan = context.narrativePlan ?? {};
  const previous = (context.novelty?.avoidOpenings ?? [])
    .map((entry, index) => {
      const label = entry.source === 'current-run' ? 'TENTATIVA REJEITADA DESTA EXECUÇÃO' : 'VERSÃO ANTERIOR';
      return `${label} ${index + 1}: ${compactText(entry.excerpt, 650)}`;
    })
    .join('\n');

  return [
    'Abra a sessão na cena ativa como um mestre falando diretamente à mesa.',
    'Construa a fala em batidas narrativas: primeiro situe o espaço, depois escolha um detalhe observável forte, então abra espaço para os jogadores agirem.',
    'O texto precisa funcionar bem em voz alta. Alterne frases curtas e médias e evite listas de objetos, adjetivos ou sentidos.',
    'O texto-fonte é uma âncora canônica: extraia seus fatos observáveis, interprete-os e reescreva a cena com clareza e atmosfera.',
    'NÃO traduza literalmente, NÃO copie frases e NÃO mantenha a mesma ordem de ideias do texto-fonte.',
    'Preserve os fatos visíveis e descreva cada elemento canônico apenas uma vez.',
    'Só acrescente consequências sensoriais diretas do que já está confirmado, como o som natural da água ou a escuridão de uma abertura.',
    'Não invente chuva, vento, névoa, musgo, aromas, pegadas, vozes, presságios, história do lugar, ameaças, segredos ou mistérios não confirmados.',
    'Não use frases especulativas como “como se”, “parece esconder”, “sensação de que” ou “algo importante”.',
    'Não invente inimigos visíveis, armadilhas, tesouros, sangue, cadáveres, magia, rastros ou acontecimentos futuros.',
    'Não revele informações de condução, estatísticas, segredos, áreas futuras ou pensamentos de NPCs.',
    'Não controle falas, emoções, decisões, olhares, expectativas ou ações dos personagens jogadores.',
    'Quando houver atores visíveis, mencione seus nomes no máximo uma vez e apenas para registrar que estão presentes no local.',
    'Escreva apenas a narração que os jogadores ouvirão.',
    'Produza 2 ou 3 parágrafos, entre 80 e 150 palavras antes da pergunta final.',
    'Termine exatamente com: O que vocês fazem?',
    '',
    'PLANO NARRATIVO OBRIGATÓRIO PARA ESTA VERSÃO:',
    `Foco: ${plan.focus ?? 'ambiente imediato'}`,
    `Tom: ${plan.tone ?? 'mistério'}`,
    `Ritmo: ${plan.pace ?? 'cinematográfico'}`,
    `Forma de entrada: ${plan.entry ?? 'aproximação gradual'}`,
    `Perspectiva: ${plan.perspective ?? 'panorama para detalhe'}`,
    '',
    'VARIAÇÃO ENTRE SESSÕES:',
    'Crie uma estrutura realmente nova, não apenas troque sinônimos.',
    context.novelty?.forceContrast
      ? 'ÚLTIMA TENTATIVA: mude radicalmente a frase inicial, a ordem de revelação, o foco sensorial e o tamanho dos parágrafos, preservando apenas os fatos canônicos.'
      : 'Varie com clareza a frase inicial, a ordem de revelação e o foco sensorial.',
    'Evite repetir a frase inicial, a sequência sensorial, as metáforas, o desenho dos parágrafos e a transição final de versões anteriores.',
    previous || 'Nenhuma versão anterior registrada para esta cena.',
    '',
    'CORREÇÕES DE QUALIDADE EXIGIDAS PELAS TENTATIVAS ANTERIORES:',
    (context.quality?.rejected ?? []).length
      ? JSON.stringify(context.quality.rejected)
      : 'Nenhuma correção anterior nesta execução.',
    '',
    `Nome da cena: ${context.scene?.name ?? 'sem nome'}`,
    `Área: ${context.source?.areaName ?? context.source?.sceneSectionName ?? 'não identificada'}`,
    `Descrição própria da cena: ${compactText(context.scene?.description, 1400) || 'não informada'}`,
    `Âncora canônica (${context.source?.type ?? 'SCENE_ONLY'} — ${context.source?.name ?? 'cena'}): ${compactText(context.source?.text, 4200) || 'nenhum texto adicional seguro'}`,
    `Atores visíveis: ${actors.length ? actors.join(', ') : 'nenhum identificado'}`
  ].join('\n');
}

function roomEntryPrompt(context) {
  const actors = (context.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 8);
  return [
    'Descreva a sala em que o grupo acaba de entrar como um mestre falando, não como texto de enciclopédia.',
    'Comece pelo que orienta imediatamente a posição e a leitura do espaço. Depois acrescente uma única batida sensorial ou visual realmente útil.',
    'Evite enumerar tudo que existe na sala; escolha os elementos que primeiro chamariam a atenção de alguém que acabou de entrar.',
    'Use a âncora canônica somente como fonte de fatos observáveis; interprete e reescreva, sem copiar frases ou a ordem original.',
    'Não invente ameaças, inimigos, armadilhas, tesouros, acontecimentos, segredos ou detalhes não confirmados.',
    'Não revele estatísticas, instruções do mestre, áreas futuras ou pensamentos de NPCs.',
    'Não controle ações, emoções, falas ou decisões dos personagens jogadores.',
    'Escreva em 1 ou 2 parágrafos, entre 50 e 120 palavras, com cadência natural para leitura em voz alta.',
    'Não faça pergunta final e não termine com “O que vocês fazem?”.',
    `Cena: ${context.scene?.name ?? 'sem nome'}`,
    `Sala: ${context.room?.name ?? 'sem nome'}`,
    `Âncora canônica: ${compactText(context.source?.text, 4200)}`,
    `Atores presentes: ${actors.length ? actors.join(', ') : 'nenhum identificado'}`,
    context.novelty?.avoidOpenings?.length
      ? `Evite repetir estas descrições anteriores: ${context.novelty.avoidOpenings.map((item) => compactText(item.excerpt, 500)).join(' | ')}`
      : 'Não há descrição anterior registrada para esta sala.'
  ].join('\n');
}

export class GroqNarrativeProvider {
  constructor({
    apiKey,
    model,
    baseUrl = 'https://api.groq.com/openai/v1',
    logger = console,
    timeoutMs = 45000,
    audioMarkersEnabled = false
  } = {}) {
    if (!apiKey) throw new TypeError('GROQ_API_KEY não configurada.');
    if (!model) throw new TypeError('GROQ_MODEL não configurado.');
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.systemPrompt = buildNarratorSystemPrompt({ audioMarkersEnabled });
  }

  async createOpening(context) {
    const attempt = Math.max(1, Number(context.novelty?.attempt) || 1);
    return this.#requestText(openingPrompt(context), {
      maxTokens: 750,
      temperature: Math.min(1, 0.78 + attempt * 0.055),
      topP: 0.95
    });
  }

  async createRoomEntry(context) {
    return this.#requestText(roomEntryPrompt(context), {
      maxTokens: 400,
      temperature: 0.7,
      topP: 0.9
    });
  }

  async narrateResolution({ intent, rules, relationship, context }) {
    const actors = (context?.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 6);
    const npcInfo = relationship?.npcName
      ? `NPC identificado: ${relationship.npcName}; disposição: ${relationship.disposition}; relação: ${relationship.relationshipType}.`
      : 'Nenhum NPC específico identificado.';
    const prompt = [
      'Narre a consequência desta ação como um mestre reagindo imediatamente ao jogador.',
      'Use a sequência oral: ação percebida → impacto imediato → consequência observável → devolução da agência.',
      'Seja curto, direto e expressivo. Não explique a regra que produziu o resultado e não transforme a resolução em um resumo literário longo.',
      'Não refaça eventos anteriores, não decida a próxima ação do personagem e não acrescente efeitos mecânicos além dos dados fornecidos.',
      'Termine em um resultado perceptível ou em um ponto claro no qual o jogador possa decidir o que fazer a seguir.',
      `Cena: ${context?.scene?.name ?? 'sem nome'}`,
      `Ação do personagem: ${intent?.content ?? 'ação não especificada'}`,
      `Tipo de ação: ${intent?.type ?? 'GENERAL'}`,
      `Alvo: ${intent?.target ?? 'não identificado'}`,
      `Atores presentes: ${actors.length ? actors.join(', ') : 'nenhum identificado'}`,
      npcInfo,
      `Resultado de regras: ${rules?.result?.effect ?? 'sem regra aplicada'}`
    ].join('\n');
    return this.#requestText(prompt, { maxTokens: 500, temperature: 0.65, topP: 0.9 });
  }

  async #requestText(prompt, { maxTokens, temperature, topP = 0.95 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.logger.info?.('[Mestre Orc][AI] enviando requisição narrativa', {
        provider: 'groq', model: this.model, promptCharacters: prompt.length, temperature
      });
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature,
          top_p: topP,
          max_completion_tokens: maxTokens
        }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `Groq respondeu HTTP ${response.status}.`);
        error.statusCode = response.status;
        error.retryAfter = response.headers.get('retry-after');
        throw error;
      }
      const content = payload?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('A Groq retornou uma narração vazia.');
      return content;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A chamada de IA excedeu o tempo limite.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createNarrativeProviderFromEnv({ logger = console } = {}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim();
  if (!apiKey || !model) {
    logger.warn?.('[Mestre Orc][AI] GROQ_API_KEY/GROQ_MODEL ausentes; a narração será recusada até a configuração do .env.');
    return null;
  }
  const audioMarkersEnabled = /^(1|true|on|enabled)$/i.test(String(process.env.MESTRE_ORC_AUDIO_EMOTION_MARKERS ?? 'false'));
  return new GroqNarrativeProvider({ apiKey, model, audioMarkersEnabled, logger });
}
