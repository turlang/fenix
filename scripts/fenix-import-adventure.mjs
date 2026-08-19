import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  AiInferenceGateway,
  AiLocality,
  AiRoutingPolicy,
  createOpenAICompatibleTextProvider
} from '../packages/ai-inference-gateway/src/index.js';
import {
  createAiGatewayTranslator,
  importDigitalPdfAdventure
} from '../packages/content-ingestion/src/index.js';

function usage() {
  console.log(`Uso:
  npm run import:adventure -- <arquivo.pdf> [opções]

Opções:
  --out <arquivo.json>       destino do Adventure Model
  --title <título>           título da aventura
  --document-id <id>         ID estável da fonte
  --target <idioma>          idioma da mesa (padrão: pt-BR)
  --no-localize              compila sem traduzir

Localização por IA usa os providers já adotados pelo Fênix:
  FENIX_LOCAL_LLM_BASE_URL + FENIX_LOCAL_LLM_MODEL
  GROQ_API_KEY + GROQ_MODEL
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const input = args.shift();
  const options = { input, targetLanguage: 'pt-BR', localize: true };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--no-localize') { options.localize = false; continue; }
    const value = args.shift();
    if (!value) throw new Error(`Valor ausente para ${flag}.`);
    if (flag === '--out') options.out = value;
    else if (flag === '--title') options.title = value;
    else if (flag === '--document-id') options.documentId = value;
    else if (flag === '--target') options.targetLanguage = value;
    else throw new Error(`Opção desconhecida: ${flag}`);
  }
  return options;
}

function routingPolicy(hasLocal) {
  const configured = String(process.env.FENIX_AI_ROUTING_POLICY ?? '').trim().toLowerCase();
  return Object.values(AiRoutingPolicy).includes(configured)
    ? configured
    : hasLocal ? AiRoutingPolicy.LOCAL_PREFERRED : AiRoutingPolicy.CLOUD_ONLY;
}

function createLocalizationGateway() {
  const localBaseUrl = process.env.FENIX_LOCAL_LLM_BASE_URL?.trim();
  const localModel = process.env.FENIX_LOCAL_LLM_MODEL?.trim();
  const localApiKey = process.env.FENIX_LOCAL_LLM_API_KEY?.trim() ?? '';
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  const groqModel = process.env.GROQ_MODEL?.trim();
  const groqBaseUrl = process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const hasLocal = Boolean(localBaseUrl && localModel);
  const hasCloud = Boolean(groqApiKey && groqModel);
  if (!hasLocal && !hasCloud) return null;

  const gateway = new AiInferenceGateway({ policy: routingPolicy(hasLocal) });
  if (hasLocal) {
    gateway.register(createOpenAICompatibleTextProvider({
      id: 'fenix-content-localizer-local',
      locality: AiLocality.LOCAL,
      baseUrl: localBaseUrl,
      apiKey: localApiKey,
      model: localModel,
      timeoutMs: Number(process.env.FENIX_LOCAL_LLM_TIMEOUT_MS) || 60_000,
      maxTokenField: process.env.FENIX_LOCAL_LLM_MAX_TOKEN_FIELD?.trim() || 'max_tokens'
    }));
  }
  if (hasCloud) {
    gateway.register(createOpenAICompatibleTextProvider({
      id: 'fenix-content-localizer-groq',
      locality: AiLocality.CLOUD,
      baseUrl: groqBaseUrl,
      apiKey: groqApiKey,
      model: groqModel,
      timeoutMs: Number(process.env.GROQ_TIMEOUT_MS) || 45_000,
      maxTokenField: 'max_completion_tokens'
    }));
  }
  return gateway;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || options.input === '--help' || options.input === '-h') {
    usage();
    if (!options.input) process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.out || `${inputPath.replace(/\.pdf$/i, '')}.fenix-adventure.json`);
  const pdf = await fs.readFile(inputPath);
  const gateway = options.localize ? createLocalizationGateway() : null;
  const translator = gateway ? createAiGatewayTranslator({ gateway }) : null;

  try {
    const model = await importDigitalPdfAdventure(pdf, {
      documentId: options.documentId,
      title: options.title || path.basename(inputPath, path.extname(inputPath)),
      targetLanguage: options.targetLanguage,
      localize: options.localize,
      translator
    });
    await fs.writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    console.log('[Fênix][Content Import] Adventure Model criado.');
    console.log(`Fonte: ${inputPath}`);
    console.log(`Saída: ${outputPath}`);
    console.log(`Idioma: ${model.language.source} -> ${model.language.target ?? '(sem localização)'}`);
    console.log(`Páginas: ${model.stats.pages}`);
    console.log(`Chunks: ${model.stats.chunks}`);
    console.log(`Read-aloud: ${model.stats.readAloud}`);
    console.log(`Segredos: ${model.stats.secrets}`);
    console.log(`Checks/DCs: ${model.stats.checks}`);
    console.log(`Tesouros: ${model.stats.treasures}`);
  } catch (error) {
    if (error?.code === 'FENIX_LOCALIZER_REQUIRED') {
      throw new Error('O PDF está em outro idioma e nenhum provider de localização foi configurado. Configure FENIX_LOCAL_LLM_* ou GROQ_API_KEY/GROQ_MODEL, ou use --no-localize.');
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`[Fênix][Content Import] ${error.message}`);
  if (error.code) console.error(`Código: ${error.code}`);
  process.exitCode = 1;
});
