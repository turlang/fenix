# Fênix Content Importer v1.1 — Layout Semantics & Review Queue

## Status

Marco executável do Universal Content Importer.

O v1.1 complementa o `PDF Semantic Adventure Compiler v1` sem substituir a extração semântica anterior. A regra central continua sendo **fail closed para jogadores**: qualquer conteúdo inferido por layout que ainda dependa de confirmação permanece GM-only até revisão explícita.

## Objetivos deste marco

1. preservar sinais físicos do layout do PDF;
2. detectar títulos e caixas de texto por posição/tipografia;
3. atribuir `confidence` às inferências de layout;
4. transformar inferências não determinísticas em uma fila revisável;
5. permitir ao Mestre aceitar ou rejeitar um possível read-aloud;
6. persistir e indexar o `fenix.adventure-model` por campanha;
7. propor vínculos entre áreas importadas e `Scene/Region`, sempre com revisão humana;
8. manter o Core de Cena como autoridade — o importador nunca altera geometria ou vínculo de cena sozinho.

## Pipeline v1.1

```text
PDF digital
   ↓
PDF Text Extractor v1
   ↓
Adventure Model v1
   │
   ├───────────────┐
   ↓               ↓
Layout Parser   Semantic Compiler
   ↓               ↓
font size       chunks/entities
position        provenance
rectangles      secrets/checks
   │               │
   └───────┬───────┘
           ↓
 Layout Semantics
           ↓
 confidence score
           ↓
 Content Review Queue
           ↓
 GM accept/reject
           ↓
 Adventure Model revisado
           ↓
 Semantic Adventure Store
           ↓
 Knowledge Retrieval / Mestre Fênix
```

## `fenix.pdf-layout-semantics`

Novo documento derivado do PDF:

```json
{
  "schema": "fenix.pdf-layout-semantics",
  "version": 1,
  "documentId": "...",
  "pages": [
    {
      "pageNumber": 1,
      "mediaBox": { "x": 0, "y": 0, "width": 612, "height": 792 },
      "bodyFontSize": 12,
      "lines": [],
      "rectangles": [],
      "candidates": []
    }
  ]
}
```

O parser acompanha, quando disponíveis no content stream:

- `Tf` para alias/tamanho da fonte;
- `Tm`, `Td`, `TD`, `T*` para posicionamento básico de texto;
- `Tj`, `TJ`, `'` e `"` para runs de texto;
- `re` para retângulos desenhados na página;
- `/MediaBox` para dimensões físicas da página.

A camada de texto extraída pelo v1 continua sendo a fonte textual principal. O layout v1.1 usa seus próprios runs para geometria e tenta reconciliá-los com as linhas já extraídas, evitando que uma decodificação básica de fonte substitua a extração textual mais confiável do v1.

## Candidatos de layout

### Heading

Uma linha pode virar candidato `section-heading` quando seu tamanho de fonte se destaca do corpo da página.

Exemplo:

```json
{
  "kind": "heading",
  "proposedType": "section-heading",
  "confidence": 0.91,
  "evidence": {
    "method": "font-size",
    "bodyFontSize": 11,
    "fontSize": 18
  }
}
```

Neste marco, headings são preservados como evidência de layout. A criação automática de estruturas complexas a partir de heading puramente visual continua conservadora.

### Boxed text

Quando linhas aparecem dentro de um retângulo visualmente separado, o Fênix pode propor:

```json
{
  "kind": "boxed-text",
  "proposedType": "read-aloud",
  "confidence": 0.95
}
```

A confiança considera:

- quantidade de linhas dentro da caixa;
- tamanho do bloco;
- proporção do retângulo em relação à página;
- presença de rótulo explícito como `Read Aloud`;
- qualidade da reconciliação entre texto e layout.

## Regra de segurança

Um candidato inferido de caixa **não se torna automaticamente texto de jogador** apenas por existir.

Política padrão:

```text
confidence < 0.65
    ↓
ignorar como inferência acionável

0.65 ≤ confidence < 0.97
    ↓
reviewStatus = pending
visibility = gm

confidence ≥ 0.97
+ boa reconciliação textual
    ↓
pode ser autoaceito
```

Os valores são configuráveis no importador:

- `reviewThreshold` — padrão `0.65`;
- `autoAcceptConfidence` — padrão `0.97`.

Mesmo quando existe autoaceite, o registro permanece auditável na fila com `mode: auto`.

## `fenix.content-review-queue`

O Adventure Model v1.1 recebe:

```json
{
  "review": {
    "schema": "fenix.content-review-queue",
    "version": 1,
    "summary": {
      "total": 1,
      "pending": 1,
      "accepted": 0,
      "rejected": 0
    },
    "items": []
  }
}
```

Cada item mantém:

- `reviewId`;
- `chunkId` associado;
- tipo proposto;
- confidence;
- texto original;
- página/seção de origem;
- bounds da caixa;
- evidência que justificou a inferência.

## Aceitar read-aloud

A função:

```js
applyAdventureReviewDecisions(model, {
  reviewId,
  action: 'accept'
})
```

faz somente a transição autorizada:

```text
layout-candidate / GM-only
          ↓ GM aceita
read-aloud / player
```

