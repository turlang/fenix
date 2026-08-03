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

## Voz neural

- Chaves de ElevenLabs, OpenAI e endpoints compatíveis devem existir somente no ambiente da API. O módulo Foundry nunca precisa receber essas credenciais.
- O endpoint de síntese retorna áudio e metadados sanitizados; mensagens brutas dos provedores e cabeçalhos de autenticação não são repassados aos clientes.
- O cache é temporário, limitado e indexado pelo texto e pelo perfil. Arquivos de áudio não são gravados na biblioteca da campanha.
- O projeto não cria, treina nem clona vozes e não aceita upload de amostras biométricas de voz.
- Use somente voice IDs e serviços para os quais você tenha autorização. A interface identifica a saída neural como voz gerada por inteligência artificial.
- `data/voice-profiles.json` pode conter nomes e instruções narrativas da campanha; mantenha esse arquivo fora do Git e das entregas públicas.
