function clean(value, max = 300) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function major(value) {
  const match = clean(value, 80).match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function booleanMap(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.freeze(Object.fromEntries(Object.entries(source).slice(0, 64).map(([key, value]) => [clean(key, 80), value === true])));
}

function checksList(input = []) {
  return Object.freeze((Array.isArray(input) ? input : []).slice(0, 64).map((entry) => Object.freeze({
    id: clean(entry?.id, 100),
    ok: entry?.ok === true,
    detail: clean(entry?.detail, 300) || null
  })).filter((entry) => entry.id));
}

export function buildFoundryCompatibilityReport(envelope = {}) {
  const source = envelope?.source ?? {};
  const evidence = envelope?.compatibility ?? {};
  const coreVersion = clean(evidence.coreVersion ?? source.coreVersion, 100) || null;
  const systemId = clean(evidence.systemId ?? source.systemId, 120) || null;
  const systemVersion = clean(evidence.systemVersion ?? source.systemVersion, 100) || null;
  const coreMajor = major(coreVersion);
  const systemMajor = major(systemVersion);
  const sourceIsFoundry = clean(source.adapter, 80) === 'foundry';
  const expectedCore = coreMajor === 13;
  const expectedSystem = systemId === 'dnd5e' && systemMajor === 5;
  const capabilities = booleanMap(evidence.capabilities);
  const checks = checksList(evidence.checks);
  const requiredChecks = ['fromUuid', 'journalResolved', 'journalSerialized'];
  const checksById = new Map(checks.map((entry) => [entry.id, entry]));
  const bridgeOperational = requiredChecks.every((id) => checksById.get(id)?.ok === true);
  const entityCoverage = Object.freeze({
    actor: capabilities.actor === true,
    item: capabilities.item === true,
    rollTable: capabilities.rollTable === true
  });
  const status = !sourceIsFoundry
    ? 'invalid-source'
    : expectedCore && expectedSystem && bridgeOperational
      ? 'reported-compatible'
      : expectedCore && systemId && systemId !== 'dnd5e'
        ? 'reported-untested-system'
        : coreVersion || systemVersion
          ? 'reported-outside-target'
          : 'insufficient-evidence';

  return Object.freeze({
    schema: 'fenix.foundry-compatibility-report',
    version: 1,
    status,
    target: Object.freeze({ coreMajor: 13, systemId: 'dnd5e', systemMajor: 5 }),
    observed: Object.freeze({ coreVersion, coreMajor, systemId, systemVersion, systemMajor }),
    capabilities,
    checks,
    entityCoverage,
    bridgeOperational,
    evidenceSource: evidence.schema === 'fenix.foundry-live-evidence' ? 'bridge-runtime-report' : 'bridge-source-metadata',
    evidenceGeneratedAt: clean(evidence.generatedAt ?? source.generatedAt, 100) || null,
    physicalValidation: Object.freeze({
      performedByHostedCi: false,
      confirmed: false,
      note: 'Este relatório registra evidência declarada pelo runtime Foundry. Validação física humana/ambiente real deve ser registrada separadamente.'
    })
  });
}

export function assertFoundryCompatibilityEnvelope(envelope = {}) {
  if (envelope?.schema !== 'fenix.bridge-content-sync' || Number(envelope?.version) < 2) {
    const error = new Error('Envelope do Foundry Bridge v2+ é obrigatório.');
    error.code = 'FENIX_FOUNDRY_SYNC_ENVELOPE_INVALID';
    throw error;
  }
  if (envelope?.source?.adapter !== 'foundry') {
    const error = new Error('A origem do envelope deve ser Foundry.');
    error.code = 'FENIX_FOUNDRY_SYNC_SOURCE_INVALID';
    throw error;
  }
  return buildFoundryCompatibilityReport(envelope);
}
