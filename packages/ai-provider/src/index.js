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

  async generateArtifact(payload) {
    return this.generateText({ purpose: 'CONTENT_GENERATOR', responseMode: 'json', ...payload });
  }

  async generateMapBlueprint(payload) {
    return this.generateText({ purpose: 'MAP_BLUEPRINT_GENERATOR', responseMode: 'json', ...payload });
  }

  async answerSheetTutor(payload) {
    return this.generateText({ purpose: 'SHEET_TUTOR', responseMode: 'json', ...payload });
  }

  async answerGmTutor(payload) {
    return this.generateText({ purpose: 'GM_TUTOR', responseMode: 'json', ...payload });
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


function adventureReferenceLines(context, limit = 4) {
  const references = (context?.adventure?.references ?? []).slice(0, limit);
  if (!references.length) return ['- Nenhuma referência importada segura relevante.'];
  return references.map((entry, index) =>
    `- Referência segura ${index + 1} — ${entry.documentTitle ?? 'documento'} / ${entry.heading ?? 'seção'}: ${compactText(entry.text, 900)}`
  );
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
    'REFERÊNCIAS IMPORTADAS LIBERADAS PARA NARRAÇÃO:',
    ...adventureReferenceLines(context, 4),
    'Use essas referências somente quando forem compatíveis com a sala atual. Não cite documento, seção ou material-fonte.',
    '',
    previous || 'Nenhuma descrição anterior registrada para esta sala.',
    rejected || 'Nenhuma correção pendente de tentativas anteriores.'
  ].join('\n');
}


function generatorSchemaInstructions(type) {
  if (type === 'NPC') {
    return [
      'metadata deve conter: name, role, ancestry, occupation, motivation, secret e voiceDirection.',
      'content deve ser Markdown com: identidade, aparência, personalidade, objetivos, medo, segredo do mestre, forma de falar, vínculos, três ganchos de interação e bloco consultivo sem inventar regras oficiais.'
    ];
  }
  if (type === 'DUNGEON') {
    return [
      'metadata deve conter: theme, roomCount, levels, objective e entrance.',
      'content deve ser Markdown com visão geral, fluxo textual, áreas numeradas, texto para ler aos jogadores claramente marcado, segredos do mestre, encontros, pistas, armadilhas com solução, recompensas e conexões entre salas.'
    ];
  }
  return [
    'metadata deve conter: hook, estimatedSessions e structure.',
    'content deve ser Markdown com premissa, contexto, gancho inicial, atos ou capítulos, NPCs centrais, locais, conflitos, pistas, encontros, possíveis desfechos e sementes de continuação.'
  ];
}

function generatorPrompt({ type, brief, options = {}, generationNumber = 1, attempt = 1, history = [], rejection = null } = {}) {
  const previous = history.length
    ? history.map((entry, index) => `${index + 1}. ${entry.title} — ${entry.summary} — tags: ${(entry.tags ?? []).join(', ') || 'nenhuma'} — assinatura ${entry.signature}`).join('\n')
    : 'Nenhum conteúdo anterior deste tipo.';
  const rejectionLines = rejection
    ? [`A tentativa anterior ficou semelhante a “${rejection.title}” (${Math.round(Number(rejection.similarity || 0) * 100)}%).`, rejection.instruction]
    : ['Nenhuma tentativa desta geração foi rejeitada.'];
  return [
    `Gere um artefato ORIGINAL do tipo ${type} para uma campanha de RPG.`,
    `Esta é a geração ${generationNumber}, tentativa ${attempt}.`,
    'Responda SOMENTE com um objeto JSON válido, sem bloco de código, comentários ou texto antes/depois.',
    'Formato obrigatório: {"title":"...","summary":"...","tags":["..."],"metadata":{...},"content":"Markdown completo"}.',
    ...generatorSchemaInstructions(type),
    'Não copie aventuras publicadas, personagens conhecidos, mapas comerciais ou texto protegido. Crie conteúdo novo.',
    'Não reutilize a mesma premissa, antagonista, objetivo, estrutura, segredo central, sequência de salas ou nomes do histórico abaixo.',
    'Não inclua resultados de dados como fatos consumados. Regras e CDs devem ser sugestões ajustáveis pelo mestre.',
    `Sistema: ${options.system || 'D&D 5e'}.`,
    `Tom: ${options.tone || 'medieval sombrio e cinematográfico'}.`,
    `Faixa de nível: ${options.levelRange || 'não especificada'}.`,
    `Quantidade de jogadores: ${options.playerCount || 'não especificada'}.`,
    `Extensão: ${options.length || 'MEDIUM'}.`,
    `Incluir segredos do mestre: ${options.includeSecrets === false ? 'não' : 'sim'}.`,
    options.constraints ? `Restrições adicionais: ${options.constraints}` : 'Sem restrições adicionais.',
    '',
    `PEDIDO DO MESTRE: ${brief}`,
    '',
    'CONTEÚDOS JÁ ARQUIVADOS — EVITE REPETIR:',
    previous,
    '',
    'CORREÇÃO DE REPETIÇÃO:',
    ...rejectionLines
  ].join('\n');
}


