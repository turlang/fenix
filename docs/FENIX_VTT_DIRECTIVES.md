# Fênix VTT — Diretrizes de Produto

## 1. Referência de UX
O Foundry VTT é a principal referência de ergonomia do Fênix: canvas dominante, uma camada ativa por vez, Scene Controls à esquerda, paleta contextual, edição direta no mapa e inspectors apenas quando necessários.

A referência é de modelo mental e fluxo. O Fênix não copia código, assets, marca ou arquitetura modular do Foundry.

## 2. Extensibilidade sem modularidade excessiva
O Fênix evolui por capacidades internas. Novas ferramentas devem entrar em uma camada existente ou registrar uma nova camada no Scene Controls. Adicionar uma feature não pode significar adicionar mais um HUD permanente sobre o mapa.

Cada capacidade deve declarar: id, camada, ferramenta padrão, ferramentas contextuais, permissões, inspector opcional e atalhos opcionais.

## 3. Contrato visual
Controles do canvas ocupam zonas exclusivas e não podem se sobrepor:
- esquerda: rail de camadas;
- ao lado: paleta contextual;
- terceira coluna: inspector, quando necessário;
- topo direito: câmera/zoom;
- base direita: diagnóstico técnico discreto;
- centro: mapa, tokens e overlays da camada ativa.

Informação duplicada deve ser removida. Diagnósticos técnicos nunca têm prioridade visual sobre o jogo.

## 4. Diferencial do produto
O diferencial do Fênix é o Mestre IA, não o conjunto de botões do VTT.

A IA deve evoluir para perceber cena, tokens, salas, paredes, luz, Fog, elevação, NPCs, Journal autorizado e histórico recente; decidir quando narrar, esperar, pedir rolagem, interpretar NPC, resolver consequência ou permanecer em silêncio; e narrar com ritmo, emoção, continuidade, variação e respeito à agência dos jogadores.

Texto e voz formam uma única experiência. O TTS deve ser tratado como performance narrativa, não apenas leitura.

## 5. Regra de produto
Sempre que o Engine já possuir informação suficiente para automatizar uma tarefa, evitar criar mais um formulário para o Mestre durante a sessão. Configuração complexa pertence ao preparo; durante o jogo, a operação deve ser mínima.

## 6. Prioridade
1. confiabilidade da sessão;
2. ergonomia básica de VTT;
3. percepção contextual do Mestre IA;
4. decisão e narrativa;
5. voz/performance;
6. automação do trabalho do Mestre;
7. recursos táticos avançados.