O chunk passa a integrar `entities.readAloud` e pode ser recuperado pelo Knowledge Engine para narração.

## Rejeitar candidato

```text
layout-candidate / GM-only
          ↓ GM rejeita
gm-prose / GM-only
```

A rejeição nunca expõe o conteúdo ao jogador.

## Não duplicação

Se o v1 já reconheceu um bloco explicitamente rotulado como `Read Aloud`, a inferência visual equivalente não cria um segundo chunk. A marcação estrutural explícita continua tendo precedência sobre inferência visual.

## Persistência por campanha

Novo adapter:

`packages/adventure-library/src/semantic-model-store.js`

Classes:

- `InMemorySemanticAdventureStore`;
- `FileSemanticAdventureStore`.

O store persiste o Adventure Model completo por `campaignId` e cria um índice lexical derivado:

```json
{
  "schema": "fenix.semantic-adventure-index",
  "version": 1,
  "adventureId": "...",
  "chunkCount": 120,
  "tokenCount": 840,
  "byToken": {}
}
```

O índice contém referências a chunks, não substitui o modelo canônico.

### Segurança de busca

O índice serve para reduzir o conjunto candidato, porém a autorização final continua em `retrieveAdventureKnowledge()`.

Portanto:

```text
index encontra chunk
       ↓
Knowledge retrieval
       ↓
visibility / revealedSecretIds
       ↓
somente então conteúdo é retornado
```

Um índice nunca transforma conteúdo GM-only em conteúdo de jogador.

## Persistência de revisão

`FileSemanticAdventureStore.applyReview()`:

1. carrega o Adventure Model da campanha;
2. aplica accept/reject;
3. reconstrói o índice;
4. grava atomicamente o JSON;
5. a decisão permanece disponível após reinício.

Arquivo padrão:

```text
data/semantic-adventures.json
```

Pode ser alterado por:

```text
FENIX_SEMANTIC_ADVENTURE_FILE
```

## Vínculo Adventure Area → Scene/Region

Novo adapter:

`packages/content-ingestion/src/scene-binding.js`

O Fênix pode comparar títulos de áreas importadas com nomes de Scenes e Regions existentes.

Exemplo:

```text
Adventure Area
"1. Cellar"
      ↓
similaridade normalizada
      ↓
Scene: Dungeon Level 1
Region: 1. Cellar
      ↓
proposal confidence = 1.0
```

O resultado é:

```json
{
  "schema": "fenix.scene-binding-review",
  "policy": {
    "authoritativeSceneMutation": false,
    "gmReviewRequired": true
  }
}
```

### Regra de autoridade

A proposta **não altera** Scene nem Region.

Somente após:

```js
applyAdventureSceneBindingDecisions(..., {
  reviewId,
  action: 'accept'
})
```

o Adventure Model ganha um vínculo revisado:

```json
{
  "bindings": {
    "sceneRegions": [
      {
        "sectionId": "...",
        "sceneId": "...",
        "regionId": "...",
        "reviewed": true
      }
    ]
  }
}
```

O Core da Cena permanece autoridade física. Este binding é metadata de conteúdo/knowledge e não cria paredes, regiões ou triggers por conta própria.

## CLI

O comando existente foi promovido para o pipeline v1.1:

```powershell
npm run import:adventure -- .\aventura.pdf --no-localize
```

Opções adicionais:

```text
--review-threshold 0.65
--auto-accept-confidence 0.97
```

A saída informa:

- candidatos de layout;
- revisões pendentes;
- demais estatísticas do Adventure Model.

## Compatibilidade

O `fenix.adventure-model` continua em `version: 1` neste marco. Os campos `layout`, `review` e `bindings` são extensões compatíveis do modelo, não uma quebra do contrato anterior.

O pipeline v1 continua disponível em `packages/content-ingestion/src/index.js`. O orquestrador v1.1 está em `packages/content-ingestion/src/layout-review.js`.

## Limitações conhecidas

Este marco ainda não afirma suporte completo a todos os PDFs existentes.

Permanecem para evolução:

- OCR/visão para PDF escaneado;
- PDFs criptografados;
- filtros de stream além dos suportados;
- layout multi-coluna sofisticado;
- fontes com encoding incomum quando a reconciliação não consegue recuperar o texto extraído pelo v1;
- identificação visual de tabelas complexas;
- imagens/mapas e assets;
- relações semânticas avançadas entre áreas;
- interface gráfica completa da Review Queue no VTT;
- persistência PostgreSQL específica do Adventure Model.

## Critério de verdade do v1.1

O marco é considerado entregue no nível Core quando os testes demonstrarem:

1. fonte maior detectada como heading candidato;
2. caixa de texto detectada sem depender do rótulo `Read Aloud`;
3. conteúdo inferido permanece invisível ao jogador enquanto pending;
4. accept torna apenas o chunk aprovado player-safe;
5. reject mantém conteúdo GM-only;
6. read-aloud explícito não é duplicado;
7. Adventure Model persiste por campanha;
8. índice é reconstruído após decisão;
9. decisão sobrevive a reload do store em arquivo;
10. GM-only continua bloqueado em busca player;
11. áreas geram propostas Scene/Region revisáveis;
12. nenhuma proposta altera estado autoritativo de Scene automaticamente.