function mapBlueprintPrompt({ title, prompt, style = 'DUNGEON', roomCount = 8, sourceArtifact = null, attempt = 1 } = {}) {
  const source = sourceArtifact
    ? [
      `Dungeon de origem: ${sourceArtifact.title || 'sem título'}.`,
      `Resumo: ${compactText(sourceArtifact.summary, 1800) || 'não informado'}.`,
      `Metadados: ${compactText(JSON.stringify(sourceArtifact.metadata || {}), 1600)}.`,
      `Conteúdo de referência do mestre: ${compactText(sourceArtifact.content, 18000)}.`
    ].join('\n')
    : 'Nenhuma dungeon arquivada foi vinculada; use somente o pedido do mestre.';
  return [
    'Crie uma PLANTA ABSTRATA ORIGINAL para um mapa tático de RPG.',
    `Tentativa ${attempt}.`,
    'Responda SOMENTE com JSON válido, sem bloco de código e sem texto antes/depois.',
    'Formato obrigatório:',
    '{"title":"...","summary":"...","style":"DUNGEON|CAVE|CRYPT|TEMPLE|SEWER|FORTRESS|FOREST|CITY|GENERAL","tags":["..."],"rooms":[{"id":"room-1","label":"...","kind":"ENTRANCE|ROOM|OBJECTIVE|HAZARD|SOCIAL","width":8,"height":6,"description":"...","readAloud":"...","secret":"...","light":"BRIGHT|DIM|DARK"}],"connections":[{"from":"room-1","to":"room-2","doorType":"DOOR|SECRET|OPEN","locked":false,"secret":"..."}]}.',
    `Crie entre ${Math.max(2, Number(roomCount) || 8)} e ${Math.min(80, Math.max(2, Number(roomCount) || 8) + 2)} áreas.`,
    'Cada id deve ser único, simples e usado exatamente nas conexões.',
    'O grafo precisa ser totalmente conectado: nenhuma sala pode ficar isolada.',
    'Evite cruzamentos impossíveis, teletransportes, salas inacessíveis e conexões redundantes.',
    'width e height são medidas em células de grade, entre 4 e 18.',
    'Inclua uma entrada clara e pelo menos um objetivo final. Use portas secretas com moderação.',
    'readAloud deve conter somente descrição segura para jogadores; secret deve conter somente informação reservada ao mestre.',
    'Não copie mapas publicados, nomes protegidos, geometrias comerciais ou aventuras existentes.',
    'Não determine resultados de testes, dano ou sucesso como fatos consumados.',
    `Título preferido: ${compactText(title, 300) || 'não definido'}.`,
    `Estilo: ${style}.`,
    `Pedido adicional do mestre: ${compactText(prompt, 4000) || 'nenhum'}.`,
    '',
    'MATERIAL DE ORIGEM:',
    source
  ].join('\n');
}


function tutorJsonContract() {
  return [
    'Responda SOMENTE com JSON válido, sem bloco de código e sem texto antes ou depois.',
    'Formato obrigatório: {"answer":"...","confidence":"HIGH|MEDIUM|LOW","sources":["id-de-fato"],"warnings":["..."],"suggestedActions":["..."]}.',
    'sources deve conter somente IDs de fatos ou referências fornecidos no prompt. Não invente IDs.',
    'Não reproduza textos longos de livros ou documentos. Explique com suas próprias palavras.'
  ];
}

