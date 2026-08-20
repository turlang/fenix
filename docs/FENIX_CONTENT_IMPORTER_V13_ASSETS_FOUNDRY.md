# Fênix Content Importer v1.3 — Asset Extraction & Foundry JSON Adapter

## Objetivo

O v1.3 fecha dois caminhos de ingestão que convergem para o mesmo `fenix.adventure-model`:

1. PDF com extração real de imagens suportadas e promoção manual de mapa para `Scene`;
2. Foundry `JournalEntry`/`JournalEntryPage` exportado em JSON, preservando identidade e estrutura de origem.

## PDF → AssetStorage

O pipeline continua digital-first/OCR-on-demand do v1.2 e adiciona `extractPdfImageAssets()`.

Formatos iniciais suportados:

- `/DCTDecode` → JPEG passthrough;
- `/FlateDecode` simples, 8 bits, `DeviceGray`/`DeviceRGB`, sem predictor → PNG gerado pelo Fênix.

Filtros/encodings não reconhecidos permanecem apenas na metadata de discovery; não são decodificados por tentativa ou IA.

Somente imagens classificadas como `mapCandidate` são enviadas ao `AssetStorage` da campanha. O Adventure Model registra:

- objectId PDF;
- dimensions/pixels;
- mime type;
- método de extração;
- confidence de mapa;
- `campaignAssetId` quando persistido;
- status `review`/`promoted`;
- provenance do objeto PDF.

## Promoção para Scene

A promoção exige ação explícita do GM no Review Workspace ou na API:

`POST /v1/campaigns/:campaignId/content/:adventureId/assets/:imageId/promote-scene`

A promoção cria somente:

- `Scene`;
- background associado ao asset;
- dimensões do mapa;
- grid inicial configurável.

Ela NÃO cria automaticamente:

- Walls;
- Doors;
- Regions;
- Lights;
- elevation/floors;
- triggers físicos.

A geometria continua sob autoridade do Core/Scene e revisão do Mestre.

## Foundry JSON Adapter

Endpoint:

`POST /v1/campaigns/:campaignId/content/import-foundry`

O adapter aceita export de `JournalEntry` com `pages[]` e preserva:

- `_id`/id do Journal;
- UUID do Journal;
- `_id`/id de cada `JournalEntryPage`;
- UUID completo da página;
- nome, type e sort da página;
- HTML original (`text.content`);
- versão do Foundry e sistema quando presentes em `_stats`;
- referências `@UUID[...]` e atributos `data-uuid`/`data-entity-uuid`.

Quando o export não traz UUID explícito, o adapter reconstrói de forma determinística:

`JournalEntry.<journalId>.JournalEntryPage.<pageId>`

O HTML é convertido para texto semântico para o compilador, mas o HTML original permanece preservado em `model.foundry.pages[].originalHtml`.

Classes contendo `readaloud`, `read-aloud` ou `read_aloud` são reconhecidas como read-aloud explícito. Referências são guardadas separadamente e nunca resolvidas por adivinhação.

## Localização

Foundry JSON usa a mesma camada de localização do PDF:

source language → Adventure Model original → localização (`pt-BR` por padrão) → Knowledge Engine.

Números e fatos mecânicos continuam protegidos pelos guards de localização já existentes.

## Segurança e autoridade

- endpoints de importação/promoção são GM-only;
- conteúdo de fonte é preservado, não sobrescrito;
- importação Foundry não executa HTML/script;
- nenhuma referência `@UUID` é buscada externamente sem Bridge/provider autorizado;
- mapa extraído não cria geometria autoritativa;
- código de módulos terceiros não é incorporado.

## Review Workspace

O workspace passa a oferecer:

- seletor PDF / Foundry JSON;
- UUID do Journal para fonte Foundry;
- catálogo unificado de Adventure Models;
- fila OCR/layout existente;
- lista de candidatos de mapa extraídos;
- ação `Promover para Scene` somente quando o asset foi persistido;
- aviso explícito para revisar grid/geometria após promoção.

## Critério de verdade v1.3

1. DCT image é extraída byte-a-byte do PDF;
2. candidato de mapa pode ser persistido no AssetStorage;
3. nenhuma Scene nasce antes da decisão do GM;
4. promoção cria background/Scene sem Walls/Regions inventados;
5. JournalEntry JSON preserva journal UUID;
6. JournalEntryPage preserva page UUID e HTML original;
7. `@UUID[...]` vira referência estruturada;
8. read-aloud do HTML pode virar chunk player-safe sem perder provenance;
9. checks/DCs e treasure continuam compiláveis;
10. PDF e Foundry convergem para `fenix.adventure-model` v1;
11. autorização GM continua obrigatória;
12. CI completo permanece verde.

## Limitações declaradas

- JPEG e Flate simples são os primeiros formatos extraíveis; JPX/JBIG2/CCITT e predictors complexos ficam para evolução;
- Foundry v1.3 cobre JournalEntry/JournalEntryPage, não Actor/Item/Scene completos;
- referências UUID são preservadas, mas resolução/sincronização live depende do futuro Foundry Bridge;
- assets de imagem não são classificados semanticamente como criatura/item/etc. neste marco;
- automação de Walls/Doors continua fora da promoção automática.
