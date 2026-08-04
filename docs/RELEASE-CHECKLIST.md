# Checklist da versão estável 1.0.0

## Código e testes

- [x] Versões sincronizadas entre Engine, lockfile e módulo.
- [x] Testes unitários, integração, sessão e carga.
- [x] Gate `release:audit` sem falhas.
- [x] SBOM CycloneDX.
- [x] Dependências bloqueadas no lockfile público.
- [x] Segredos e dados locais excluídos.

## Segurança

- [x] Binding local por padrão.
- [x] Token obrigatório por padrão quando exposto em rede.
- [x] CORS por allowlist.
- [x] Rate limit e cabeçalhos defensivos.
- [x] Redação de credenciais nos logs.
- [x] Backups, migrações e rollback.

## Distribuição

- [x] Engine, módulo Foundry e bundle Windows separados.
- [x] Checksums SHA-256 e manifesto.
- [x] Relatório de auditoria e SBOM nos artefatos.
- [x] Instalação física no Windows.
- [x] Módulo, Engine, Central e Diagnóstico validados no Foundry VTT 13.351.
- [x] Groq, microfone, reconhecimento de voz e armazenamento validados.
- [x] Polimento de narração e prosódia local validado no ciclo RC.3.
- [x] Marco 13 aprovado pelo usuário responsável pela validação.

Todos os itens bloqueadores da versão estável foram concluídos.