function sheetTutorPrompt({ question, actor = {}, facts = [], campaign = {} } = {}) {
  const factLines = facts.slice(0, 180).map((entry) => `- [${entry.id}] ${entry.label} (${entry.path}): ${compactText(entry.value, 500)}`);
  return [
    'Você é o Tutor de Ficha do Mestre Orc.',
    'Ajude o jogador a entender exclusivamente os dados explícitos da ficha enviada pelo Foundry.',
    'A resposta é consultiva: nunca altere a ficha, nunca afirme que executou uma ação e nunca invente atributos, recursos, magias, itens, bônus, proficiências ou resultados.',
    'Quando a pergunta depender da redação completa de uma habilidade ou de uma regra não enviada, diga exatamente o que falta e peça que o usuário abra o item na ficha ou confirme com o mestre.',
    'Não revele segredos de campanha, notas do mestre ou informações de outros personagens.',
    'Para opções de turno, diferencie ação, ação bônus, movimento, reação e ação livre somente quando esses dados estiverem presentes ou quando estiver falando de forma geral.',
    'Escreva em português do Brasil, de forma didática e objetiva.',
    ...tutorJsonContract(),
    '',
    `Pergunta: ${compactText(question, 2000)}`,
    `Campanha/sistema: ${compactText(JSON.stringify(campaign || {}), 1200)}`,
    `Personagem: ${actor.name || 'sem nome'}; tipo ${actor.type || 'desconhecido'}; sistema ${actor.systemId || 'genérico'}; nível ${actor.level ?? 'não informado'}.`,
    '',
    'FATOS AUTORIZADOS DA FICHA:',
    ...(factLines.length ? factLines : ['- Nenhum fato estruturado foi recebido.'])
  ].join('\n');
}

function gmTutorPrompt({ question, context = {}, facts = [] } = {}) {
  const referenceLines = facts.slice(0, 30).map((entry) => `- [${entry.id}] ${entry.label}: ${compactText(entry.value, 1200)}`);
  const memory = context.memory || {};
  return [
    'Você é o Tutor de Mestre do Mestre Orc.',
    'Ajude o mestre a preparar, conduzir e arbitrar uma mesa de RPG usando o contexto fornecido.',
    'A resposta é consultiva: não altere Scene, ficha, combate, Journal, memória ou qualquer documento. Não diga que aplicou mudanças.',
    'Separe fatos confirmados, inferências e sugestões. Não invente regra oficial, CD, estatística, resultado de rolagem ou conteúdo que não esteja no contexto.',
    'Quando houver dúvida de regra, ofereça uma decisão provisória reversível e recomende conferir o material oficial do sistema, sem copiar trechos longos.',
    'Pode usar referências GM_ONLY porque o solicitante é o mestre, mas não sugira publicá-las aos jogadores sem revisão.',
    'Considere agência dos jogadores, ritmo, segurança narrativa, consequências claras e alternativas quando uma cena travar.',
    'Escreva em português do Brasil, com resposta prática e organizada.',
    ...tutorJsonContract(),
    '',
    `Pergunta do mestre: ${compactText(question, 3000)}`,
    `Campanha: ${compactText(JSON.stringify(context.campaign || {}), 1600)}`,
    `Cena: ${compactText(JSON.stringify(context.scene || {}), 2600)}`,
    `Combate: ${compactText(JSON.stringify(context.combat || {}), 2600)}`,
    `Grupo: ${compactText(JSON.stringify(context.party || []), 3500)}`,
    `Memória: ${compactText(JSON.stringify(memory), 8000)}`,
    '',
    'REFERÊNCIAS DA BIBLIOTECA DISPONÍVEIS AO MESTRE:',
    ...(referenceLines.length ? referenceLines : ['- Nenhuma referência encontrada para esta pergunta.'])
  ].join('\n');
}

export class PromptNarrativeProvider {
  constructor({ requestText, providerId = 'unknown', model = null, logger = console } = {}) {
    if (typeof requestText !== 'function') throw new TypeError('requestText é obrigatório.');
    this._requestText = requestText;
    this.providerId = providerId;
    this.model = model;
    this.logger = logger;
  }

  async createOpening(context) {
    const attempt = Math.max(1, Number(context.novelty?.attempt) || 1);
    return this.requestText(openingPrompt(context), {
      maxTokens: 750,
      temperature: Math.min(1, 0.78 + attempt * 0.055),
      topP: 0.95
    });
  }

