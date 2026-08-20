# Fênix Content Importer v1.2 — OCR/Vision & Review Workspace

## Status

Marco executável do Universal Content Importer. O v1.2 estende o compilador PDF digital v1/v1.1 para uma arquitetura **digital-first, OCR-on-demand e fail-closed**.

O Fênix continua preferindo a camada de texto nativa do PDF. OCR/Vision só é chamado quando o PDF não oferece texto utilizável. O Core não inventa texto para páginas escaneadas e não promove inferências incertas para jogadores sem revisão.

## Fluxo

```text
PDF
 │
 ├─ possui camada de texto
 │      ↓
 │  extractor digital v1
 │      ↓
 │  layout semantics v1.1
 │
 └─ sem camada de texto
        ↓
   OCR/Vision provider
        ↓
 confidence por bloco
        ↓
 trusted text + Review Queue

             ↓
      Adventure Model
             ↓
  localização / Knowledge
             ↓
  Semantic Adventure Store
             ↓
      Mestre Fênix
```

## Módulos canônicos

- `packages/content-ingestion/src/importer-v12.js` — orquestra digital/OCR, layout, imagens e localização;
- `packages/content-ingestion/src/ocr-vision.js` — contrato OCR/Vision, confidence e review;
- `packages/content-ingestion/src/pdf-image-discovery.js` — descoberta inicial de imagens incorporadas e candidatos a mapa;
- `packages/content-ingestion/src/content-import-service.js` — autorização GM e ciclo de vida por campanha;
- `packages/adventure-library/src/postgres-semantic-model-store.js` — persistência PostgreSQL;
- `apps/api/src/http/register-content-routes.js` — API do importador;
- `apps/fenix-vtt/components/content-review-workspace.jsx` — workspace visual do Mestre.

## PDF digital versus PDF escaneado

`importPdfAdventureV12()` executa:

1. `extractDigitalPdf()`;
2. se houver texto, mantém o pipeline v1.1 e `fenix.pdf-layout-semantics`;
3. somente se ocorrer `FENIX_PDF_TEXT_LAYER_REQUIRED`, tenta OCR/Vision;
4. sem provider OCR configurado, encerra com `FENIX_OCR_PROVIDER_REQUIRED`;
5. nunca usa uma LLM para preencher silenciosamente texto que não foi reconhecido.

O modo efetivo fica gravado em:

```json
{
  "ingestion": {
    "version": "1.2",
    "extractionMode": "digital-text | ocr-vision",
    "ocrProvider": "..."
  }
}
```

## Contrato OCR/Vision

O Fênix v1.2 **não incorpora um motor OCR próprio**. O Engine aceita um provider HTTP configurável para que OCR possa ser local, self-hosted ou fornecido por infraestrutura externa sem acoplar o Core a um fornecedor.

Variáveis:

```text
FENIX_OCR_VISION_BASE_URL=http://ocr.internal:8080
FENIX_OCR_VISION_API_KEY=opcional
FENIX_OCR_VISION_TIMEOUT_MS=120000
```

O adapter chama:

```text
POST <FENIX_OCR_VISION_BASE_URL>/v1/ocr/pdf
Content-Type: application/json
Authorization: Bearer <token>   # se configurado
```

Payload:

```json
{
  "documentId": "opcional",
  "languageHint": "en",
  "mimeType": "application/pdf",
  "dataBase64": "..."
}
```

Resposta esperada:

```json
{
  "provider": "meu-ocr",
  "language": "en",
  "pages": [
    {
      "pageNumber": 1,
      "width": 1200,
      "height": 1600,
      "confidence": 0.91,
      "preview": {
        "dataUrl": "data:image/webp;base64,..."
      },
      "blocks": [
        {
          "text": "1. Cellar",
          "confidence": 0.99,
          "kind": "heading",
          "bounds": { "x": 80, "y": 90, "width": 300, "height": 50 }
        },
        {
          "text": "The door opens...",
          "confidence": 0.74,
          "kind": "read-aloud",
          "proposedType": "read-aloud",
          "bounds": { "x": 90, "y": 180, "width": 880, "height": 180 },
          "preview": { "dataUrl": "data:image/webp;base64,..." }
        }
      ]
    }
  ]
}
```

`preview` é opcional. O Fênix limita o tamanho dos `dataUrl` recebidos antes de persistir o modelo.

## Confidence e fail-closed

Padrões atuais:

```text
confidence >= 0.92
    ↓
trusted OCR text
    ↓
pode alimentar o compilador sem revisão OCR adicional

0.35 <= confidence < 0.92
    ↓
fenix.ocr-review-queue
    ↓
ocr-candidate / GM-only

confidence < 0.35
    ↓
não vira conteúdo acionável
```

Os limites são configuráveis pelo pipeline:

- `ocrTrustedConfidence` — padrão `0.92`;
- `ocrMinimumReviewConfidence` — padrão `0.35`.

Um candidato OCR pendente é sempre:

```json
{
  "type": "ocr-candidate",
  "visibility": "gm",
  "reviewStatus": "pending"
}
```

