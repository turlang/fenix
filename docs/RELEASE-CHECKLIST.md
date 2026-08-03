# Checklist de Release Candidate

## Código e testes

- [x] Versões sincronizadas entre Engine, lockfile e módulo.
- [x] Testes unitários, integração, sessão e carga.
- [x] Gate `rc:audit` sem falhas.
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
- [x] Instalação física inicial no Windows.
- [x] Módulo, Engine, Central e Diagnóstico validados no Foundry VTT 13.351.
- [ ] Revisão visual completa de todos os painéis e fluxos.
- [ ] Sessão real com GM e pelo menos dois jogadores.

Os itens pendentes pertencem ao Marco 13 e bloqueiam a versão estável `1.0.0`, mas não a publicação de `1.0.0-rc.3`.