  async createRoomEntry(context) {
    const attempt = Math.max(1, Number(context.novelty?.attempt) || 1);
    return this.requestText(roomEntryPrompt(context), {
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
      'Use esta memória apenas para manter continuidade. Não revele fatos secretos, não trate lembranças como sucesso automático e não contradiga a cena atual.',
      '',
      'REFERÊNCIAS IMPORTADAS LIBERADAS PARA NARRAÇÃO:',
      ...adventureReferenceLines(context, 4),
      'Esses trechos já passaram pelo filtro PLAYER_SAFE. Use apenas detalhes coerentes com a cena e nunca mencione a origem documental.'
    ].join('\n');
    return this.requestText(prompt, { maxTokens: 850, temperature: 0.68, topP: 0.92 });
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
      ...actionLines,
      '',
      'REFERÊNCIAS IMPORTADAS LIBERADAS PARA NARRAÇÃO:',
      ...adventureReferenceLines(context, 3),
      'Não use referência importada para inventar um resultado mecânico ou revelar informação fora do campo de batalha.'
    ].join('\n');
    return this.requestText(prompt, { maxTokens: 480, temperature: 0.58, topP: 0.9 });
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
      ...turnLines,
      '',
      'REFERÊNCIAS IMPORTADAS LIBERADAS PARA NARRAÇÃO:',
      ...adventureReferenceLines(context, 3),
      'Use somente para continuidade ambiental; os turnos confirmados continuam sendo a fonte de verdade.'
    ].join('\n');
    return this.requestText(prompt, { maxTokens: 650, temperature: 0.62, topP: 0.91 });
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
      `Resultado de regras: ${rules?.result?.effect ?? 'sem regra aplicada'}`,
      '',
      'REFERÊNCIAS IMPORTADAS LIBERADAS PARA NARRAÇÃO:',
      ...adventureReferenceLines(context, 3)
    ].join('\n');
    return this.requestText(prompt, { maxTokens: 500, temperature: 0.65, topP: 0.9 });
  }

  async generateArtifact(payload = {}) {
    return this.requestText(generatorPrompt(payload), {
      maxTokens: payload?.options?.length === 'LONG' ? 3000 : payload?.options?.length === 'SHORT' ? 1200 : 2200,
      temperature: Math.min(1, 0.82 + Math.max(0, Number(payload.attempt) - 1) * 0.05),
      topP: 0.96
    });
  }

  async generateMapBlueprint(payload = {}) {
    return this.requestText(mapBlueprintPrompt(payload), {
      maxTokens: 2600,
      temperature: Math.min(0.95, 0.72 + Math.max(0, Number(payload.attempt) - 1) * 0.06),
      topP: 0.94
    });
  }

  async answerSheetTutor(payload = {}) {
    return this.requestText(sheetTutorPrompt(payload), { maxTokens: 1100, temperature: 0.25, topP: 0.85 });
  }

  async answerGmTutor(payload = {}) {
    return this.requestText(gmTutorPrompt(payload), { maxTokens: 1500, temperature: 0.38, topP: 0.9 });
  }

  async requestText(prompt, options) {
    return this._requestText({ prompt, ...options });
  }
}

const SYSTEM_INSTRUCTION = 'Você produz conteúdo original para RPG sem copiar obras publicadas. Para narração, use voz humana, fluida, evocativa e cinematográfica, com marcações expressivas quando solicitado. Para geradores e tutores, siga rigorosamente o JSON solicitado pelo prompt. Nunca invente resultados mecânicos confirmados, nunca afirme que alterou dados e mantenha orientações de tutor como consultivas.';

function cleanBaseUrl(value, fallback = '') {
  return String(value || fallback).trim().replace(/\/$/, '');
}

