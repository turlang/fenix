# Fênix Content Import & Localization Architecture

## Status

Diretriz arquitetural oficial para importação de conteúdo de RPG e preparação do conhecimento consumido pelo Mestre Fênix.

Esta especificação é normativa para novos importadores, adapters, compiladores semânticos, pipelines de localização e integrações com o Knowledge Engine/Narration Context.

## Objetivo

Permitir que o Fênix receba material de RPG em formatos heterogêneos — inicialmente PDF e Foundry JSON/Bridge, depois DOCX e outros formatos estruturados — e transforme esse material em um modelo interno consistente, rastreável e seguro para uso pela IA durante uma sessão.

A importação não termina em texto bruto ou HTML. O resultado deve ser um **Adventure Model estruturado**, adequado para busca contextual, regras, segredos, gatilhos de cena, narração e TTS.

## Regra principal

O pipeline oficial é:

```text
SOURCE ORIGINAL
      ↓
EXTRACTION
      ↓
NORMALIZATION
      ↓
LANGUAGE DETECTION
      ↓
LOCALIZATION
      ↓
SEMANTIC COMPILER
      ↓
FÊNIX ADVENTURE MODEL
      ↓
KNOWLEDGE ENGINE / RAG
      ↓
NARRATION CONTEXT BUILDER
      ↓
MESTRE FÊNIX
```

É proibido tratar o fluxo principal como:

```text
PDF → LLM → "entenda tudo" → resposta livre
```

A IA pode auxiliar classificação, tradução e desambiguação, mas fatos mecânicos, origem e estrutura devem permanecer explicitamente representados.

## Fontes suportadas

### Fase inicial

- PDF digital com camada de texto;
- Foundry VTT `JournalEntry` / `JournalEntryPage` exportados em JSON;
- Foundry Bridge/Adapter para resolução de UUIDs e sincronização;
- JSON estruturado de aventura quando fornecido legitimamente pelo usuário.

### Fases posteriores

- PDF escaneado por OCR/visão com etapa obrigatória de confiança/revisão;
- DOCX/TXT;
- compêndios e formatos adicionais por adapters independentes;
- mapas e assets vinculados às fontes importadas.

## Preservação da fonte

Todo conteúdo importado deve manter rastreabilidade até a origem.

Exemplo conceitual:

```json
{
  "source": {
    "type": "pdf",
    "documentId": "adventure-001",
    "page": 47,
    "section": "1. Cellar"
  }
}
```

Para Foundry:

```json
{
  "source": {
    "type": "foundry",
    "journalUuid": "JournalEntry.rDYAeFtPX0qX4jc1",
    "pageUuid": "JournalEntry.rDYAeFtPX0qX4jc1.JournalEntryPage.dUK2VE7Ghk8K5dFp"
  }
}
```

O texto original nunca deve ser substituído destrutivamente pela versão localizada.

## Modelo de conteúdo

O compilador semântico deve conseguir representar, conforme a fonte permitir:

- Adventure / Campaign;
- Chapter;
- Location / Area / Room;
- Journal / Page;
- read-aloud;
- informação exclusiva do GM;
- Secret;
- Trap / Hazard;
- Encounter;
- NPC / Creature;
- Item / Spell / Feature;
- Treasure / Reward;
- Check / DC / Saving Throw;
- Quest / Objective;
- Faction / Relationship;
- Table;
- Cross Reference;
- Map / Scene reference;
- Trigger de exploração ou room-entry.

## Regras para fatos mecânicos

Valores mecânicos são dados estruturados e não podem ser alterados pela tradução ou pela narração.

Exemplos de fatos protegidos:

- DC/CD;
- quantidade de criaturas;
- HP/PV, AC/CA e demais valores de ficha;
- distâncias, duração, alcance e unidades;
- moedas e quantidades de itens;
- nomes próprios e IDs;
- referências de área;
- regras e condições de sucesso/falha.

A camada narrativa pode melhorar ritmo, fluidez, emoção e apresentação, mas não pode reescrever esses fatos.

## Segredos e controle de revelação

Conteúdo classificado como segredo, informação do GM ou descoberta condicional deve possuir política explícita de revelação.

Exemplo:

```json
{
  "type": "check",
  "location": "1. Cellar",
  "skill": "perception",
  "ability": "wis",
  "dc": 15,
  "successReveals": ["hidden-satchel"]
}
```

O Mestre Fênix não deve revelar automaticamente o conteúdo de `successReveals` antes da condição apropriada ser resolvida pelo sistema/regra aplicável.

## Read-aloud e narração

Blocos destinados aos jogadores devem ser classificados separadamente de notas do GM.

Quando houver evidência estrutural forte — por exemplo classes HTML de read-aloud no Foundry — essa marcação tem prioridade sobre inferência da IA.

Para PDF, o classificador pode combinar:

- estrutura textual;
- títulos;
- caixas/bordas;
- estilo tipográfico;
- posição no layout;
- semântica do texto;
- confiança do classificador.

Read-aloud pode gerar gatilhos como `room-entry`, mas a ativação final deve respeitar o estado autoritativo da Cena e do personagem.

## Localização e idiomas

### Princípios

1. detectar o idioma da fonte automaticamente quando possível;
2. preservar o texto original;
3. armazenar uma ou mais versões localizadas;
4. usar `pt-BR` como localização inicial prioritária do produto;
5. separar tradução de adaptação narrativa;
6. preservar nomes próprios por padrão;
7. usar glossários específicos do sistema de RPG;
8. nunca modificar fatos mecânicos na localização.

