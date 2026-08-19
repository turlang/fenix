# Fênix Content Importer v1.1 — Layout Semantics & Review Queue

## Status

Marco executável do Universal Content Importer. O v1.1 complementa o `PDF Semantic Adventure Compiler v1` e mantém a regra **fail closed para jogadores**: qualquer conteúdo inferido por layout permanece GM-only até revisão explícita, salvo autoaceite com confiança muito alta e reconciliação textual segura.

## Objetivos

- preservar sinais físicos do layout de PDF digital;
- detectar headings por tipografia e boxed text por posição/retângulo;
- atribuir `confidence` às inferências;
- criar uma fila auditável de revisão do Mestre;
- persistir e indexar o `fenix.adventure-model` por campanha;
- propor vínculos entre áreas importadas e `Scene/Region`, sempre revisáveis;
- nunca transformar o importador em autoridade física da Cena.

## Arquitetura

```text
PDF digital
   ↓
extractDigitalPdf (v1)
   ↓
compileAdventureDocument
   │
   ├────────────────────┐
   ↓                    ↓
layout-semantics     Adventure Model v1
   ↓                    │
font/position/re        │
   └──────────┬─────────┘
              ↓
        review-queue
              ↓
      GM accept / reject
              ↓
      Adventure Model revisado
              ↓
 Semantic Adventure Store
              ↓
Knowledge Retrieval / Mestre Fênix
```

Módulos canônicos:

- `packages/content-ingestion/src/layout-semantics.js` — coordenadas, tipografia, retângulos e candidatos;
- `packages/content-ingestion/src/review-queue.js` — fila fail-closed e decisões accept/reject;
- `packages/content-ingestion/src/importer-v11.js` — orquestrador do pipeline v1.1;
- `packages/content-ingestion/src/scene-binding.js` — propostas revisáveis Area → Scene/Region;
- `packages/adventure-library/src/semantic-model-store.js` — persistência/indexação por campanha.

O pipeline v1 continua disponível em `packages/content-ingestion/src/index.js`.

## Layout semântico

O documento derivado usa:

```json
{
  "schema": "fenix.pdf-layout-semantics",
  "version": 1,
  "documentId": "...",
  "pages": []
}
```

Quando disponíveis no content stream, o parser acompanha:

- `Tf` — alias e tamanho de fonte;
- `Tm`, `Td`, `TD`, `T*` — matriz/posição de linha;
- `Tj`, `TJ`, `'`, `"` — texto;
- `re` — retângulos;
- `/MediaBox` — dimensões da página.

A implementação mantém separadamente a **text line matrix** (`lineX/lineY`) e a posição corrente do texto (`x/y`). Assim, `Td`, `TD` e `T*` reposicionam corretamente a linha mesmo depois de um `Tj/TJ` ter avançado a posição horizontal.

A camada textual extraída pelo v1 continua sendo a fonte textual principal. Os runs básicos do parser de layout fornecem geometria e são reconciliados com as linhas já extraídas sempre que possível.

## Heurísticas

### Heading

Uma linha pode virar candidato `section-heading` quando o tamanho de fonte se destaca do corpo da página. A evidência guarda `bodyFontSize`, `fontSize`, razão tipográfica e qualidade de reconciliação.

### Boxed text

Linhas dentro de um retângulo visualmente separado podem gerar candidato:

```json
{
  "kind": "boxed-text",
  "proposedType": "read-aloud",
  "confidence": 0.95
}
```

A confiança considera quantidade de linhas, tamanho e proporção da caixa, rótulo explícito e qualidade da reconciliação texto/layout.

## Política de confiança

Padrões:

```text
confidence < 0.65
    ↓
não vira inferência acionável

0.65 ≤ confidence < 0.97
    ↓
reviewStatus = pending
visibility = gm

confidence ≥ 0.97
+ mappingConfidence ≥ 0.90
    ↓
pode ser autoaceito, mantendo auditoria
```

