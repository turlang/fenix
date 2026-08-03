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

## Conteúdo gerado

- Resultados da Forja são arquivados antes de qualquer integração com a campanha.
- Revise aventuras, NPCs e dungeons antes de ativá-los; a IA pode produzir inconsistências mesmo quando o formato é válido.
- Aventuras e dungeons são ativadas como `REFERENCE_ONLY`, e NPCs como memória `secret`, reduzindo risco de spoilers.
- O bloqueio de repetição combina histórico enviado ao provedor, assinatura SHA-256 e similaridade lexical local.
- Não use a Forja para copiar aventuras comerciais, personagens protegidos ou material sem autorização.
- `data/generated-content.json` pode conter segredos completos da campanha e deve permanecer fora do Git, backups públicos e logs.


## Mapas gerados e Scenes

- Plantas persistentes ficam em `data/map-blueprints.json`, fora do Git e das entregas.
- A API não expõe campos `secret` na listagem resumida; detalhes completos são destinados ao painel do mestre.
- A criação da Scene é iniciada somente por usuário GM dentro do Foundry.
- SVGs são gerados pelo Engine a partir de dados normalizados; texto é escapado antes de entrar no XML.
- A exclusão do registro da planta não apaga arquivos ou documentos do mundo automaticamente.
- O módulo não cria tokens, inimigos, armadilhas ativas ou resultados mecânicos sem ação explícita do mestre.


## Tutores contextuais

- O Tutor de Ficha recebe somente um snapshot curado e limitado da ficha; nunca envie o documento bruto, chaves, cookies ou credenciais.
- Jogadores devem consultar apenas fichas próprias. A interface verifica ownership e a API exige os campos de acesso correspondentes.
- O Tutor de Mestre pode acessar segredos e trechos `GM_ONLY`; suas respostas não devem ser publicadas aos jogadores sem revisão.
- Os tutores são consultivos e não possuem endpoints para alterar fichas, Scenes, Journals, memória ou combate.
- IDs de fontes retornados pela IA são aceitos somente quando existem no conjunto de fatos ou referências fornecido.
- `data/tutor-history.json` pode conter perguntas, respostas e nomes de personagens. Mantenha-o fora do Git, logs públicos e backups compartilhados.
- A API local atual não substitui autenticação de rede. Em exposição remota, use proxy autenticado, TLS e controle de origem.


## Automações aprovadas

- A IA e a API apenas criam propostas. A execução ocorre exclusivamente no Foundry de um usuário GM após aprovação e confirmação separadas.
- A allowlist não aceita código, macros, comandos de console, exclusão de mundo, alteração de ownership ou caminhos arbitrários.
- Mudanças numéricas de ficha são limitadas a PV, exaustão, recursos e moeda, com Actor, caminho e valor explícitos.
- Cada execução produz um recibo mínimo para reversão. O recibo não deve conter credenciais, cookies ou dados desnecessários.
- Antes de remover um documento, a reversão confirma que ele ainda possui a marca da proposta original. Recursos numéricos só voltam ao valor anterior quando o valor atual ainda coincide com o aplicado pela automação.
- Revisões e tokens temporários reduzem risco de duplo clique, concorrência e resultado atribuído à proposta errada.
- Mensagens públicas propostas pela IA devem ser revisadas para impedir spoilers; segredos devem permanecer em Journals privados.
- `data/automation-proposals.json` pode conter decisões, mensagens, IDs e valores anteriores da campanha. Mantenha-o fora do Git, logs e backups públicos.
- A API local não autentica usuários de rede por conta própria. Não a exponha diretamente à internet; use TLS, proxy autenticado e controle de origem.
