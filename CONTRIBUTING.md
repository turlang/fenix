# Contribuição

1. Use Node.js entre as versões 20 e 24.
2. Crie uma branch curta e mantenha cada alteração com um único propósito.
3. Preserve o pipeline: captura, intenção, regras, narração e publicação.
4. Dados vindos de Foundry, PDF, DOCX ou qualquer fonte externa devem passar por adapter/normalização antes de chegar ao Core, Knowledge Engine ou `NarrationContextBuilder`.
5. Todo trabalho de importação, compilação semântica, tradução/localização e ingestão de aventuras deve obedecer a `docs/FENIX_CONTENT_IMPORT_LOCALIZATION.md`.
6. Preserve sempre a fonte original e sua proveniência. Localização é uma camada derivada e não pode substituir destrutivamente o conteúdo original.
7. Tradução e narração não podem alterar fatos mecânicos estruturados como DC/CD, quantidades, estatísticas, distâncias, IDs, referências de área, nomes próprios ou condições de regra.
8. Conteúdo secreto/GM-only e descobertas condicionais precisam manter política explícita de revelação; a IA não pode transformar informação não elegível em conteúdo do jogador.
9. Não copie código de terceiros sem licença compatível e não versione/redistribua conteúdo protegido que o projeto não esteja autorizado a distribuir.
10. Não acople serviços diretamente ao `SessionDirector`; injete dependências.
11. Execute `npm ci` e `npm run check` antes de enviar mudanças.
12. Inclua testes para correções e novos comportamentos.

Use mensagens de commit objetivas e não inclua segredos, dependências instaladas ou dados gerados.
