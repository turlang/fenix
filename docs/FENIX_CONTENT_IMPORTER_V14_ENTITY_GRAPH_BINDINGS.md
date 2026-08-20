# Fênix Content Importer v1.4 — Foundry Entity Graph & Knowledge Bindings

## Status

Implementado no marco v1.4.

## Objetivo

O v1.4 transforma o JSON do Foundry de um conjunto de páginas importadas em um grafo de conhecimento rastreável. `JournalEntry` continua sendo a raiz narrativa, enquanto `Actor`, NPC/criaturas, `Item`, spell e `RollTable` podem ser incluídos no mesmo pacote e relacionados por UUID.

O Fênix continua independente do Foundry em runtime: o importador consome dados exportados/normalizados. A sincronização ao vivo fica para um marco posterior.

## Contrato de pacote

O importador mantém compatibilidade com um `JournalEntry` puro e também aceita um pacote como:

```json
{
  "journal": { "_id": "...", "pages": [] },
  "actors": [],
  "items": [],
  "rollTables": []
}
```

Também é aceita a coleção genérica `entities`.

O Bridge SDK possui `fenix.bridge-content-sync` v1 para preparar sincronização diferencial futura sem introduzir uma dependência Foundry no Core.

## Entity Graph

Schema:

```text
fenix.foundry-entity-graph v1
```

Cada node preserva:

- `sourceUuid` como identidade de origem;
- `sourceHash` para detectar alterações;
- tipo de documento e subtipo;
- nome;
- ownership de origem;
- descrição convertida para texto seguro;
- fatos mecânicos compactos;
- referências a outros UUIDs;
- estado de revisão incremental: `new`, `unchanged` ou `changed`.

Kinds iniciais:

- `actor`;
- `npc`;
- `item`;
- `spell`;
- `roll-table`.

Itens embutidos em Actor recebem UUID derivado do pai quando o export não fornece UUID completo.

## Relações

O grafo suporta inicialmente:

- `mentions`: Area/section do Journal referencia uma entidade;
- `contains`: Actor contém Item/spell embutido;
- `references`: uma entidade aponta para outra via UUID;
- `table-result`: RollTable referencia uma entidade em um resultado.

O grafo não cria Actor, Token, Item ou Scene nativos automaticamente.

## Deduplicação e reimportação

`sourceUuid` é a identidade estável. Um novo pacote com o mesmo UUID não cria outra entidade.

O `sourceHash` permite classificar uma reimportação como:

- `new`: UUID ainda não existia;
- `unchanged`: UUID e conteúdo equivalente;
- `changed`: UUID igual, conteúdo diferente.

Entidades removidas da nova fonte são registradas em `revision.removedSourceUuids` para permitir uma futura tela de conflito/sincronização.

## Segurança e permissões

A política é fail-closed.

Detalhes importados de Actor/NPC/Item/spell/RollTable são `gm` por padrão, independentemente de o arquivo ter vindo de um mundo no qual alguém possua permissões maiores. O importador preserva ownership para auditoria, mas não converte ownership Foundry automaticamente em autorização Fênix.

Para jogadores, uma entidade só pode aparecer se houver uma futura revelação explícita/autorizada. Estatísticas de criatura e notas do GM não são expostas só porque a página contém um link.

HTML do Foundry é armazenado como origem do Journal, mas não é executado. O grafo usa texto sem tags/scripts para recuperação semântica.

## Area → Scene/Region

`proposeAdventureSceneBindings()` continua criando somente propostas. Nenhuma proposta ativa Knowledge por conta própria.

Somente um binding com:

```text
reviewed = true
```

pode ser resolvido por `resolveAcceptedSceneBinding()`.

O Review Workspace passa a exibir a fila `Area → Scene`. O GM pode aceitar ou rejeitar cada associação.

Aceitar um binding não muda:

- background;
- grid;
- Walls;
- Doors;
- Regions;
- Token;
- posição/elevation.

Ele somente autoriza uma relação semântica entre a Scene/Region e uma seção da aventura.

## Runtime Knowledge

`CampaignAdventureKnowledgeResolver` usa a biblioteca semântica da campanha e resolve somente modelos com binding previamente aceito.

### Room entry

Para uma entrada de sala o resolver produz duas visões separadas:

```text
playerContext
  └─ somente chunks player-safe/revelados

gmContext
  ├─ chunks da Area
  └─ entidades relacionadas da Area
```

A `source` canônica usada para narração é criada somente se existir um `read-aloud` player-safe. Assim, um NPC secreto pode estar disponível ao raciocínio do Mestre Fênix sem aparecer na âncora narrada ao jogador.

### Ações

Em ações de jogador, o runtime consulta o resolver usando a Scene ativa e o texto da ação. O `NarrationContextBuilder` recebe os chunks e entidades relevantes para a Area já vinculada.

A autoridade permanece separada:

```text
Scene/Core/RPG System = estado físico e regras
Knowledge Engine      = fatos importados/relevantes
Mestre Fênix          = interpretação e narração
```

## Bridge preparado

`createContentSyncEnvelope()` cria o contrato `fenix.bridge-content-sync` v1 com metadados do mundo/sistema, Journal raiz e entidades. Ele não resolve UUID nem abre conexão com Foundry neste marco.

## Limitações v1.4

- não há sincronização ao vivo com `fromUuid()`;
- não há promoção automática de Actor/Item do Foundry para Actor/Item nativo do Fênix;
- Compendium e UUID externos são preservados, mas não buscados na internet;
- ownership Foundry não substitui RBAC da campanha Fênix;
- o grafo inicial trabalha com relações explícitas/embutidas, não tenta inferir relações ocultas por IA;
- a Scene continua sendo autoridade física.

## Próximo marco recomendado

**Content Importer v1.5 — Foundry Bridge Sync & Native Entity Promotion**

Objetivos:

1. Bridge Foundry capaz de resolver UUIDs no mundo autorizado;
2. sincronização diferencial por `sourceUuid` + `sourceHash`;
3. Conflict Review para `changed/removed`;
4. promoção GM-reviewed de Actor/Item para entidades nativas Fênix;
5. Rules Adapter decidir o que pode virar Sheet nativa sem acoplar o Content Importer ao D&D5e;
6. re-sync sem duplicar entidades ou apagar alterações locais silenciosamente.