function parsePositiveInteger(value, fallback, { min = 1, max = 600000 } = {}) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function createProviderError(message, { providerId, statusCode, retryAfter, code, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.providerId = providerId ?? null;
  error.statusCode = Number(statusCode) || 503;
  error.retryAfter = retryAfter ?? null;
  error.code = code || 'AI_PROVIDER_REQUEST_FAILED';
  return error;
}

function safeProviderFailureMessage(error) {
  const status = Number(error?.statusCode) || 0;
  if (error?.code === 'AI_RATE_LIMIT' || status === 429) return 'Limite de requisições atingido pelo provedor.';
  if (error?.code === 'AI_PROVIDER_TIMEOUT' || status === 504) return 'O provedor excedeu o tempo limite.';
  if (status === 401 || status === 403) return 'A credencial foi recusada pelo provedor.';
  if (status >= 400 && status < 500) return 'A requisição foi recusada pelo provedor.';
  if (error?.code === 'AI_EMPTY_RESPONSE') return 'O provedor retornou uma resposta vazia.';
  if (error?.code === 'AI_PROVIDER_NETWORK_ERROR') return 'Falha de conexão com o provedor.';
  return 'Falha ao gerar a narração com este provedor.';
}

function extractOpenAIResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

class HttpTextTransport {
  constructor({ id, model, baseUrl, apiKey = '', timeoutMs = 45000, logger = console, fetchImpl = globalThis.fetch } = {}) {
    if (!id) throw new TypeError('id do provedor é obrigatório.');
    if (!model) throw new TypeError(`Modelo não configurado para ${id}.`);
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch não está disponível neste ambiente.');
    this.id = id;
    this.model = model;
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async request(url, options, parsePayload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw createProviderError(
          payload?.error?.message || payload?.message || `${this.id} respondeu HTTP ${response.status}.`,
          {
            providerId: this.id,
            statusCode: response.status,
            retryAfter: response.headers?.get?.('retry-after') ?? null,
            code: response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_HTTP_ERROR'
          }
        );
      }
      const text = parsePayload(payload);
      if (!text) throw createProviderError(`${this.id} retornou uma narração vazia.`, { providerId: this.id, code: 'AI_EMPTY_RESPONSE' });
      this.logger.info?.('[Mestre Orc][AI] resposta recebida', {
        provider: this.id,
        model: this.model,
        latencyMs: Date.now() - startedAt
      });
      return text;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createProviderError(`A chamada de IA para ${this.id} excedeu o tempo limite.`, {
          providerId: this.id,
          code: 'AI_PROVIDER_TIMEOUT',
          statusCode: 504,
          cause: error
        });
      }
      if (error?.providerId) throw error;
      throw createProviderError(error?.message || `Falha de rede ao acessar ${this.id}.`, {
        providerId: this.id,
        code: 'AI_PROVIDER_NETWORK_ERROR',
        statusCode: 503,
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAICompatibleChatTransport extends HttpTextTransport {
  constructor({ maxTokensField = 'max_completion_tokens', extraHeaders = {}, ...options } = {}) {
    super(options);
    this.maxTokensField = maxTokensField;
    this.extraHeaders = extraHeaders;
  }

  async generateText({ prompt, maxTokens, temperature, topP = 0.95 }) {
    this.logger.info?.('[Mestre Orc][AI] enviando requisição narrativa', {
      provider: this.id,
      model: this.model,
      promptCharacters: prompt.length,
      temperature
    });
    const headers = { 'Content-Type': 'application/json', ...this.extraHeaders };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt }
      ],
      temperature,
      top_p: topP
    };
    body[this.maxTokensField] = maxTokens;
    return this.request(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }, (payload) => payload?.choices?.[0]?.message?.content?.trim());
  }
}

export class OpenAIResponsesTransport extends HttpTextTransport {
  async generateText({ prompt, maxTokens, temperature, topP = 0.95 }) {
    this.logger.info?.('[Mestre Orc][AI] enviando requisição narrativa', {
      provider: this.id,
      model: this.model,
      promptCharacters: prompt.length,
      temperature
    });
    return this.request(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        instructions: SYSTEM_INSTRUCTION,
        input: prompt,
        temperature,
        top_p: topP,
        max_output_tokens: maxTokens
      })
    }, extractOpenAIResponseText);
  }
}

export class AnthropicMessagesTransport extends HttpTextTransport {
  constructor({ apiVersion = '2023-06-01', ...options } = {}) {
    super(options);
    this.apiVersion = apiVersion;
  }

  async generateText({ prompt, maxTokens, temperature, topP = 0.95 }) {
    this.logger.info?.('[Mestre Orc][AI] enviando requisição narrativa', {
      provider: this.id,
      model: this.model,
      promptCharacters: prompt.length,
      temperature
    });
    return this.request(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        top_p: topP
      })
    }, (payload) => (payload?.content ?? [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim());
  }
}

export class GroqNarrativeProvider extends PromptNarrativeProvider {
  constructor({ apiKey, model, baseUrl = 'https://api.groq.com/openai/v1', logger = console, timeoutMs = 45000, fetchImpl } = {}) {
    if (!apiKey) throw new TypeError('GROQ_API_KEY não configurada.');
    if (!model) throw new TypeError('GROQ_MODEL não configurado.');
    const transport = new OpenAICompatibleChatTransport({
      id: 'groq', apiKey, model, baseUrl, logger, timeoutMs, fetchImpl,
      maxTokensField: 'max_completion_tokens'
    });
    super({ providerId: 'groq', model, logger, requestText: (payload) => transport.generateText(payload) });
    this.transport = transport;
  }
}

