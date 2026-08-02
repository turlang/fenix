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

  async narrateRound(payload) {
    return this.generateText({ purpose: 'ROUND_RESOLUTION', responseMode: 'text', ...payload });
  }

  async narrateCombatTurn(payload) {
    return this.generateText({ purpose: 'COMBAT_TURN_RESOLUTION', responseMode: 'text', ...payload });
  }

  async narrateCombatRound(payload) {
    return this.generateText({ purpose: 'COMBAT_ROUND_SUMMARY', responseMode: 'text', ...payload });
  }
}

function compactText(value, limit = 9000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ENVIRONMENT_PROFILES = Object.freeze({
  DUNGEON: {
    label: 'MASMORRA, CAVERNA OU AMBIENTE SUBTERRÂNEO',
    tone: 'sussurrado, tenso e contido, como se a voz evitasse perturbar o espaço',
    technique: 'Use frases muito curtas nos impactos, reticências para respiração suspensa e uma pausa antes do detalhe final.',
    markers: '[sussurro], [tenso], [medo], [pausa], [suspiro]'
  },
  FOREST: {
    label: 'FLORESTA, BOSQUE OU TRILHA SELVAGEM',
    tone: 'misterioso, atento e imersivo, capaz de mudar rapidamente de serenidade para alerta',
    technique: 'Use travessões para mudanças bruscas de atenção, frases médias para conduzir o olhar e uma frase curta quando houver ruptura confirmada.',
    markers: '[foco], [calmo], [hesitante], [tenso], [pausa], [grito]'
  },
  CITY: {
    label: 'CIDADE, VILA, TAVERNA OU AMBIENTE SOCIAL',
    tone: 'vibrante, caloroso e projetado, com mais fôlego e clareza',
    technique: 'Use frases mais cheias e cadenciadas, interjeições apenas quando naturais e pausas curtas para destacar mudanças de foco.',
    markers: '[alegre], [entusiasmado], [risada], [foco], [pausa]'
  },
  GENERAL: {
    label: 'AMBIENTE GERAL',
    tone: 'cinematográfico, humano e adaptado ao conteúdo canônico da cena',
    technique: 'Misture frases curtas de impacto com frases médias ou longas de progressão, usando pausas apenas nos pontos dramáticos.',
    markers: '[calmo], [foco], [tenso], [hesitante], [pausa], [suspiro]'
  }
});

export function classifyNarrationEnvironment(context = {}) {
  const haystack = normalizeSearchText([
    context.scene?.name,
    context.scene?.description,
    context.room?.name,
    context.source?.name,
    context.source?.areaName,
    context.source?.sceneSectionName,
    context.source?.text
  ].filter(Boolean).join(' '));

  const contains = (terms) => terms.some((term) => haystack.includes(term));
  if (contains(['masmorra', 'dungeon', 'caverna', 'gruta', 'cripta', 'catacumba', 'subterraneo', 'subsolo', 'calabouco', 'tunel', 'corredor de pedra', 'ruina subterranea'])) {
    return { id: 'DUNGEON', ...ENVIRONMENT_PROFILES.DUNGEON };
  }
  if (contains(['floresta', 'bosque', 'mata', 'selva', 'arvore', 'trilha selvagem', 'clareira', 'vegetacao cerrada'])) {
    return { id: 'FOREST', ...ENVIRONMENT_PROFILES.FOREST };
  }
  if (contains(['taverna', 'taberna', 'estalagem', 'cidade', 'vila', 'mercado', 'praca', 'rua', 'beco', 'porto', 'salao', 'hidromel'])) {
    return { id: 'CITY', ...ENVIRONMENT_PROFILES.CITY };
  }
  return { id: 'GENERAL', ...ENVIRONMENT_PROFILES.GENERAL };
}

function expressiveScriptInstructions(context) {
  const environment = classifyNarrationEnvironment(context);
  return [
    'ROTEIRO DE VOZ EXPRESSIVA:',
    `Perfil detectado: ${environment.label}.`,
    `Interpretação vocal: ${environment.tone}.`,
    `Técnica de pontuação: ${environment.technique}`,
    `Marcações permitidas para este perfil: ${environment.markers}.`,
    'Insira de 2 a 5 marcações entre colchetes, imediatamente antes do trecho cuja interpretação elas orientam.',
    'As marcações não são falas nem fatos da cena. Elas controlam respiração, ritmo e entonação; não use uma marcação para justificar a invenção de ameaça, som, criatura ou emoção dos personagens.',
    'Use [pausa] com moderação. Reticências, travessões e quebras de parágrafo devem produzir hesitação ou mudança de foco de modo natural.',
    'Varie claramente o ritmo: combine ao menos uma frase curta e impactante com uma frase mais longa e cadenciada.',
    'Nunca explique as marcações e nunca escreva cabeçalhos no texto final.'
  ].join('\n');
}

function openingPrompt(context) {
  const plan = context.narrativePlan ?? {};
  const previous = (context.novelty?.avoidOpenings ?? [])
    .map((entry, index) => {
      const label = entry.source === 'current-run' ? 'TENTATIVA REJEITADA DESTA EXECUÇÃO' : 'VERSÃO ANTERIOR';
      return `${label} ${index + 1}: ${compactText(entry.excerpt, 650)}`;
    })
    .join('\n');

  return [
    'Você é o narrador cinematográfico de uma mesa de RPG e está abrindo a sessão na cena ativa.',
    'O texto-fonte é uma âncora canônica: extraia seus fatos observáveis, interprete-os e reescreva a cena com clareza e atmosfera.',
    '',
    'VOZ HUMANA E CINEMATOGRÁFICA:',
    'Escreva como um mestre experiente falando ao vivo: fluido, evocativo e natural, nunca como relatório, resumo técnico ou lista de objetos.',
    'Construa a cena em três movimentos conectados: uma imagem inicial forte, uma progressão espacial ou sensorial e um detalhe final que sustente a expectativa.',
    'A emoção deve nascer da cadência, das pausas, do contraste, da escala e da ordem de revelação. Não diga que “há tensão” e não informe o que os jogadores sentem.',
    'Prefira verbos concretos e ativos para o próprio cenário. Varie deliberadamente o tamanho das frases: uma curta para impacto, outra mais ampla para conduzir o olhar.',
    'Use uma metáfora curta somente quando ela reformular um fato visível, sem sugerir ameaça, história ou segredo oculto.',
    '',
    expressiveScriptInstructions(context),
    '',
    'FIDELIDADE E SEGURANÇA:',
    'NÃO traduza literalmente, NÃO copie frases e NÃO mantenha a mesma ordem de ideias do texto-fonte.',
    'Preserve os fatos visíveis e descreva cada elemento canônico apenas uma vez.',
    'Só acrescente consequências sensoriais inevitáveis do que já está confirmado, como o som natural de água em movimento ou a perda de detalhe onde a luz realmente termina.',
    'Não invente chuva, vento, névoa, musgo, aromas, pegadas, vozes, presságios, história do lugar, ameaças, segredos ou mistérios não confirmados.',
    'Não use frases especulativas como “como se”, “parece esconder”, “sensação de que” ou “algo importante”.',
    'Não invente inimigos visíveis, armadilhas, tesouros, sangue, cadáveres, magia, rastros ou acontecimentos futuros.',
    'Não revele informações de condução, estatísticas, segredos, áreas futuras ou pensamentos de NPCs.',
    'Não controle falas, emoções, decisões, olhares, expectativas ou ações dos personagens jogadores.',
    'A abertura descreve somente o ambiente. Não cite nomes de tokens, personagens jogadores, membros do grupo ou atores da Scene.',
    'É proibido mencionar livro, aventura, capítulo, Journal, Scene, Foundry, sistema, mestre, instruções ou material-fonte.',
    'Escreva apenas a narração que os jogadores ouvirão, em português do Brasil, com oralidade elegante e sem linguagem rebuscada demais.',
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
    `Âncora canônica (${context.source?.type ?? 'SCENE_ONLY'} — ${context.source?.name ?? 'cena'}): ${compactText(context.source?.text, 4200) || 'nenhum texto adicional seguro'}`
  ].join('\n');
}

function roomEntryPrompt(context) {
  const actors = (context.visibleActors ?? [])
    .filter((actor) => String(actor?.type ?? '').toLowerCase() !== 'character')
    .map((actor) => actor.name)
    .filter(Boolean)
    .slice(0, 8);
  const perception = context.perception ?? {};
  const visionInstruction = perception.blinded
    ? 'A visão do observador está bloqueada. Não descreva atores nem detalhes visuais da sala; use somente informação não visual que esteja escrita de forma explícita na âncora.'
    : perception.visionAvailable
      ? 'A lista de atores já foi filtrada pela fonte de visão individual do token. Somente esses atores estão comprovadamente visíveis.'
      : 'A geometria de visão não estava disponível. Seja extremamente conservador: não mencione atores e escolha apenas um ou dois detalhes imediatos da entrada.';
  const sensoryInstruction = perception.blinded
    ? 'Como a visão está bloqueada, qualquer som, cheiro ou temperatura precisa estar escrito explicitamente na âncora; não derive nem complete esses detalhes.'
    : 'Nas salas, permaneça no visual: luz, sombra, escala, distância, textura e geometria confirmadas. A emoção deve vir do modo de narrar esses fatos.';
  const previous = (context.novelty?.avoidOpenings ?? [])
    .map((item, index) => `DESCRIÇÃO ANTERIOR ${index + 1}: ${compactText(item.excerpt, 500)}`)
    .join('\n');
  const rejected = (context.quality?.rejected ?? [])
    .map((item, index) => {
      const corrections = [...(item.styleIssues ?? []), ...(item.hardIssues ?? []), ...(item.issues ?? [])]
        .map((issue) => ({
          REPORT_OPENING: 'abandone a fórmula “a sala apresenta/possui”',
          REPORT_SPACE: 'não descreva o ambiente como relatório',
          EXISTENCE_REPORT: 'troque “há/existe/encontra-se” por uma imagem com verbo concreto',
          INVENTORY_LIST: 'substitua a enumeração por progressão espacial',
          UNIFORM_SENTENCE_RHYTHM: 'altere claramente o comprimento das frases',
          TOLD_EMOTION: 'produza emoção pela cadência em vez de nomeá-la',
          NON_VISUAL_ROOM_DETAIL: 'remova sons, cheiros ou temperatura e permaneça no recorte visual'
        })[issue] ?? issue);
      return `TENTATIVA REJEITADA ${index + 1}: ${corrections.join('; ') || 'reescreva com outra estrutura'}`;
    })
    .join('\n');
  const direction = context.styleDirection ?? {};
  return [
    'Narre a entrada em uma sala de RPG com a voz fluida de um mestre experiente falando ao vivo.',
    'Escreva apenas o recorte visual que alcança esse personagem agora. Não faça um resumo da sala, uma inspeção completa nem antecipe o que existe atrás de paredes, portas, curvas ou áreas escuras.',
    visionInstruction,
    '',
    'VOZ, EMOÇÃO E RITMO:',
    'Faça o texto respirar. Construa três batidas ligadas: impacto imediato, movimento do olhar e um detalhe final que permaneça na imaginação.',
    'Crie emoção e tensão pela escolha dos verbos, pela pausa, pelo contraste e pela ordem de revelação; nunca diga simplesmente que o lugar “é tenso” ou “causa uma sensação”.',
    'Alterne frases curtas e médias. Use o ponto final como pausa dramática e conecte os detalhes como um movimento contínuo, não como inventário.',
    'Dê movimento ao cenário com verbos concretos — a luz recorta, uma passagem interrompe, uma parede estreita — somente quando essa relação já estiver confirmada pela âncora.',
    'Uma metáfora breve é permitida apenas para intensificar um fato visível. Ela não pode sugerir presença, perigo, intenção, passado ou segredo.',
    `Tom desta tentativa: ${direction.tone ?? 'tensão contida sem declarar perigo'}.`,
    `Entrada: ${direction.opening ?? 'comece pela imagem concreta mais forte'}.`,
    `Progressão: ${direction.movement ?? 'conduza o olhar do primeiro plano ao fundo'}.`,
    `Fecho: ${direction.closing ?? 'termine num detalhe visível sem interpretá-lo'}.`,
    '',
    expressiveScriptInstructions(context),
    '',
    'LIMITES CANÔNICOS:',
    'A âncora canônica é o limite dos fatos, não uma lista a ser esgotada. Escolha poucos detalhes que estejam no campo de visão imediato e omita qualquer detalhe cuja visibilidade seja incerta.',
    'Evite tom de relatório e fórmulas como “a sala apresenta”, “o espaço permanece”, “é possível observar”, “elementos visíveis”, “cada detalhe confirmado” ou “oferecendo uma leitura”.',
    sensoryInstruction,
    'Não invente sons, cheiros, temperatura, ameaças, inimigos, armadilhas, tesouros, acontecimentos, segredos ou detalhes não confirmados.',
    'Não cite o nome do personagem observador nem de outros personagens jogadores. Só mencione um NPC ou criatura se ele estiver na lista de atores comprovadamente visíveis.',
    'Não revele estatísticas, instruções do mestre, áreas futuras ou pensamentos de NPCs.',
    'Não controle ações, emoções, falas ou decisões dos personagens jogadores.',
    'Não diga que o personagem “vê”, “observa”, “nota” ou “percebe”; apresente a imagem diretamente.',
    'Não mencione token, linha de visão, campo de visão, grade, marcador, Journal, Note, Foundry, livro, aventura, capítulo, sistema, mestre ou material-fonte.',
    'Escreva em português do Brasil, em 1 ou 2 parágrafos curtos, entre 55 e 110 palavras, com oralidade natural e sem excesso de adjetivos.',
    'Não faça pergunta final e não termine com “O que vocês fazem?”.',
    '',
    `Cena: ${context.scene?.name ?? 'sem nome'}`,
    `Sala: ${context.room?.name ?? 'sem nome'}`,
    `Âncora canônica: ${compactText(context.source?.text, 4200)}`,
    `Atores comprovadamente visíveis pelo token: ${perception.visionAvailable && actors.length ? actors.join(', ') : 'nenhum'}`,
    `Modo de percepção: ${perception.mode ?? 'CANONICAL_ONLY'}`,
    '',
    previous || 'Nenhuma descrição anterior registrada para esta sala.',
    rejected || 'Nenhuma correção pendente de tentativas anteriores.'
  ].join('\n');
}

export class GroqNarrativeProvider {
  constructor({ apiKey, model, baseUrl = 'https://api.groq.com/openai/v1', logger = console, timeoutMs = 45000 } = {}) {
    if (!apiKey) throw new TypeError('GROQ_API_KEY não configurada.');
    if (!model) throw new TypeError('GROQ_MODEL não configurado.');
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.logger = logger;
    this.timeoutMs = timeoutMs;
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
    const attempt = Math.max(1, Number(context.novelty?.attempt) || 1);
    return this.#requestText(roomEntryPrompt(context), {
      maxTokens: 400,
      temperature: Math.min(0.91, 0.76 + attempt * 0.03),
      topP: 0.94
    });
  }

  async narrateRound({ roundNumber, resolutions = [], npcCoordination = {}, worldState = {}, context }) {
    const actors = (context?.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 12);
    const actionLines = resolutions.map((resolution, index) => {
      const declaration = resolution?.declaration ?? {};
      const intent = resolution?.intent ?? {};
      const rules = resolution?.rules ?? {};
      const relationship = resolution?.relationship ?? {};
      return [
        `${index + 1}. ${declaration.actorName ?? declaration.actorId ?? 'Personagem'}: ${declaration.content ?? intent.content ?? 'ação não especificada'}`,
        `   Intenção: ${intent.type ?? 'GENERAL'}; alvo: ${intent.target ?? 'não identificado'}.`,
        `   Regras: ${rules.result?.effect ?? 'sem efeito mecânico confirmado'}; sistema: ${rules.adapter?.name ?? rules.adapter?.systemId ?? 'genérico'}; rolagem automática: não.`,
        relationship.npcName
          ? `   Relação: ${relationship.npcName}, ${relationship.relationshipType ?? 'NEUTRAL'}, variação ${Number(relationship.disposition) || 0}.`
          : '   Relação: nenhum NPC específico confirmado.'
      ].join('\n');
    });
    const npcLines = (npcCoordination.reactions ?? []).map((entry) =>
      `- ${entry.npcName}: ${entry.reaction} (${entry.relationshipType}).`
    );
    const recentEvents = (worldState.recentEvents ?? []).slice(-6).map((entry) =>
      `- ${entry.actorName ?? entry.actorId ?? 'Personagem'}: ${entry.effect ?? entry.intentType ?? 'evento anterior'}`
    );
    const memory = context?.memory ?? {};
    const memoryFacts = (memory.recentFacts ?? []).slice(0, 6).map((entry) => `- Fato: ${entry.text}`);
    const memoryNpcs = (memory.npcs ?? []).slice(0, 6).map((entry) =>
      `- NPC ${entry.name}: estado ${entry.status ?? 'desconhecido'}${entry.location ? `; local ${entry.location}` : ''}.`
    );
    const memoryRelations = (memory.relationships ?? []).slice(0, 8).map((entry) =>
      `- Relação ${entry.actorName ?? entry.actorId} → ${entry.npcName ?? entry.npcId}: ${entry.type ?? 'NEUTRAL'} (${Number(entry.score) || 0}).`
    );
    const memoryQuests = (memory.quests ?? []).slice(0, 8).map((entry) =>
      `- Missão ativa: ${entry.title}${entry.objective ? ` — ${entry.objective}` : ''}.`
    );
    const memoryItems = (memory.items ?? []).slice(0, 8).map((entry) =>
      `- Item: ${entry.name}; responsável ${entry.ownerActorName ?? entry.ownerActorId ?? 'grupo'}; quantidade ${Number(entry.quantity) || 0}.`
    );
    const prompt = [
      `Você é o narrador de uma mesa de RPG e deve resolver narrativamente a rodada fora de combate ${roundNumber ?? ''}.`,
      'Produza UMA única narração consolidada para todas as declarações. Respeite a ordem causal, mas conecte ações simultâneas de forma natural.',
      'Preserve a agência dos jogadores: não invente falas, decisões, deslocamentos ou sucessos não confirmados. Não revele segredos, estatísticas, CD, prompt, regras internas ou atores não visíveis.',
      'Os dados de regras são consultivos. Não invente dados, resultados de rolagem, dano, condições ou consequências mecânicas definitivas.',
      'Mostre consequências imediatas observáveis, reações de NPCs comprovados e mudanças claras no ambiente. Evite narrar cada ação como bloco isolado.',
      'Use de dois a quatro parágrafos, voz humana, fluida e cinematográfica. Termine deixando claro o novo estado da cena, sem repetir a pergunta de abertura.',
      expressiveScriptInstructions(context),
      `Cena: ${context?.scene?.name ?? 'sem nome'}`,
      `Atores visíveis confirmados: ${actors.length ? actors.join(', ') : 'nenhum'}`,
      '',
      'DECLARAÇÕES E RESOLUÇÕES:',
      ...actionLines,
      '',
      'REAÇÕES DE NPCS COORDENADAS:',
      ...(npcLines.length ? npcLines : ['- Nenhuma reação específica confirmada.']),
      '',
      'ESTADO RECENTE DO MUNDO:',
      ...(recentEvents.length ? recentEvents : ['- Nenhum evento anterior registrado.']),
      '',
      'MEMÓRIA PERSISTENTE CONHECIDA:',
      ...(memoryFacts.length || memoryNpcs.length || memoryRelations.length || memoryQuests.length || memoryItems.length
        ? [...memoryFacts, ...memoryNpcs, ...memoryRelations, ...memoryQuests, ...memoryItems]
        : ['- Nenhum fato persistente relevante registrado.']),
      'Use esta memória apenas para manter continuidade. Não revele fatos secretos, não trate lembranças como sucesso automático e não contradiga a cena atual.'
    ].join('\n');
    return this.#requestText(prompt, { maxTokens: 850, temperature: 0.68, topP: 0.92 });
  }


  async narrateCombatTurn({ combat = {}, turn = {}, resolutions = [], context }) {
    const actionLines = resolutions.map((resolution, index) => {
      const action = resolution.action ?? {};
      const intent = resolution.intent ?? {};
      const roll = resolution.rules?.combat?.roll ?? {};
      const rollLine = roll.authoritative
        ? `Rolagem confirmada pelo Foundry: total ${roll.total ?? 'não informado'}${roll.damageTotal !== null && roll.damageTotal !== undefined ? `; dano ${roll.damageTotal}${roll.damageType ? ` ${roll.damageType}` : ''}` : ''}${roll.outcome ? `; resultado ${roll.outcome}` : ''}.`
        : 'Nenhum resultado mecânico confirmado; não determine acerto, falha, dano ou condição.';
      return [
        `${index + 1}. ${action.actorName ?? action.actorId ?? 'Combatente'} — ${action.economyType ?? 'ACTION'}: ${action.content ?? intent.content ?? 'ação não especificada'}`,
        action.itemName ? `   Recurso: ${action.itemName}.` : null,
        `   Intenção: ${intent.type ?? 'GENERAL'}; alvo: ${intent.target ?? 'não identificado'}.`,
        `   ${rollLine}`
      ].filter(Boolean).join('\n');
    });
    const prompt = [
      `Narre brevemente o turno de combate de ${turn.actorName ?? combat.activeCombatant?.name ?? 'um combatente'}, na rodada ${turn.round ?? combat.round ?? ''}.`,
      'Produza um ou dois parágrafos, entre 55 e 130 palavras, com ritmo rápido e linguagem cinematográfica de mesa.',
      'Respeite rigorosamente a economia de ações informada: ação, ação bônus, movimento, ação livre e reação não podem ser confundidos.',
      'Somente trate acerto, falha, dano, crítico, cura ou condição como confirmados quando os dados do Foundry estiverem marcados como autoritativos.',
      'Não invente rolagens, números, alvos, deslocamentos, falas, reações ou consequências mecânicas. Preserve a agência e descreva apenas o que foi declarado ou confirmado.',
      'Termine no estado imediato do campo de batalha, sem resumir a rodada inteira e sem fazer perguntas.',
      expressiveScriptInstructions(context),
      `Cena: ${context?.scene?.name ?? 'sem nome'}.`,
      `Combate: ${combat.combatId ?? combat.id ?? 'sem id'}; turno ${turn.turn ?? combat.turn ?? 0}.`,
      '',
      'EVENTOS CONFIRMADOS DO TURNO:',
      ...actionLines
    ].join('\n');
    return this.#requestText(prompt, { maxTokens: 480, temperature: 0.58, topP: 0.9 });
  }

  async narrateCombatRound({ combat = {}, roundNumber, turns = [], context }) {
    const turnLines = turns.map((turn, index) => {
      const actionSummary = (turn.actions ?? []).map((action) => `${action.economyType}: ${action.content}`).join(' | ');
      return `${index + 1}. ${turn.actorName ?? turn.combatant?.name ?? 'Combatente'}: ${actionSummary || 'turno resolvido'} — Narração: ${compactText(turn.narration, 700)}`;
    });
    const prompt = [
      `Resuma cinematograficamente a rodada ${roundNumber ?? combat.round ?? ''} de um combate de RPG.`,
      'Use dois ou três parágrafos, entre 90 e 180 palavras. Conecte os turnos em ordem de iniciativa, destaque mudanças confirmadas e encerre no novo equilíbrio do campo.',
      'Não repita cada turno integralmente. Não invente dano, mortes, condições, deslocamentos, recursos consumidos ou resultados que não apareçam nos registros.',
      'Não explique regras, iniciativa ou bastidores. Preserve a agência dos personagens e mantenha tom de mestre ao vivo.',
      expressiveScriptInstructions(context),
      `Cena: ${context?.scene?.name ?? 'sem nome'}.`,
      '',
      'TURNOS RESOLVIDOS:',
      ...turnLines
    ].join('\n');
    return this.#requestText(prompt, { maxTokens: 650, temperature: 0.62, topP: 0.91 });
  }

  async narrateResolution({ intent, rules, relationship, context }) {
    const actors = (context?.visibleActors ?? []).map((actor) => actor.name).filter(Boolean).slice(0, 6);
    const npcInfo = relationship?.npcName
      ? `NPC identificado: ${relationship.npcName}; disposição: ${relationship.disposition}; relação: ${relationship.relationshipType}.`
      : 'Nenhum NPC específico identificado.';
    const prompt = [
      'Você é o narrador de uma mesa de RPG. Narre as consequências da ação abaixo.',
      'Soa como um mestre falando ao vivo: use uma consequência imediata, uma reação visível do cenário e uma imagem final clara.',
      'Seja direto, fluido e cinematográfico. Varie o ritmo das frases, não explique regras, não refaça eventos e preserve a agência dos jogadores.',
      expressiveScriptInstructions(context),
      'Não invente resultados mecânicos além dos dados fornecidos. Termine em um resultado ou ponto claro de decisão.',
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
            { role: 'system', content: 'Você produz narração oral de RPG com voz humana, fluida, evocativa e cinematográfica. Use marcações expressivas entre colchetes quando solicitado, crie emoção pela cadência sem inventar fatos e nunca responda em JSON.' },
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
  return new GroqNarrativeProvider({ apiKey, model, logger });
}

export const aiProviderInternals = {
  compactText,
  normalizeSearchText,
  classifyNarrationEnvironment,
  expressiveScriptInstructions,
  openingPrompt,
  roomEntryPrompt
};
