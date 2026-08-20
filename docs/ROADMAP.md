# Roadmap mínimo e obrigatório

## Marco 1 — Início de sessão
- sincronização automática;
- cena ativa obrigatória;
- Journal explicitamente vinculado;
- abertura narrativa baseada apenas na cena;
- publicação automática no chat;
- reprodução TTS local e transmissão para os clientes conectados.

## Marco 2 — Rodada fora de combate
- coleta de uma declaração por personagem;
- botão Resolver rodada;
- Action Interpreter;
- Rules Adapter do sistema ativo;
- NPC Coordinator;
- World State;
- narração consolidada.

## Marco 3 — Memória
- fatos persistentes;
- estado dos NPCs;
- relações sociais;
- missões e itens;
- recuperação após reinício.

## Marco 4 — Combate
- integração com Combat Tracker;
- resolução por turno;
- ações, bônus e reações;
- narração breve por turno e resumo da rodada.

## Marco oficial — Universal Content Importer / PDF Semantic Adventure Compiler

O Fênix passa a tratar a importação semântica como capacidade oficial da plataforma, sem acoplar o Core a um formato ou VTT específico.

Escopo obrigatório:

- importar PDF digital preservando o documento e a proveniência da fonte;
- suportar Foundry `JournalEntry` / `JournalEntryPage` por JSON exportado e Bridge/Adapter;
- detectar idioma da fonte e manter o texto original;
- gerar camada localizada, inicialmente com prioridade para `pt-BR`;
- separar tradução fiel de adaptação narrativa;
- compilar capítulos, áreas, read-aloud, notas do GM, segredos, encontros, NPCs, checks/DCs, tesouros e referências em um Adventure Model estruturado;
- proteger fatos mecânicos contra alteração por tradução ou narração;
- criar unidades recuperáveis pelo Knowledge Engine/RAG e pelo Narration Context Builder;
- permitir que o Mestre Fênix compreenda material em outro idioma e narre/responda em português;
- manter políticas explícitas de revelação para segredos e descobertas condicionais;
- permitir análise de mapas, mas exigir confiança/revisão do GM antes que geometria inferida vire estado autoritativo da Cena;
- adicionar PDF escaneado/OCR/visão em fase posterior, sempre com score de confiança e revisão quando necessário;
- não copiar código de terceiros sem licença compatível nem redistribuir conteúdo protegido sem autorização.

Especificação normativa: [`FENIX_CONTENT_IMPORT_LOCALIZATION.md`](./FENIX_CONTENT_IMPORT_LOCALIZATION.md).

## Critério de aceite inicial do importador

O primeiro marco executável deverá demonstrar, com material de teste autorizado:

1. ingestão de PDF digital;
2. detecção de idioma;
3. preservação do texto original e da página/seção de origem;
4. geração de localização `pt-BR`;
5. separação mínima de capítulos/áreas/read-aloud/notas do GM;
6. extração de checks/DCs e tesouros simples sem alterar valores;
7. criação de chunks recuperáveis pelo Mestre Fênix;
8. narração em português usando apenas conteúdo elegível ao jogador;
9. bloqueio de segredo antes da condição apropriada de revelação.

### Status — PDF Semantic Adventure Compiler v1

**Implementado.**

Entregas:

- extractor próprio para PDF digital com streams de texto, `FlateDecode`, `ObjStm` simples e `/ToUnicode` quando disponível;
- provenance por documento/página/seção;
- detecção inicial de `pt`, `en`, `es` e `fr`;
- `fenix.adventure-model` v1;
- classificação conservadora de Chapter, Area/Room, read-aloud, GM Note, Secret, Check/DC e Treasure;
- localização derivada via `AiInferenceGateway`, com prioridade de produto para `pt-BR`;
- guard que rejeita localização que altere valores numéricos protegidos;
- chunks `player`, `conditional` e `gm`;
- recuperação por seção/query e política explícita de revelação;
- `fenix.mestre-knowledge-context`;
- integração com `NarrationContextBuilder` e fallback seguro no `SceneOpeningContextBuilder`;
- CLI `npm run import:adventure -- <arquivo.pdf>`;
- testes que comprovam o fluxo PDF → Adventure Model → localização → Knowledge → âncora do Mestre Fênix.