Se o Mestre aceitar um candidato proposto como `read-aloud`, ele passa a `read-aloud/player`. Rejeitar mantém o bloco GM-only. Uma edição textual feita no Review Workspace é salva antes da promoção.

Quando existe localização ativa, o serviço relocaliza o Adventure Model após uma decisão OCR para evitar uma tradução antiga ligada ao texto anterior à revisão.

## Review Workspace no VTT

Somente o GM recebe o botão **Importador** no shell do VTT.

O workspace permite:

- enviar PDF;
- escolher idioma da mesa;
- ativar/desativar localização;
- listar Adventures compiladas da campanha;
- visualizar fila combinada de Layout e OCR;
- ver origem, página, confidence e bounds;
- mostrar miniatura/recorte quando o provider OCR enviar `preview.dataUrl`;
- editar o texto reconhecido antes do aceite;
- aceitar ou rejeitar;
- remover uma Adventure da campanha.

Se o provider não enviar imagem de preview, a interface mostra página e coordenadas. **O v1.2 não afirma rasterizar o PDF no navegador ou no Engine.**

## API

Todas as rotas abaixo exigem autenticação e papel `gm` na campanha:

```text
GET    /v1/campaigns/:campaignId/content
GET    /v1/campaigns/:campaignId/content/:adventureId
POST   /v1/campaigns/:campaignId/content/import-pdf
POST   /v1/campaigns/:campaignId/content/:adventureId/review
DELETE /v1/campaigns/:campaignId/content/:adventureId
```

Jogadores não recebem acesso ao workspace nem às rotas administrativas do importador.

## PostgreSQL

Quando o repositório principal está com driver PostgreSQL, o Engine seleciona `PostgresSemanticAdventureStore` e cria automaticamente:

```text
fenix_semantic_adventures
```

Campos principais:

- `campaign_id`;
- `adventure_id`;
- `model_json JSONB`;
- `index_json JSONB`;
- timestamps.

A chave é `(campaign_id, adventure_id)`. Adventure Model e índice são atualizados na mesma operação de persistência do store.

No desenvolvimento sem PostgreSQL, permanece o fallback:

```text
data/semantic-adventures.json
```

configurável por `FENIX_SEMANTIC_ADVENTURE_FILE`.

## Descoberta inicial de imagens e mapas

`pdf-image-discovery.js` identifica objetos PDF `/Subtype /Image` e registra:

- object ID;
- width/height;
- pixel count;
- color space;
- bits per component;
- filtros;
- tamanho do stream;
- `mapConfidence`;
- `mapCandidate`.

Schema:

```text
fenix.pdf-image-discovery v1
```

Esta etapa é **somente descoberta/metadados**. O v1.2 ainda não:

- exporta automaticamente todos os bytes de imagem para AssetStorage;
- cria Scene a partir de uma imagem candidata;
- gera grid, walls, doors ou Regions;
- transforma um candidato em geometria autoritativa.

A política permanece:

```json
{
  "authoritativeSceneMutation": false,
  "gmReviewRequired": true
}
```

## Localização e narração em português

A regra normativa permanece inalterada:

```text
source original
     ↓
semantic model
     ↓
localização fiel pt-BR
     ↓
Knowledge retrieval
     ↓
Mestre Fênix
     ↓
narração natural em português
```

Tradução e narração continuam separadas. Valores numéricos protegidos continuam sujeitos ao guard de fatos mecânicos.

## Segurança e licenciamento

- OCR incerto nunca é automaticamente player-safe;
- o API exige GM para importar/revisar/remover;
- conteúdo original e provenance permanecem no Adventure Model;
- preview de OCR é limitado antes de persistência;
- map candidates não alteram Scene;
- tokens de OCR ficam somente no servidor;
- o Fênix não deve redistribuir material protegido importado pelo usuário;
- código de módulos terceiros não deve ser copiado quando a licença não permitir.

## Critério de verdade do marco

O v1.2 é considerado entregue no código quando testes e CI demonstrarem:

1. PDF sem camada textual aciona OCR/Vision somente quando provider existe;
2. ausência do provider falha explicitamente;
3. confidence intermediária cria fila GM-only;
4. candidato OCR não aparece em retrieval de jogador antes do aceite;
5. aceite de read-aloud torna apenas aquele bloco player-safe;
6. PostgreSQL persiste Adventure Model e decisão OCR;
7. API/serviço exige papel GM;
8. VTT standalone compila com Review Workspace;
9. imagem PDF grande pode virar candidato revisável sem mutar Scene;
10. CI Node 20/22/24 e integração PostgreSQL continuam verdes.

## Limitações restantes

- a execução de OCR real depende de um provider configurado; testes automatizados usam provider determinístico de fixture;
- não há OCR bundled/offline neste marco;
- preview visual depende do provider OCR para rasterização/recorte;
- tables/columns complexas ainda dependem da qualidade do provider;
- imagens descobertas ainda não são promovidas a Fênix AssetStorage;
- Foundry JSON/Journal adapter ainda não faz parte do runtime universal deste marco;
- binding revisado ainda não cria automaticamente trigger de room-entry.
