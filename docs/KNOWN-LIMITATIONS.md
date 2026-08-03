# Limitações conhecidas do Release Candidate

- A instalação física e a validação inicial da Central/Diagnóstico no Foundry VTT 13.351 foram concluídas; a sessão com múltiplos clientes e a revisão completa dos painéis permanecem pendentes.
- Reconhecimento de voz depende da implementação do navegador e pode não existir em todos os clientes.
- PDFs digitalizados precisam de OCR externo.
- Mapas gerados são plantas vetoriais funcionais, não arte final ilustrada.
- O Engine não substitui decisões do mestre nem valida todas as regras de todos os sistemas.
- A segurança por token protege o serviço de acesso externo, mas não é um sistema completo de identidade individual por jogador.
- O módulo principal ainda concentra parte relevante da integração Foundry em `main.js`; a divisão adicional será avaliada após a validação real para evitar regressões antes do RC.
- Os scripts PowerShell já foram usados na instalação inicial do RC; atualização, rollback e cenários de falha ainda precisam de uma rodada completa no Windows antes da versão estável.
- O `browser-tts` depende das vozes expostas pelo Windows ao Chromium do Foundry. A suavização do RC.3 reduz o efeito robótico, mas uma voz neural externa continua oferecendo maior naturalidade.
- O `npm audit` depende do acesso ao registro npm; o gate offline verifica lockfile, versões mínimas críticas, segredos, configuração e estrutura.