Documento operacional: [`FENIX_PDF_SEMANTIC_ADVENTURE_COMPILER_V1.md`](./FENIX_PDF_SEMANTIC_ADVENTURE_COMPILER_V1.md).

### Status — Content Importer v1.1: Layout Semantics & Review Queue

**Implementado.**

Entregas:

- `fenix.pdf-layout-semantics` com coordenadas, font size, linhas, retângulos e candidatos;
- detecção de headings por destaque tipográfico;
- detecção de boxed text por posição/retângulo, inclusive sem rótulo `Read Aloud`;
- `confidence` para inferências de layout;
- `fenix.content-review-queue` com política fail-closed;
- candidatos pendentes permanecem GM-only até decisão explícita;
- accept promove somente o chunk confirmado para `read-aloud/player`;
- reject preserva o conteúdo como GM-only;
- inferência visual não duplica read-aloud explicitamente reconhecido pelo v1;
- persistência de `fenix.adventure-model` por campanha através de `FileSemanticAdventureStore`;
- índice lexical derivado `fenix.semantic-adventure-index` com autorização final ainda feita pelo Knowledge retrieval;
- reconstrução do índice após decisão de revisão;
- propostas revisáveis Adventure Area → Scene/Region sem mutar estado autoritativo da Cena;
- CLI `import:adventure` promovida para o pipeline v1.1;
- testes para layout, review queue, persistência, indexação e scene bindings.

Documento operacional: [`FENIX_CONTENT_IMPORTER_V11_LAYOUT_REVIEW.md`](./FENIX_CONTENT_IMPORTER_V11_LAYOUT_REVIEW.md).

### Status — Content Importer v1.2: OCR/Vision & Review Workspace

**Implementado.**

Entregas:

- pipeline `importPdfAdventureV12()` digital-first e OCR-on-demand;
- fallback para OCR/Vision somente quando o PDF não possui camada textual utilizável;
- provider OCR HTTP desacoplado e configurável por `FENIX_OCR_VISION_*`;
- `fenix.ocr-vision-document` com provenance, bounds, confidence, tipo proposto e preview opcional por página/bloco;
- política fail-closed para scans: sem provider, a importação falha explicitamente em vez de inventar conteúdo;
- `fenix.ocr-review-queue` para blocos com confiança intermediária;
- OCR pendente permanece GM-only; aceite de read-aloud promove somente o bloco confirmado para player-safe;
- edição de texto OCR no review e relocalização posterior quando a Adventure possui idioma alvo;
- Review Workspace integrado ao Fênix VTT e acessível somente ao GM pelo botão `Importador`;
- workspace com importação PDF, catálogo por campanha, confidence, página/bounds, preview opcional e decisões accept/reject;
- rotas autenticadas de content import/list/get/review/delete;
- persistência automática via `PostgresSemanticAdventureStore` quando o Engine usa PostgreSQL;
- fallback local por `FileSemanticAdventureStore`;
- tabela `fenix_semantic_adventures` com `model_json` e `index_json` em JSONB;
- descoberta inicial de objetos PDF `/Subtype /Image`, dimensões e candidatos revisáveis a mapa;
- política explícita `authoritativeSceneMutation: false` para imagens/mapas descobertos;
- CLI promovida para v1.2, incluindo OCR/Vision e estatísticas de imagens;
- testes de scan → OCR → review → player-safe, falha sem provider, PostgreSQL, autorização GM e map candidate.

Documento operacional: [`FENIX_CONTENT_IMPORTER_V12_OCR_REVIEW_WORKSPACE.md`](./FENIX_CONTENT_IMPORTER_V12_OCR_REVIEW_WORKSPACE.md).

### Status — Content Importer v1.3: Asset Extraction & Foundry JSON Adapter

