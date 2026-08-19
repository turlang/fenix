# Fênix PDF Semantic Adventure Compiler v1

## Status

Primeira implementação executável do Universal Content Importer para PDF digital.

Este marco transforma PDF com camada de texto em um `fenix.adventure-model` rastreável, localizável e recuperável pelo Mestre Fênix.

## Pipeline implementado

```text
PDF digital
   ↓
Text-layer extractor
   ↓
Páginas + provenance
   ↓
Language Detection
   ↓
Semantic Compiler
   ↓
Adventure Model v1
   ↓
Localization Layer
   ↓
Knowledge Retrieval
   ↓
NarrationContextBuilder
   ↓
SceneOpeningContextBuilder
   ↓
Mestre Fênix
```

## Pacote

Implementação principal:

```text
packages/content-ingestion/src/index.js
```

APIs públicas do marco:

- `extractDigitalPdf()`;
- `detectDocumentLanguage()`;
- `compileAdventureDocument()`;
- `localizeAdventureModel()`;
- `createAiGatewayTranslator()`;
- `retrieveAdventureKnowledge()`;
- `buildMestreKnowledgeContext()`;
- `importDigitalPdfAdventure()`.

## Extração PDF

O extractor v1 é próprio do Fênix e não adiciona dependência de parsing externa.

Capacidades iniciais:

- valida cabeçalho PDF;
- limita tamanho de entrada;
- rejeita PDF criptografado neste marco;
- percorre árvore de páginas quando disponível;
- lê `/Contents` por página;
- suporta streams sem filtro e `FlateDecode`;
- expande `ObjStm` simples;
- extrai operadores de texto `BT/ET`, `Tj`, `TJ`, `'` e `"`;
- interpreta strings literais e hexadecimais;
- usa `/ToUnicode` quando a fonte fornece CMap compatível;
- preserva número da página e object id;
- falha fechado com `FENIX_PDF_TEXT_LAYER_REQUIRED` quando não encontra uma camada textual utilizável.

OCR/visão não faz parte do v1.

## Adventure Model v1

Schema:

```text
fenix.adventure-model
```

Estrutura inicial:

- Adventure;
- Chapter;
- Section / Area;
- read-aloud;
- GM Note;
- Secret;
- Check / DC;
- Treasure;
- Knowledge Chunk;
- provenance por página/seção.

O classificador inicial é conservador. Texto comum permanece `gm-prose`; somente conteúdo classificado como `read-aloud` é elegível ao jogador por padrão.

Isso evita transformar prosa desconhecida do PDF em informação pública por acidente.

## Classificação inicial

O compilador reconhece padrões explícitos comuns, incluindo equivalentes em português quando aplicável:

- `Chapter` / `Capítulo`;
- `Area` / `Room` / `Sala` / numeração de área;
- `Read Aloud` / `Boxed Text` / `Leia em voz alta`;
- `GM Note` / `DM Note` / `Mestre Nota`;
- `Secret` / `Segredo`;
- `DC` / `CD` e testes simples;
- `Treasure` / `Reward` / `Tesouro` / `Recompensa`.

Layout visual avançado e caixas sem rótulo exigirão uma etapa posterior de análise geométrica/semântica.

## Localização

O Adventure Model preserva `originalText` e adiciona versões derivadas em `localized`.

O idioma inicial da mesa é `pt-BR`.

Quando a origem já é português, o texto pode ser reutilizado sem chamada de IA. Quando a origem difere do destino, o importador exige um translator.

`createAiGatewayTranslator()` usa o `AiInferenceGateway` existente e portanto pode operar com:

- LLM local OpenAI-compatible;
- Groq cloud;
- política `local-only`, `local-preferred` ou `cloud-only`.

A tradução recebe temperatura baixa e instruções para não alterar fatos.

## Guard de fatos mecânicos

Antes de aceitar uma localização, o v1 compara a sequência de valores numéricos do original e da tradução.

Se um valor for alterado, a importação falha com:

```text
FENIX_LOCALIZATION_MECHANICAL_FACT_CHANGED
```