Configurações:

- `reviewThreshold` — padrão `0.65`;
- `autoAcceptConfidence` — padrão `0.97`.

## Review Queue

Schema:

```json
{
  "schema": "fenix.content-review-queue",
  "version": 1,
  "summary": {
    "total": 1,
    "pending": 1,
    "accepted": 0,
    "rejected": 0
  }
}
```

Cada item preserva `reviewId`, `chunkId`, tipo proposto, confidence, texto original, página/seção, bounds e evidência.

### Accept

```text
layout-candidate / GM-only
          ↓ GM aceita
read-aloud / player
```

Somente o chunk confirmado é promovido e passa a integrar `entities.readAloud`.

### Reject

```text
layout-candidate / GM-only
          ↓ GM rejeita
gm-prose / GM-only
```

A rejeição nunca expõe conteúdo ao jogador.

### Não duplicação

Se o v1 já reconheceu `Read Aloud` explicitamente, a inferência visual equivalente não cria um segundo chunk. Estrutura explícita tem precedência sobre heurística visual.

## Persistência e índice por campanha

`FileSemanticAdventureStore` grava Adventure Models completos por `campaignId` em:

```text
data/semantic-adventures.json
```

Configuração alternativa:

```text
FENIX_SEMANTIC_ADVENTURE_FILE
```

O índice derivado:

```json
{
  "schema": "fenix.semantic-adventure-index",
  "version": 1,
  "adventureId": "...",
  "byToken": {}
}
```

serve apenas para reduzir candidatos. A autorização final continua em `retrieveAdventureKnowledge()`, portanto um índice nunca transforma GM-only em player-safe.

Após uma decisão de review, o store reconstrói o índice e persiste atomicamente o novo modelo. A decisão sobrevive a reinício.

## Adventure Area → Scene/Region

`scene-binding.js` compara títulos de áreas importadas com nomes de Scenes/Regions e produz:

```json
{
  "schema": "fenix.scene-binding-review",
  "policy": {
    "authoritativeSceneMutation": false,
    "gmReviewRequired": true
  }
}
```

Aceitar uma proposta cria somente metadata revisada em:

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

O importador não cria, move ou altera Regions, paredes, portas ou qualquer geometria autoritativa da Cena.

## CLI

```powershell
npm run import:adventure -- .\aventura.pdf --no-localize
```

Novas opções:

```text
--review-threshold 0.65
--auto-accept-confidence 0.97
```

A saída informa candidatos de layout e revisões pendentes, além das estatísticas do Adventure Model.

## Compatibilidade

O `fenix.adventure-model` continua `version: 1`. `layout`, `review` e `bindings` são extensões compatíveis.

## Limitações conhecidas

O v1.1 não afirma suporte universal a PDFs. Permanecem para evolução:

- OCR/visão para PDF escaneado;
- PDFs criptografados;
- filtros de stream adicionais;
- layout multi-coluna sofisticado;
- fontes com encoding incomum quando a reconciliação não recupera o texto do v1;
- tabelas complexas;
- imagens/mapas/assets;
- UI completa da Review Queue no VTT;
- persistência PostgreSQL específica do Adventure Model.

## Critério de verdade

O marco é considerado entregue no Core quando os testes comprovarem:

1. fonte maior detectada como heading candidato;
2. caixa de texto detectada sem rótulo `Read Aloud`;
3. `Td/TD` preservam corretamente a posição de linha após texto emitido;
4. candidato pending permanece invisível ao jogador;
5. accept promove apenas o chunk aprovado;
6. reject mantém GM-only;
7. read-aloud explícito não é duplicado;
8. Adventure Model persiste por campanha;
9. índice é reconstruído após decisão;
10. decisão sobrevive a reload em arquivo;
11. GM-only continua bloqueado em busca player;
12. áreas geram propostas Scene/Region revisáveis;
13. nenhuma proposta altera estado autoritativo de Scene automaticamente.
