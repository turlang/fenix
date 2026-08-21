# Content Importer v1.7 — Live Foundry Validation & Entity Coverage

## Objetivo

O v1.7 amplia a cobertura clean-room do importador Foundry e transforma a futura validação física numa evidência operacional explícita, sem confundir relato do runtime com teste humano realmente executado.

A regra arquitetural continua obrigatória: **o importador transforma e preserva dados; o RPG System Adapter/runtime continua autoridade das regras**.

## Foundry Bridge v3

O Bridge passa a emitir `fenix.bridge-content-sync` v3. O envelope mantém compatibilidade com o backend v2+ e acrescenta `fenix.foundry-live-evidence` v1 com:

- versão do Foundry observada pelo próprio runtime;
- sistema ativo e versão;
- disponibilidade das classes/documentos relevantes;
- checks de `fromUuid()`, resolução do Journal raiz, serialização e crawl limitado;
- tipos de entidades realmente resolvidos durante o crawl;
- timestamp da evidência.

O backend normaliza esses dados em `fenix.foundry-compatibility-report` v1. Para a meta atual, Foundry 13 + dnd5e 5.x + checks mínimos positivos resulta em `reported-compatible`.

`reported-compatible` **não significa validação física concluída**. O relatório declara `physicalValidation.confirmed = false` até que uma instância real seja testada e a evidência externa seja registrada. CI hospedado só valida contratos e fixtures sintéticas.

## Cobertura de entidades

### Item/Spell

O Entity Graph v2 preserva os fatos presentes na fonte sem inventar campos ausentes. Além de nível/escola/quantidade, o adaptador pode transportar, quando existentes:

- activation;
- range;
- target;
- duration;
- uses;
- damage;
- save;
- components/materials/preparation;
- weight/price;
- subtype/itemType.

Esses campos são dados de origem. O importador não calcula CD, ataque, alcance efetivo, custo de ação, dano final ou qualquer regra derivada.

### RollTable

RollTable deixa de ser apenas nó de Knowledge e recebe promoção nativa própria:

- `CampaignRollTableService` persistente por campanha;
- identidade nativa separada do `sourceUuid` Foundry;
- formula, replacement e resultados preservados;
- resultados limitados e sanitizados como dados;
- edição local marca `sourceSync.localModified = true`;
- remoção da fonte nunca apaga a tabela nativa;
- conflito fonte + edição local usa o mesmo fluxo `keep-local`, `accept-source` ou `detach`;
- execução/rolagem da tabela continua responsabilidade do runtime/sistema, não do mapper.

`fenix.native-entity-promotions` passa à versão 3 e explicita `rollTableExecutionIsRuntimeAuthority: true`.

## Segurança e clean-room

- nenhum código de Plutonium/5etools é copiado;
- nenhum corpus de aventura de terceiros é incluído;
- HTML do Foundry continua não executável;
- crawl de UUID continua limitado por quantidade e profundidade;
- operações de catálogo e promoção permanecem GM-only;
- conteúdo removido na origem não autoriza deleção nativa;
- conflitos continuam fail-closed;
- o Core e o RPG Rules Contract não recebem dependência de Foundry.

## Critérios automatizados do marco

O CI deve comprovar com conteúdo sintético:

1. Foundry package → Entity Graph v2 com Item/Spell enriquecido e RollTable com resultados;
2. RollTable → promoção nativa determinística;
3. persistência e detecção de edição local em RollTable;
4. Bridge v3 → envelope limitado + `fenix.foundry-live-evidence`;
5. relatório Foundry 13/dnd5e 5.x como `reported-compatible` sem afirmar validação física;
6. rotas RollTable protegidas pelo mesmo modelo de autenticação GM;
7. RPG Rules Contract continua sem dependência Foundry/RollTable importer.

## Gate físico ainda aberto

Para fechar a parte **Live Foundry Validation** de forma factual, ainda é necessário executar numa instalação real:

1. Foundry VTT 13.351 ou outra versão 13 alvo;
2. dnd5e 5.x;
3. módulo Mestre Orc/Fênix com Bridge v3;
4. UUID real de `JournalEntry` ou `JournalEntryPage`;
5. resolução de Actor, Item/Spell e RollTable referenciados;
6. sync para uma Adventure já importada no Fênix;
7. review de alteração/conflito;
8. promoção nativa;
9. alteração local + nova alteração na fonte para provar conflito;
10. confirmação de que remoção na fonte preserva o conteúdo nativo.

Até esse teste ocorrer, o marco de código pode ser considerado implementado, mas a compatibilidade física permanece **pendente de evidência real**.

## Próximo passo após validação física

**Content Importer v1.8 — Compendium Resolution & Asset Provenance**: resolver referências de Compendium através do Bridge com política explícita, cache/proveniência e limites, sem download arbitrário nem redistribuição de conteúdo protegido.
