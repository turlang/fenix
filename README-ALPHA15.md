# Mestre Orc 0.1.0-alpha.15

Controle de qualidade da abertura narrativa.

## Mudanças

- Novo `NarrationQualityGuard` executado antes do `NoveltyGuard`.
- Aberturas devem ter 2 ou 3 parágrafos e de 80 a 150 palavras antes da pergunta final.
- Narrações excessivamente longas, muito curtas ou com mais de quatro parágrafos são recusadas.
- O Engine rejeita controle de pensamentos, emoções, olhares, expectativas e ações dos personagens jogadores.
- O Engine detecta especulação não canônica, como “como se”, “parece esconder”, presságios, segredos e ameaças não confirmadas.
- Detalhes ambientais não presentes na caixa read-aloud, como chuva, vento, névoa, musgo, aromas, vozes e pegadas, são bloqueados.
- Elementos canônicos repetidos excessivamente e inícios de frase duplicados provocam uma nova tentativa.
- As falhas de qualidade das tentativas anteriores são devolvidas à Groq para orientar a reescrita.
- O histórico passa a registrar métricas e resultado do controle de qualidade junto do fingerprint de novidade.

## Fluxo

```text
Read-aloud
→ Groq interpreta
→ SafetyGuard
→ NarrationQualityGuard
→ NoveltyGuard
→ memória
→ chat do Foundry
```

## Instalação

Preserve `.env` e `data/narration-history.json` ao substituir o projeto. Depois execute:

```powershell
npm install
npm test
npm run dev
```

Confirme `0.1.0-alpha.15` em `http://localhost:3001/health` e no gerenciador de módulos do Foundry.
