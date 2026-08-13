# Fênix VTT — Visão Avançada de Personagem

## Objetivo

Adicionar capacidades ópticas individuais por token sem duplicar Fog of War, LOS ou Dynamic Lighting e sem levar responsabilidades gráficas ao Shared Core narrativo.

## Perfil por personagem

Cada cena pode armazenar `visionProfiles` indexados por `actorId`.

Campos normalizados:

- `mode`: `normal`, `darkvision` ou `infravision`;
- `rangeCells`: alcance individual de 1 a 60 células;
- `elevation`: metadado Z de -1000 a 10000, persistido para evolução futura;
- `personalLight.enabled`;
- `personalLight.radiusCells`;
- `personalLight.intensity`;
- `personalLight.color`.

Se um personagem não possui perfil, o alcance configurado no Fog da cena continua sendo o fallback.

## Modos de visão

### Normal

Usa LOS e alcance individual, mas não reduz a escuridão do Dynamic Lighting. A visibilidade prática depende das fontes de luz da cena.

### Darkvision

Mantém exatamente o mesmo LOS de paredes e portas, porém reduz a camada de escuridão dentro do polígono de visão e aplica um tratamento visual frio/desaturado por overlay.

### Infravision

Mantém exatamente o mesmo LOS, reduz de forma mais forte a escuridão dentro do alcance individual e aplica um tratamento visual quente para diferenciar o modo.

Nenhum modo atravessa paredes, portas fechadas ou portas trancadas.

## Fonte pessoal

Uma fonte pessoal é derivada do perfil de visão e convertida em uma fonte de luz temporária anexada ao token. Ela não duplica `scene.lighting.sources` persistido e acompanha a posição realtime do personagem.

A fonte pessoal participa do renderer quando o Dynamic Lighting da cena está ativado.

## Fog e exploração

`CampaignSceneService.recordExploration()` usa `profile.rangeCells` quando o ator possui perfil. Caso contrário usa `fog.visionRangeCells`.

A exploração continua:

- calculada pelo servidor a partir da posição autoritativa do token;
- limitada por paredes/portas;
- persistida por `actorId`;
- indisponível para escrita arbitrária pelo navegador.

## Autorização

Os perfis são enviados pelo mesmo endpoint autenticado de configuração do Fog. Como `CampaignSceneService.updateFog()` exige papel `gm`, jogadores não podem elevar o próprio alcance, trocar o modo ou ativar fonte pessoal pela API.

## Elevação / Z

`elevation` é persistido e validado neste marco para evitar migração destrutiva futura. Ele ainda não altera:

- colisão;
- line of sight;
- sombras;
- alcance horizontal;
- ordenação de tokens.

A próxima evolução pode consumir esse metadado para níveis, escadas, pontes, voo e oclusão vertical.
