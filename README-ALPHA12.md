# Mestre Orc Engine — 0.1.0-alpha.12

## Interpretação narrativa e antirrepetição

Esta versão transforma o bloco `read-aloud` em uma âncora canônica, não em texto final.

Fluxo:

1. O módulo encontra a Scene e o Journal correspondente.
2. O adaptador extrai somente `.ve-rd__b-inset--readaloud`.
3. `SceneOpeningContextBuilder` preserva área, seção e modo de extração.
4. `OpeningNarrativePlanner` escolhe foco, tom, ritmo, entrada e perspectiva ainda não usados.
5. A Groq interpreta e enriquece a cena sem copiar literalmente nem revelar fatos ocultos.
6. `NoveltyGuard` compara a nova abertura com o histórico da mesma cena.
7. Uma versão semelhante é rejeitada e gerada novamente, até quatro tentativas.
8. A versão aprovada é gravada em `data/narration-history.json`.

A identidade usada para comparação combina a cena normalizada e a área, por exemplo:

`cragmaw-hideout:1-cave-mouth`

Por isso, a memória continua protegendo a variedade mesmo quando a mesma cena é usada em outro mundo ou campanha.

## Variável opcional

```env
MESTRE_ORC_NARRATION_MEMORY_FILE=./data/narration-history.json
```

## Validação

```powershell
npm install
npm test
npm run validate
npm run dev
```
