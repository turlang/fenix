# Fênix VTT — Fronteiras de Mapa, Token, Ficha e Regras

## Objetivo

Eliminar a mistura de responsabilidades na superfície de jogo e no modelo de domínio. O Fênix VTT deve permitir que cada ferramenta cresça sem transformar o mapa em um painel técnico ou usar o token como atalho para todos os dados do personagem.

## 1. Mapa / Cena

A cena descreve o ambiente físico e visual. Ela não decide regras do personagem.

Responsabilidades da cena:

- imagem/background do mapa;
- dimensões e viewport;
- grade e sua calibração em pixels;
- escala física da grade (`distancePerCell` + unidade);
- paredes e portas;
- pisos, escadas, rampas e regiões;
- elevação/níveis e altura física das barreiras;
- luz ambiente e fontes de luz do cenário;
- Fog of War como memória espacial;
- terreno/regiões que podem ser consultados pelo sistema de regras;
- notas/zonas/salas para contexto narrativo.

A escala padrão do Fênix pode ser `1 célula = 1,5 m`, mas isso é uma propriedade física configurável da cena, não uma regra fixa do motor. Uma cena pode usar `5 ft`, `1 m`, `2 m` etc.

## 2. Token

Token é uma entidade visual persistente que representa algo na cena. O token não é a ficha.

Contrato mínimo:

- `tokenId`: identidade da instância visual;
- `actorId`: personagem/NPC/criatura representado;
- `sheetId`: ficha associada;
- `systemId`: sistema de RPG responsável pela interpretação da ficha;
- tipo da entidade;
- nome/imagem/footprint;
- posição da instância na cena (`x`, `y`, `elevation`, rotação, visibilidade).

Compatibilidade temporária: tokens antigos podem usar `actorId = tokenId` e `sheetId = actorId` até a migração ser concluída.

## 3. Ficha / Ator

A ficha é a fonte de dados do personagem. O mapa não deve armazenar estes atributos.

Exemplos:

- atributos e perícias;
- tamanho;
- sentidos;
- deslocamentos disponíveis;
- condições;
- recursos e estados;
- inventário/carga;
- características que modificam visão ou movimento.

O Fênix deve permitir múltiplos tokens representando o mesmo `actorId` quando o sistema/campanha precisar disso, sem duplicar a ficha.

## 4. Sistema de RPG

O sistema interpreta a ficha e resolve as regras efetivas.

O contrato de regras deve responder, entre outras coisas:

- quanto o ator pode se mover;
- quais modos de movimento estão disponíveis;
- custo de terreno;
- custo diagonal;
- corrida/dash;
- marcha/viagem;
- natação;
- voo;
- escalada;
- escavação quando aplicável;
- alcance e tipo de visão;
- footprint/tamanho efetivo;
- modificadores e restrições por condição.

O mapa apenas informa distância física, obstáculos e regiões. O sistema converte a capacidade do ator em células permitidas.

Exemplo:

```text
Ficha informa deslocamento = 9 m
       ↓
Sistema resolve modo atual = caminhada
       ↓
Cena informa 1 célula = 1,5 m
       ↓
Orçamento do turno = 6 células
```

## 5. Mestre Fênix

O Mestre Fênix consulta as camadas, mas não substitui a autoridade delas.

Ele pode usar:

- cena e região atual;
- ficha do ator;
- regras resolvidas pelo sistema;
- visibilidade efetiva;
- histórico narrativo e estado do mundo.

Com isso ele pode narrar o que o personagem realmente percebe e interpretar consequências sem inventar capacidades físicas.

## 6. Organização da interface

A superfície principal deve funcionar por contexto, não exibir todas as ferramentas ao mesmo tempo.

### Modo Mapa

Ferramentas do ambiente:

- câmera/pan;
- grade e escala;
- paredes;
- portas;
- pisos/regiões;
- escadas/rampas;
- altura/níveis;
- luz;
- Fog;
- notas/zonas.

### Modo Tokens

Ferramentas das entidades:

- selecionar/mover;
- criar/remover token;
- vincular ficha;
- representar ator;
- tamanho/footprint;
- visibilidade administrativa;
- acesso à ficha;
- estado de movimento atual.

### Modo Personagem / Ficha

Dados do ator, de acordo com o sistema instalado/configurado para a campanha.

### Diagnóstico

WebSocket, renderer, guards, revision, pipeline e telemetria não pertencem à superfície principal. Devem ficar em diagnóstico/admin.

## 7. Recuperação das branches avançadas

As branches anteriores já possuem capacidades que devem ser reaproveitadas seletivamente:

- `feature/fenix-vtt-advanced-vision` — visão por ator;
- `feature/fenix-vtt-elevation-levels` — elevação, níveis e voo autoritativo;
- `feature/fenix-vtt-floor-regions-transitions` — piso, escada, rampa e transições.

Elas não devem ser mescladas integralmente sobre o `main` atual porque as linhas divergiram. O código será portado por domínio para preservar o shell atual e as correções recentes.

## 8. Regra arquitetural

```text
Mapa/Cena ────────┐
                  ├─> Resolução física/regras ─> Realtime
Ficha/Ator ───────┤
                  │
Sistema RPG ──────┘

Token = vínculo + representação + posição
Mestre Fênix = consumidor contextual das respostas acima
```

Nenhum módulo de UI deve usar `tokenId` como substituto permanente de `actorId` ou `sheetId`.
