# Limitações conhecidas da versão 1.0.0

- Reconhecimento de voz depende da implementação do navegador e pode não existir em todos os clientes.
- PDFs digitalizados precisam de OCR externo.
- Mapas gerados são plantas vetoriais funcionais, não arte final ilustrada.
- O Engine não substitui decisões do mestre nem valida todas as regras de todos os sistemas.
- A segurança por token protege o serviço de acesso externo, mas não é um sistema completo de identidade individual por jogador.
- O módulo principal ainda concentra parte relevante da integração Foundry em `main.js`; uma divisão adicional poderá ser feita em versão futura com testes de regressão específicos.
- O `browser-tts` depende das vozes expostas pelo Windows ao Chromium do Foundry. A suavização reduz o efeito robótico, mas uma voz neural externa continua oferecendo maior naturalidade.
- A qualidade da narração depende do modelo, do contexto disponível e das configurações do provedor de IA.
- O `npm audit` depende do acesso ao registro npm; o gate offline verifica lockfile, versões mínimas críticas, segredos, configuração e estrutura.
