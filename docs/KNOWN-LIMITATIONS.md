# Limitações conhecidas do Release Candidate

- A validação visual e funcional em Foundry VTT 13 real, com múltiplos navegadores, permanece pendente no Marco 13.
- Reconhecimento de voz depende da implementação do navegador e pode não existir em todos os clientes.
- PDFs digitalizados precisam de OCR externo.
- Mapas gerados são plantas vetoriais funcionais, não arte final ilustrada.
- O Engine não substitui decisões do mestre nem valida todas as regras de todos os sistemas.
- A segurança por token protege o serviço de acesso externo, mas não é um sistema completo de identidade individual por jogador.
- O módulo principal ainda concentra parte relevante da integração Foundry em `main.js`; a divisão adicional será avaliada após a validação real para evitar regressões antes do RC.
- Scripts PowerShell foram testados estruturalmente e ainda exigem execução física em Windows antes da versão estável.
- O `npm audit` depende do acesso ao registro npm; o gate offline verifica lockfile, versões mínimas críticas, segredos, configuração e estrutura.