**Implementado.**

Entregas:

- extractor real de imagens PDF `/DCTDecode` (JPEG passthrough) e `/FlateDecode` simples 8-bit (`DeviceGray`/`DeviceRGB`) para PNG;
- provenance do objeto PDF, dimensions, mime type e método de extração;
- candidatos de mapa extraíveis são persistidos no `AssetStorage` da campanha, mantendo status de revisão;
- nenhuma Scene é criada automaticamente durante a importação;
- ação GM-only para promover explicitamente um map candidate persistido para background de uma `Scene`;
- promoção cria Scene/background/dimensões/grid inicial, sem inventar Walls, Doors ou Regions;
- adapter próprio `JournalEntry` / `JournalEntryPage` para JSON exportado do Foundry;
- preservação de journal id/UUID, page id/UUID, HTML original, nome/type/sort e versões do Foundry/sistema quando disponíveis;
- suporte a referências `@UUID[...]`, `data-uuid` e `data-entity-uuid` como referências estruturadas;
- classes HTML de read-aloud reconhecidas sem executar HTML/script;
- PDF e Foundry JSON convergem para o mesmo `fenix.adventure-model` v1;
- localização do material Foundry reutiliza a mesma política `pt-BR`/guards mecânicos do PDF;
- Review Workspace passa a escolher PDF ou Foundry JSON, exibir UUID da fonte e promover candidatos de mapa;
- novas rotas autenticadas `import-foundry` e `promote-scene`;
- testes de Foundry UUID/HTML/reference/read-aloud e PDF image extraction/promoção manual.

Documento operacional: [`FENIX_CONTENT_IMPORTER_V13_ASSETS_FOUNDRY.md`](./FENIX_CONTENT_IMPORTER_V13_ASSETS_FOUNDRY.md).

### Status — Content Importer v1.4: Foundry Entity Graph & Knowledge Bindings

**Implementado.**

Entregas:

- pacote Foundry compatível com JournalEntry puro ou `journal + actors/items/rollTables/entities`;
- normalização de `Actor`, NPC/criatura, `Item`, spell e `RollTable` em `fenix.foundry-entity-graph` v1;
- `sourceUuid` como identidade e `sourceHash` como fingerprint de conteúdo;
- deduplicação por UUID e classificação incremental `new`, `unchanged` e `changed`;
- registro de UUIDs removidos na reimportação para futura revisão de conflitos;
- relações `mentions`, `contains`, `references` e `table-result`;
- referências do Journal ligadas às Areas da página e às entidades do pacote sem internet;
- detalhes das entidades fail-closed/GM-only por padrão, preservando ownership somente como metadado de origem;
- `retrieveBoundEntityKnowledge()` para recuperar apenas entidades ligadas à Area relevante;
- Review Workspace passa a mostrar propostas `Area → Scene/Region` junto das demais filas;
- somente binding explicitamente aceito (`reviewed=true`) habilita Knowledge/room-entry;
- `CampaignAdventureKnowledgeResolver` produz contextos separados player-safe e GM;
- room-entry usa como âncora apenas read-aloud elegível ao jogador, enquanto o Mestre Fênix pode receber entidades GM da Area;
- ações de jogador podem receber conhecimento/entidades da Scene ativa já vinculada;
- `NarrationContextBuilder` passa a normalizar chunks, binding e entidades do conhecimento;
- runtime de campanha recebe o resolver sem transformar Knowledge em autoridade física;
- Bridge SDK recebe `fenix.bridge-content-sync` v1 para preparar sincronização diferencial futura;
- summaries da biblioteca semântica expõem entity graph e pendências de binding;
- testes de grafo, UUID, embedded spell, RollTable, privacidade, reimportação e Area → Scene/Region → room-entry.

Documento operacional: [`FENIX_CONTENT_IMPORTER_V14_ENTITY_GRAPH_BINDINGS.md`](./FENIX_CONTENT_IMPORTER_V14_ENTITY_GRAPH_BINDINGS.md).