export class OpenAINarrativeProvider extends PromptNarrativeProvider {
  constructor({ apiKey, model, baseUrl = 'https://api.openai.com/v1', logger = console, timeoutMs = 45000, fetchImpl } = {}) {
    if (!apiKey) throw new TypeError('OPENAI_API_KEY não configurada.');
    if (!model) throw new TypeError('OPENAI_MODEL não configurado.');
    const transport = new OpenAIResponsesTransport({ id: 'openai', apiKey, model, baseUrl, logger, timeoutMs, fetchImpl });
    super({ providerId: 'openai', model, logger, requestText: (payload) => transport.generateText(payload) });
    this.transport = transport;
  }
}

export class AnthropicNarrativeProvider extends PromptNarrativeProvider {
  constructor({ apiKey, model, baseUrl = 'https://api.anthropic.com/v1', apiVersion = '2023-06-01', logger = console, timeoutMs = 45000, fetchImpl } = {}) {
    if (!apiKey) throw new TypeError('ANTHROPIC_API_KEY não configurada.');
    if (!model) throw new TypeError('ANTHROPIC_MODEL não configurado.');
    const transport = new AnthropicMessagesTransport({ id: 'anthropic', apiKey, model, baseUrl, apiVersion, logger, timeoutMs, fetchImpl });
    super({ providerId: 'anthropic', model, logger, requestText: (payload) => transport.generateText(payload) });
    this.transport = transport;
  }
}

export class OpenAICompatibleNarrativeProvider extends PromptNarrativeProvider {
  constructor({ id = 'compatible', apiKey = '', model, baseUrl, maxTokensField = 'max_tokens', logger = console, timeoutMs = 45000, fetchImpl } = {}) {
    if (!baseUrl) throw new TypeError('AI_COMPATIBLE_BASE_URL não configurada.');
    if (!model) throw new TypeError('AI_COMPATIBLE_MODEL não configurado.');
    const transport = new OpenAICompatibleChatTransport({ id, apiKey, model, baseUrl, maxTokensField, logger, timeoutMs, fetchImpl });
    super({ providerId: id, model, logger, requestText: (payload) => transport.generateText(payload) });
    this.transport = transport;
  }
}

class ProviderCircuit {
  constructor({ id, provider, failureThreshold, cooldownMs, logger, clock }) {
    this.id = id;
    this.provider = provider;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.clock = clock;
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.nextRetryAt = null;
    this.halfOpenInFlight = false;
    this.metrics = {
      requests: 0,
      successes: 0,
      failures: 0,
      lastLatencyMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      lastErrorMessage: null
    };
  }

  canAttempt() {
    const now = this.clock();
    if (this.state === 'OPEN' && this.nextRetryAt !== null && now >= this.nextRetryAt) {
      this.state = 'HALF_OPEN';
      this.halfOpenInFlight = false;
    }
    if (this.state === 'OPEN') return false;
    if (this.state === 'HALF_OPEN' && this.halfOpenInFlight) return false;
    return true;
  }