Esse guard cobre a primeira barreira para DC/CD, quantidades, moedas, distâncias e demais valores numéricos representados por dígitos.

A estruturação de fatos mecânicos mais rica continuará evoluindo em marcos posteriores.

## Segredos e elegibilidade

Chunks possuem política de visibilidade:

```text
player
conditional
gm
```

Regras v1:

- `read-aloud` → `player`;
- `secret` → `conditional`;
- notas do Mestre e prosa não classificada → `gm`.

`retrieveAdventureKnowledge()` não retorna chunks `gm` ao jogador.

Um segredo `conditional` só é retornado quando seu `revealKey` aparece em `revealedSecretIds`.

## Ponte com o Mestre Fênix

`buildMestreKnowledgeContext()` produz:

```text
fenix.mestre-knowledge-context
```

O `NarrationContextBuilder` agora preserva esse contexto recuperado.

O `SceneOpeningContextBuilder` aceita um chunk `read-aloud` desse contexto como âncora canônica quando não existe um Journal seguro explicitamente vinculado.

Prioridade de fonte:

```text
Journal read-aloud explicitamente seguro
        ↓ fallback
Adventure Knowledge read-aloud já filtrado
        ↓ fallback
SCENE_ONLY
```

A camada importada não substitui um vínculo explícito do Mestre.

## CLI

Comando:

```powershell
npm run import:adventure -- .\aventura.pdf
```

Saída padrão:

```text
aventura.fenix-adventure.json
```

Exemplo com opções:

```powershell
npm run import:adventure -- .\aventura.pdf `
  --title "Minha Aventura" `
  --target pt-BR `
  --out .\data\minha-aventura.json
```

Para compilar sem tradução:

```powershell
npm run import:adventure -- .\aventura.pdf --no-localize
```

Para PDF em idioma diferente da mesa, configure um provider já suportado pelo Fênix:

```text
FENIX_LOCAL_LLM_BASE_URL
FENIX_LOCAL_LLM_MODEL
FENIX_LOCAL_LLM_API_KEY
```

ou:

```text
GROQ_API_KEY
GROQ_MODEL
GROQ_BASE_URL (opcional)
```

## Testes do marco

Arquivos:

```text
test/pdf-semantic-adventure-compiler.test.js
test/pdf-adventure-narration-context.test.js
```

A suíte prova:

- importação de bytes PDF digitais;
- detecção de inglês;
- localização `pt-BR` com translator injetado;
- preservação de DC 15 e quantidade 50;
- rejeição de tradução que muda valor protegido;
- capítulo e área;
- read-aloud;
- nota GM;
- segredo condicional;
- tesouro simples;
- provenance de página;
- recuperação player-safe;
- liberação de segredo somente após reveal explícito;
- geração de `fenix.mestre-knowledge-context`;
- uso de read-aloud localizado como âncora de narração;
- preservação da prioridade de Journal explicitamente vinculado;
- rejeição de PDF sem camada textual.

## Limitações conhecidas do v1

O marco não declara suporte universal a todo PDF existente.

Ficam para evolução:

- OCR de PDF escaneado;
- PDFs criptografados;
- filtros de stream além dos suportados neste extractor;
- layout multi-coluna complexo;
- classificação de caixas de read-aloud sem rótulo por geometria/tipografia;
- tabelas complexas;
- encontros e NPCs com ficha completa;
- cross references avançadas;
- extração de imagens/mapas;
- revisão humana assistida por confidence score;
- persistência/indexação vetorial de grande escala.

Falha de extração deve continuar fail-closed: conteúdo incerto não vira fato autoritativo silenciosamente.

## Próximo passo recomendado

**Content Importer v1.1 — Layout Semantics & Review Queue**:

1. preservar coordenadas/layout dos blocos de texto;
2. classificar caixas de read-aloud por estilo e posição;
3. adicionar confidence por entidade;
4. criar fila de revisão do Mestre para baixa confiança;
5. persistir Adventure Model e índices por campanha;
6. ligar área/room importada à Scene/region correspondente sem tornar inferência autoridade automática.
