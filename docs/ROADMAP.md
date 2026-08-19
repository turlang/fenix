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

**Implementado neste marco executável.**

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

Limitações mantidas como próximas evoluções: OCR, PDF criptografado, layout multi-coluna complexo, classificação visual sem rótulo, tabelas avançadas, mapas/assets e revisão por confidence score.

## Próximo marco do importador

**Content Importer v1.1 — Layout Semantics & Review Queue**

- preservar coordenadas e blocos de layout;
- detectar caixas de read-aloud por tipografia/posição, não apenas por rótulo;
- confidence score por entidade extraída;
- fila de revisão do Mestre para baixa confiança;
- persistência/indexação do Adventure Model por campanha;
- vínculo revisável entre áreas importadas e Scene/regions do Fênix.

## Observação histórica

A antiga classificação da importação semântica de PDF/DOCX como “fora de escopo” fica superada por esta decisão arquitetural. O desenvolvimento deve seguir os marcos e guardrails atuais do projeto e a especificação normativa acima.

Itens que continuam dependentes de priorização própria incluem automação avançada de mapas, geradores de aventuras/NPCs/dungeons e demais expansões que não sejam necessárias ao primeiro importador funcional.