  async execute(operation, args) {
    if (!this.canAttempt()) return { skipped: true, reason: 'CIRCUIT_OPEN' };
    if (this.state === 'HALF_OPEN') this.halfOpenInFlight = true;
    const startedAt = this.clock();
    this.metrics.requests += 1;
    try {
      const value = await this.provider[operation](...args);
      const completedAt = this.clock();
      this.metrics.successes += 1;
      this.metrics.lastLatencyMs = Math.max(0, completedAt - startedAt);
      this.metrics.lastSuccessAt = new Date(completedAt).toISOString();
      this.metrics.lastErrorCode = null;
      this.metrics.lastErrorMessage = null;
      this.state = 'CLOSED';
      this.consecutiveFailures = 0;
      this.openedAt = null;
      this.nextRetryAt = null;
      this.halfOpenInFlight = false;
      return { value };
    } catch (error) {
      const failedAt = this.clock();
      this.metrics.failures += 1;
      this.metrics.lastLatencyMs = Math.max(0, failedAt - startedAt);
      this.metrics.lastFailureAt = new Date(failedAt).toISOString();
      this.metrics.lastErrorCode = error?.code ?? 'AI_PROVIDER_REQUEST_FAILED';
      this.metrics.lastErrorMessage = safeProviderFailureMessage(error);
      this.consecutiveFailures += 1;
      const statusCode = Number(error?.statusCode) || 0;
      const permanentFailure = [400, 401, 403, 404].includes(statusCode);
      const shouldOpen = this.state === 'HALF_OPEN' || permanentFailure || this.consecutiveFailures >= this.failureThreshold;
      if (shouldOpen) {
        this.state = 'OPEN';
        this.openedAt = failedAt;
        this.nextRetryAt = failedAt + this.cooldownMs;
        this.logger.warn?.('[Mestre Orc][AI] circuit breaker aberto', {
          provider: this.id,
          consecutiveFailures: this.consecutiveFailures,
          nextRetryAt: new Date(this.nextRetryAt).toISOString()
        });
      }
      this.halfOpenInFlight = false;
      return { error };
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.nextRetryAt = null;
    this.halfOpenInFlight = false;
    this.metrics.lastErrorCode = null;
    this.metrics.lastErrorMessage = null;
  }

  snapshot() {
    return {
      id: this.id,
      model: this.provider?.model ?? null,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      nextRetryAt: this.nextRetryAt === null ? null : new Date(this.nextRetryAt).toISOString(),
      ...this.metrics
    };
  }
}

export class ResilientNarrativeProvider {
  constructor({ providers = [], failureThreshold = 3, cooldownMs = 60000, logger = console, clock = Date.now } = {}) {
    if (!Array.isArray(providers) || !providers.length) throw new TypeError('Ao menos um provedor de IA é obrigatório.');
    this.logger = logger;
    this.clock = clock;
    this.circuits = providers.map(({ id, provider }) => new ProviderCircuit({
      id,
      provider,
      failureThreshold,
      cooldownMs,
      logger,
      clock
    }));
    this.activeProviderId = null;
    this.metrics = { requests: 0, successes: 0, failures: 0, fallbackSuccesses: 0 };
  }

  async invoke(operation, ...args) {
    this.metrics.requests += 1;
    const failures = [];
    for (let index = 0; index < this.circuits.length; index += 1) {
      const circuit = this.circuits[index];
      if (typeof circuit.provider?.[operation] !== 'function') continue;
      const result = await circuit.execute(operation, args);
      if (result.skipped) continue;
      if ('value' in result) {
        this.metrics.successes += 1;
        if (index > 0) this.metrics.fallbackSuccesses += 1;
        this.activeProviderId = circuit.id;
        if (index > 0) this.logger.warn?.('[Mestre Orc][AI] fallback concluído', { provider: circuit.id, operation });
        return result.value;
      }
      failures.push({ providerId: circuit.id, error: result.error });
    }

    this.metrics.failures += 1;
    const retryCandidates = this.circuits.map((entry) => entry.nextRetryAt).filter((value) => Number.isFinite(value));
    const retryAt = retryCandidates.length ? Math.min(...retryCandidates) : null;
    const error = createProviderError('Nenhum provedor de IA está disponível para concluir a narração.', {
      code: 'AI_PROVIDERS_UNAVAILABLE',
      statusCode: 503,
      retryAfter: retryAt === null ? null : Math.max(1, Math.ceil((retryAt - this.clock()) / 1000))
    });
    error.failures = failures.map(({ providerId, error: providerFailure }) => ({
      providerId,
      code: providerFailure?.code ?? 'AI_PROVIDER_REQUEST_FAILED',
      statusCode: providerFailure?.statusCode ?? 503,
      message: safeProviderFailureMessage(providerFailure)
    }));
    throw error;
  }

  createOpening(context) { return this.invoke('createOpening', context); }
  createRoomEntry(context) { return this.invoke('createRoomEntry', context); }
  narrateResolution(payload) { return this.invoke('narrateResolution', payload); }
  narrateRound(payload) { return this.invoke('narrateRound', payload); }
  narrateCombatTurn(payload) { return this.invoke('narrateCombatTurn', payload); }
  narrateCombatRound(payload) { return this.invoke('narrateCombatRound', payload); }
  generateArtifact(payload) { return this.invoke('generateArtifact', payload); }
  generateMapBlueprint(payload) { return this.invoke('generateMapBlueprint', payload); }
  answerSheetTutor(payload) { return this.invoke('answerSheetTutor', payload); }
  answerGmTutor(payload) { return this.invoke('answerGmTutor', payload); }

  getStatus() {
    return {
      configured: true,
      primaryProvider: this.circuits[0]?.id ?? null,
      activeProvider: this.activeProviderId,
      order: this.circuits.map((entry) => entry.id),
      metrics: { ...this.metrics },
      providers: this.circuits.map((entry) => entry.snapshot())
    };
  }

