# Segurança

## Dados sensíveis

Nunca registre ou envie chaves de API, conteúdo do arquivo `.env` ou dados privados de campanhas. Use `.env.example` apenas como modelo e mantenha segredos no ambiente da plataforma de hospedagem.

## Relato responsável

Relate vulnerabilidades de forma privada ao mantenedor, incluindo versão afetada, impacto e passos mínimos de reprodução. Não publique chaves, dados de jogadores ou conteúdo reservado do mestre.

## Versões suportadas

Enquanto o projeto estiver em fase alfa, somente a versão mais recente recebe correções de segurança.

## Importação de documentos

- Importe somente arquivos de origem confiável. O Engine não executa macros, scripts ou conteúdo incorporado.
- Os arquivos originais não são preservados; o Engine guarda apenas texto extraído e metadados.
- O limite é 12 MB por arquivo e formatos não reconhecidos são rejeitados.
- O modo padrão é `REFERENCE_ONLY`; revise um documento antes de permitir uso narrativo.
- PDFs digitalizados devem passar por OCR fora do Engine.
