# Content Importer v1.6 — Sync Review UX & System-Native Mapping

## Objetivo

O v1.6 transforma a sincronização diferencial do Foundry, introduzida no v1.5, em um fluxo operacional dentro do Review Workspace do Fênix e adiciona uma camada explícita de transformação para entidades nativas do sistema da campanha.

A regra arquitetural permanece: **importação transforma dados; o RPG System Adapter resolve regras em runtime**.

## Review Workspace

Quando um Adventure Model possui `fenix.foundry-sync-state`, o Mestre passa a visualizar diferenças do Bridge dentro do próprio Importador:

- lista de entidades alteradas, removidas ou em conflito;
- comparação lado a lado `Foundry · fonte` e `Fênix · nativo`;
- hashes de origem abreviados como evidência de revisão;
- campos mecânicos normalizados exibidos semanticamente, sem executar HTML do Foundry;
- identificação de Actor/Item nativo já vinculado;
- identificação do mapper usado na promoção.

Conflitos continuam fail-closed. Para `SOURCE_AND_NATIVE_CHANGED`, o Mestre escolhe `keep-local`, `accept-source` ou `detach`. Para `SOURCE_REMOVED_NATIVE_PRESERVED`, aceitar a fonte continua bloqueado: remoção no Foundry não autoriza apagar conteúdo nativo.

Uma alteração apenas do lado Foundry não é aplicada silenciosamente a uma entidade promovida. A UI oferece ação explícita para reaplicar a entidade importada usando o mesmo pipeline de promoção do backend.

## Promoção nativa

Actor/NPC, Item e Spell ainda presentes no Entity Graph e sem promoção aparecem em uma fila própria. A promoção é sempre iniciada pelo Mestre e utiliza o serviço nativo correspondente:

- Actor/NPC → `CampaignActorService`;
- Item/Spell → `CampaignItemService`.

A identidade Foundry permanece em `sourceUuid`/`sourceHash` e os IDs nativos continuam separados.

## System-Native Mapping

O pacote `system-native-mapping.js` define adapters de transformação independentes do runtime de regras.

### D&D 5e v1

O mapper `fenix-dnd5e-import-v1` usa somente fatos já normalizados pelo Entity Graph. Quando presentes, pode transportar:

- HP/PV;
- AC/CA;
- CR/ND;
- tipo de criatura;
- velocidades `walk`, `fly`, `swim`, `climb` e `burrow`;
- sentidos normalizados;
- nível e escola de Spell.

Campos ausentes não são inventados. O mapper não calcula testes, movimento efetivo, diagonal, terreno, combate, visão final ou qualquer outra regra de sistema.

### Fallback genérico

Sistemas ainda sem mapper dedicado usam `fenix-generic-import-v1`. O fallback preserva os fatos disponíveis e registra um warning de mapeamento genérico em vez de inferir mecânicas desconhecidas.

## Evidência e proveniência

Cada promoção pode carregar `fenix.system-native-mapping` v1 com:

- `mapperId`;
- `sourceSystemId`;
- `targetSystemId`;
- campos mapeados;
- campos não mapeados;
- warnings.

`fenix.native-entity-promotions` passa à versão 2 e declara explicitamente `systemMappingIsNotRulesAuthority: true`.

## Guardrails

- operações permanecem GM-only pelas rotas autenticadas existentes;
- nenhum HTML importado é executado;
- conflito não faz overwrite automático;
- remoção na origem não apaga Actor/Item nativo;
- o Core não depende de Foundry;
- o mapper não substitui o RPG Rules Contract;
- UUIDs continuam escapados/encodados no cliente antes de compor rotas;
- a UI exibe dados sem transformar o browser em autoridade de sync.

## Limites do v1.6

O marco não afirma validação física contra uma instância Foundry real. O Bridge e o fluxo de revisão são testados com fixtures sintéticas no CI hospedado.

Também permanecem fora deste marco:

- cobertura nativa de RollTable;
- resolução/download automático de Compendium externo;
- mapeamento completo de todas as estruturas internas do dnd5e;
- sync automático em background;
- qualquer migração das regras de jogo para o importador.

## Próximo marco sugerido

**Content Importer v1.7 — Live Foundry Validation & Entity Coverage**

Objetivos: validar o Bridge numa instância Foundry real, cobrir o ciclo UUID → sync → review → promoção de ponta a ponta, ampliar Item/Spell/RollTable de forma clean-room e registrar evidência operacional de compatibilidade Foundry v13/dnd5e 5.x sem copiar código ou corpus de terceiros.
