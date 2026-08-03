# Privacidade e tratamento de dados

## Dados locais

Memórias, documentos importados, conteúdo gerado, mapas, perfis, tutores, automações e backups ficam no diretório `data/` do Engine. Esses arquivos não entram no Git nem nos pacotes de release.

## Provedores externos

Ao usar IA ou voz neural, trechos necessários da campanha podem ser enviados ao provedor configurado. O mestre deve revisar os termos e a política do serviço escolhido. Desative provedores externos para manter o processamento textual local, sabendo que algumas funções ficarão indisponíveis.

## Minimização

- Snapshots de ficha são curados e limitados.
- Documentos originais importados não são preservados pela Biblioteca.
- Logs redigem campos de autenticação e credenciais.
- A telemetria de diagnóstico fica em memória e possui retenção limitada.
- Backups removem campos com aparência de segredo antes da exportação.

## Responsabilidade do operador

O operador controla armazenamento, acesso ao servidor, backups e compartilhamento de relatórios. Não publique `.env`, `data/`, `.mobackup` ou relatórios contendo nomes privados.
