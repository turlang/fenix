# Mestre Orc Engine 0.1.0-alpha.13

## Hotfix do NoveltyGuard

Esta versão corrige o bloqueio da abertura quando várias narrações preservam os mesmos fatos canônicos.

### Mudanças

- Similaridade calculada principalmente por frases, aberturas, n-gramas e estrutura narrativa.
- Termos canônicos comuns da cena têm peso reduzido.
- O encerramento fixo `O que vocês fazem?` não entra na comparação.
- Tentativas rejeitadas na execução atual são enviadas à IA como exemplos a evitar.
- A última tentativa recebe uma instrução de contraste estrutural forte.
- O limite padrão passou para cinco tentativas.
- O NoveltyGuard não bloqueia mais a sessão: se nenhuma tentativa ficar abaixo do limite, a versão menos semelhante é publicada e registrada como `best-effort`.
- Histórico antigo não precisa ser apagado.

### Memória

O arquivo `data/narration-history.json` continua sendo preservado. Novos registros incluem:

- `noveltyStatus`: `accepted` ou `best-effort`;
- `noveltyMode`: `STYLE_ONLY_V2`;
- `similarityToHistory`.