### Status — Content Importer v1.5: Foundry Bridge Sync & Native Entity Promotion

**Implementado neste marco.**

Entregas:

- Bridge Foundry v2 carregado no módulo e disponível somente ao GM;
- resolução live-capable de `JournalEntry` / `JournalEntryPage` via `fromUuid()` dentro do runtime do Foundry;
- crawl apenas de referências UUID explícitas, limitado por quantidade e profundidade, sem descoberta irrestrita;
- envelope `fenix.bridge-content-sync` v2 com evidência de UUIDs resolvidos e ausentes;
- sincronização diferencial por `sourceUuid` + `sourceHash` sem tornar o Core dependente do Foundry;
- estado `fenix.foundry-sync-state` com `new`, `unchanged`, `changed`, `removed` e `conflict`;
- conflitos explícitos quando fonte e entidade nativa mudam simultaneamente;
- remoção no Foundry nunca exclui Actor/Item nativo do Fênix;
- resolução GM-only `keep-local`, `accept-source` ou `detach`;
- promoção explícita de Actor/NPC importado para `CampaignActorService` com IDs nativos determinísticos e proveniência no Sheet;
- catálogo nativo `CampaignItemService` para Item/Spell, persistido por campanha e GM-only;
- edição local de Item/Spell marca divergência local sem perder `sourceUuid`/`sourceHash`;
- promoção de Item/Spell importado para o catálogo nativo do Fênix;
- rotas autenticadas para sync Foundry, resolução de conflito, promoção de entidade e catálogo Item/Spell;
- re-sync preserva bindings de Area → Scene/Region e promoções já existentes;
- nenhum overwrite silencioso de entidade promovida;
- testes sintéticos de envelope, conflito, remoção segura, promoção e proteção de edição local.

Documento operacional: [`FENIX_CONTENT_IMPORTER_V15_FOUNDRY_SYNC_NATIVE_PROMOTION.md`](./FENIX_CONTENT_IMPORTER_V15_FOUNDRY_SYNC_NATIVE_PROMOTION.md).

Limites declarados do v1.5:

- o CI hospedado valida código/contratos do Bridge, mas não executa uma instância Foundry VTT real; a prova física de `fromUuid()` fica separada;
- a experiência visual completa de Conflict Review/Promotion no Review Workspace ainda não foi implementada; o v1.5 expõe Bridge e APIs autenticadas;
- mapeamento de Sheet/Item é conservador e universal; conversões específicas de D&D 5e ou outros sistemas exigem mapeadores próprios do RPG System;
- `RollTable` entra no Entity Graph/Knowledge, mas ainda não possui promoção para um catálogo nativo próprio;
- não existe sincronização automática de volta do Fênix para o Foundry;
- Scene/Core/RPG System continuam autoridades para física e regras.

## Próximo marco do importador

**Content Importer v1.6 — Sync Review UX & System-Native Mapping**

Objetivos planejados:

- levar `changed`, `removed` e `conflict` para uma tela completa do Review Workspace;
- permitir promoção Actor/NPC/Item/Spell pelo workspace, com preview de origem e destino;
- adicionar comparação lado a lado Foundry ↔ Fênix antes de `keep-local`, `accept-source` ou `detach`;
- criar mapeadores por RPG System, começando pelo sistema prioritário, sem mover regras para o importador;
- mapear Sheet/Item com perda controlada e provenance dos campos convertidos;
- preparar suporte de promoção/revisão para RollTable sem torná-la autoridade de regras;
- manter o Bridge opcional e o Fênix totalmente funcional sem Foundry.

## Observação histórica

A antiga classificação da importação semântica de PDF/DOCX como “fora de escopo” fica superada por esta decisão arquitetural. O desenvolvimento deve seguir os marcos e guardrails atuais do projeto e a especificação normativa acima.

Itens que continuam dependentes de priorização própria incluem automação avançada de mapas, geradores de aventuras/NPCs/dungeons e demais expansões que não sejam necessárias ao importador funcional atual.