  resetProvider(providerId) {
    const circuit = this.circuits.find((entry) => entry.id === providerId);
    if (!circuit) return false;
    circuit.reset();
    return true;
  }
}

function providerOrderFromEnv(env, available) {
  const aliases = { custom: 'compatible', 'openai-compatible': 'compatible' };
  const compatibleAlias = env.AI_COMPATIBLE_ID?.trim().toLowerCase();
  if (compatibleAlias) aliases[compatibleAlias] = 'compatible';
  const requested = String(env.AI_PROVIDER_ORDER || 'groq,openai,anthropic,compatible')
    .split(',')
    .map((entry) => aliases[entry.trim().toLowerCase()] || entry.trim().toLowerCase())
    .filter(Boolean);
  const ordered = [...new Set(requested)].filter((id) => available.has(id));
  for (const id of available.keys()) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export function createNarrativeProviderFromEnv({ logger = console, env = process.env, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const timeoutMs = parsePositiveInteger(env.AI_PROVIDER_TIMEOUT_MS, 45000, { min: 1000, max: 300000 });
  const failureThreshold = parsePositiveInteger(env.AI_PROVIDER_FAILURE_THRESHOLD, 3, { min: 1, max: 20 });
  const cooldownMs = parsePositiveInteger(env.AI_PROVIDER_COOLDOWN_MS, 60000, { min: 1000, max: 600000 });
  const available = new Map();

  if (env.GROQ_API_KEY?.trim() && env.GROQ_MODEL?.trim()) {
    available.set('groq', new GroqNarrativeProvider({
      apiKey: env.GROQ_API_KEY.trim(),
      model: env.GROQ_MODEL.trim(),
      baseUrl: env.GROQ_BASE_URL?.trim() || undefined,
      timeoutMs,
      logger,
      fetchImpl
    }));
  }
  if (env.OPENAI_API_KEY?.trim() && env.OPENAI_MODEL?.trim()) {
    available.set('openai', new OpenAINarrativeProvider({
      apiKey: env.OPENAI_API_KEY.trim(),
      model: env.OPENAI_MODEL.trim(),
      baseUrl: env.OPENAI_BASE_URL?.trim() || undefined,
      timeoutMs,
      logger,
      fetchImpl
    }));
  }
  if (env.ANTHROPIC_API_KEY?.trim() && env.ANTHROPIC_MODEL?.trim()) {
    available.set('anthropic', new AnthropicNarrativeProvider({
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      model: env.ANTHROPIC_MODEL.trim(),
      baseUrl: env.ANTHROPIC_BASE_URL?.trim() || undefined,
      apiVersion: env.ANTHROPIC_VERSION?.trim() || '2023-06-01',
      timeoutMs,
      logger,
      fetchImpl
    }));
  }
  if (env.AI_COMPATIBLE_BASE_URL?.trim() && env.AI_COMPATIBLE_MODEL?.trim()) {
    const compatibleId = env.AI_COMPATIBLE_ID?.trim() || 'compatible';
    available.set('compatible', new OpenAICompatibleNarrativeProvider({
      id: compatibleId,
      apiKey: env.AI_COMPATIBLE_API_KEY?.trim() || '',
      model: env.AI_COMPATIBLE_MODEL.trim(),
      baseUrl: env.AI_COMPATIBLE_BASE_URL.trim(),
      maxTokensField: env.AI_COMPATIBLE_MAX_TOKENS_FIELD?.trim() || 'max_tokens',
      timeoutMs,
      logger,
      fetchImpl
    }));
  }

  const order = providerOrderFromEnv(env, available);
  if (!order.length) {
    logger.warn?.('[Mestre Orc][AI] nenhum provedor configurado; informe credenciais e modelo no .env.');
    return null;
  }
  const providers = order.map((id) => ({
    id: id === 'compatible' ? (available.get(id)?.providerId || 'compatible') : id,
    provider: available.get(id)
  }));
  logger.info?.('[Mestre Orc][AI] provedores configurados', { order, failureThreshold, cooldownMs, timeoutMs });
  return new ResilientNarrativeProvider({ providers, failureThreshold, cooldownMs, logger, clock });
}


export const aiProviderInternals = {
  compactText,
  normalizeSearchText,
  classifyNarrationEnvironment,
  expressiveScriptInstructions,
  openingPrompt,
  roomEntryPrompt,
  generatorPrompt,
  generatorSchemaInstructions,
  mapBlueprintPrompt,
  sheetTutorPrompt,
  gmTutorPrompt,
  tutorJsonContract
};