Modelo conceitual:

```json
{
  "sourceLanguage": "en",
  "originalText": "The door opens onto a large stone cellar.",
  "localized": {
    "pt-BR": "A porta se abre para uma grande adega de pedra."
  }
}
```

## Tradução != narração

A tradução deve buscar fidelidade semântica.

A narração pode aplicar estilo de mesa, cadência, pausas, emoção e prosódia sem inventar fatos.

Exemplo de fluxo:

```text
original inglês
      ↓
tradução fiel pt-BR
      ↓
contexto estruturado + estado da sessão
      ↓
narração natural em português
      ↓
TTS pt-BR
```

O idioma do documento não limita o idioma da mesa. Uma aventura em inglês, espanhol, francês ou outro idioma suportado pode ser compreendida pelo pipeline e narrada/respondida em português.

## Glossário de sistema

A localização deve aceitar glossários por `systemId` para manter terminologia consistente.

Exemplo D&D 5e:

```text
Perception → Percepção
Saving Throw → Teste de Resistência
Armor Class → Classe de Armadura
Hit Points → Pontos de Vida
Difficult Terrain → Terreno Difícil
```

O glossário é configuração de domínio do sistema, não regra fixa universal do Core.

## PDF Semantic Adventure Compiler

Para PDF digital, o pipeline alvo é:

```text
PDF
 ↓
Text + Layout Extractor
 ↓
Document Structure
 ↓
Language Detection
 ↓
Localization Layer
 ↓
Semantic Classification
 ↓
Adventure Entities + Facts + Cross References
 ↓
Knowledge Index
```

Para PDF escaneado:

```text
PDF pages
 ↓
image/vision/OCR extraction
 ↓
confidence scoring
 ↓
manual review when confidence is insufficient
 ↓
normal pipeline
```

OCR não deve ser tratado como verdade absoluta; conteúdo de baixa confiança exige revisão antes de se tornar fato autoritativo.

## Mapas em PDF

Quando o documento contiver mapas, o pipeline pode extrair uma imagem candidata e tentar detectar:

- grid;
- escala;
- offsets;
- salas/áreas numeradas;
- portas;
- paredes;
- regiões.

Geometria inferida automaticamente deve conter confiança e passar por revisão do GM antes de virar geometria autoritativa da Cena.

O mapa continua obedecendo à separação de domínios do Fênix: propriedades físicas pertencem à Cena; atributos de personagem pertencem ao Actor/Sheet; interpretação de movimento pertence ao sistema RPG.

## Foundry Import

O importador Foundry deve normalizar documentos em vez de copiar o modelo interno do Foundry para o Core.

Entradas iniciais:

- `JournalEntry`;
- `JournalEntryPage`;
- UUID `JournalEntry.<id>.JournalEntryPage.<id>`;
- links `@UUID[...]` quando resolvíveis;
- Foundry export JSON;
- conteúdo estruturado de read-aloud e metadata de origem.

O Bridge pode usar APIs do Foundry para resolver documentos, porém o Core deve receber um modelo VTT-agnóstico.

## Knowledge Engine / RAG

O Mestre Fênix não deve receber centenas de páginas do livro a cada ação.

O compilador deve produzir unidades recuperáveis por contexto e relacionamentos entre elas.

Quando o personagem estiver em uma área específica, o Context Builder deve priorizar:

- área atual;
- áreas adjacentes relevantes;
- NPCs presentes;
- encontros ativos;
- segredos elegíveis;
- checks/DCs;
- read-aloud ainda não consumido;
- estado atual da sessão;
- fatos persistentes relevantes.

## Direitos e conteúdo de terceiros

O Fênix importa material fornecido ou conectado pelo usuário. O projeto não deve incluir, redistribuir ou baixar automaticamente conteúdo protegido que não esteja licenciado/autorizado para uso pelo usuário.

Adapters e importadores devem ser implementações próprias. Código de terceiros sem licença compatível não deve ser copiado para o repositório.

## Critérios de aceitação do primeiro marco

O primeiro marco do Universal Content Importer será considerado funcional quando conseguir, em uma aventura de teste autorizada:

1. importar um PDF digital;
2. detectar o idioma;
3. preservar texto original;
4. gerar localização `pt-BR`;
5. separar pelo menos capítulos/áreas/read-aloud/notas GM;
6. extrair checks/DCs e tesouros simples sem alterar valores;
7. preservar página/seção de origem;
8. criar chunks recuperáveis para o Mestre Fênix;
9. narrar em português usando somente conteúdo elegível ao jogador;
10. demonstrar que informação secreta não é revelada antes da condição apropriada.

## Guardrails de implementação

- importadores são adapters; não contaminam os domínios de Cena/Actor/Rules;
- texto original é imutável após ingestão, salvo nova versão/reimportação explícita;
- localização é camada derivada e versionável;
- fatos mecânicos estruturados têm precedência sobre prosa gerada;
- toda afirmação derivada de fonte deve manter provenance;
- classificações de baixa confiança devem ser revisáveis;
- o Mestre Fênix narra contexto recuperado, não o documento inteiro;
- TTS usa o idioma de narração da mesa, não obrigatoriamente o idioma original;
- nenhum importador pode tornar um VTT externo fonte de autoridade das regras do Fênix.
