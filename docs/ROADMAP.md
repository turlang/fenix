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

**Implementado neste marco.**

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

Limites declarados do v1.3:

- image extraction ainda não cobre JPX/JBIG2/CCITT nem predictors Flate complexos;
- Foundry adapter v1.3 cobre JournalEntry/JournalEntryPage, não Actor/Item/Scene completos;
- UUIDs são preservados, mas resolução/sincronização live ainda depende do Bridge;
- mapa promovido continua exigindo configuração/revisão de geometria pelo Mestre.

## Próximo marco do importador

**Content Importer v1.4 — Foundry Entity Graph & Knowledge Bindings**

Objetivos planejados:

- importar entidades referenciadas de Actor, Item, spell, creature/NPC e RollTable em formato normalizado;
- resolver referências internas de um pacote/export sem depender de internet;
- construir grafo Adventure → Chapter/Area → NPC/Creature/Item/Spell → source UUID;
- conectar bindings revisados Area ↔ Scene/Region a triggers reais de Knowledge/room-entry;
- permitir ao Mestre Fênix recuperar somente entidades relevantes para a área/situação atual;
- manter segredos e permissões fail-closed;
- adicionar deduplicação por source UUID/hash para reimportação incremental;
- preparar Foundry Bridge sync sem tornar o Fênix dependente do Foundry.

## Observação histórica

A antiga classificação da importação semântica de PDF/DOCX como “fora de escopo” fica superada por esta decisão arquitetural. O desenvolvimento deve seguir os marcos e guardrails atuais do projeto e a especificação normativa acima.

Itens que continuam dependentes de priorização própria incluem automação avançada de mapas, geradores de aventuras/NPCs/dungeons e demais expansões que não sejam necessárias ao importador funcional atual.
