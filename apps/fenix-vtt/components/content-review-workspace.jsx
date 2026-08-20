'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { getPromotedNativeEntity, promoteImportedEntity, resolveFoundrySyncReview } from '../lib/content-sync-client.js';

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function shortHash(value) {
  return value ? String(value).slice(0, 10) : '—';
}

function reviewItems(model) {
  const layout = (model?.review?.items ?? []).map((item) => ({ ...item, queue: 'layout', origin: 'Layout' }));
  const ocr = (model?.ocr?.review?.items ?? []).map((item) => ({ ...item, queue: 'ocr', origin: 'OCR/Vision' }));
  const bindings = (model?.bindingReview?.items ?? []).map((item) => ({
    ...item,
    queue: 'scene-binding',
    origin: 'Area → Scene',
    proposedType: 'knowledge-binding',
    originalText: `${item.sectionTitle} → ${item.target?.regionName || item.target?.sceneName || item.target?.label || item.target?.sceneId}`
  }));
  return [...bindings, ...ocr, ...layout].sort((a, b) => {
    const pending = Number(b.status === 'pending') - Number(a.status === 'pending');
    return pending || (a.source?.page ?? 0) - (b.source?.page ?? 0);
  });
}

function Preview({ item }) {
  if (item?.queue === 'scene-binding') {
    return (
      <div className="content-review-preview-placeholder">
        <strong>{item.sectionTitle}</strong>
        <span>Scene: {item.target?.sceneName || item.target?.sceneId}</span>
        <small>Region: {item.target?.regionName || item.target?.regionId || 'Scene inteira'} · vínculo não altera geometria.</small>
      </div>
    );
  }
  const preview = item?.source?.preview;
  if (preview?.dataUrl) return <img className="content-review-preview-image" src={preview.dataUrl} alt={`Prévia da página ${item.source?.page ?? ''}`} />;
  return (
    <div className="content-review-preview-placeholder">
      <strong>Página {item?.source?.page ?? '—'}</strong>
      <span>{item?.source?.bounds ? `x ${Math.round(item.source.bounds.x)} · y ${Math.round(item.source.bounds.y)}` : 'Sem recorte rasterizado'}</span>
      <small>O provider OCR pode enviar uma miniatura/recorte em `preview.dataUrl`.</small>
    </div>
  );
}

function sourceLabel(entry) {
  if (entry?.source?.type === 'foundry-journal') return entry?.entityGraph ? 'Foundry Package' : 'Foundry Journal';
  if (entry?.ingestion?.extractionMode === 'ocr-vision') return 'PDF · OCR/Vision';
  return 'PDF digital';
}

function scalar(value) {
  if (value == null) return '—';
  if (typeof value === 'object') {
    if (value.value != null && value.max != null) return `${value.value}/${value.max}`;
    if (value.value != null) return String(value.value);
    return JSON.stringify(value);
  }
  return String(value);
}

function entityFacts(node) {
  const facts = node?.facts ?? {};
  const rows = [];
  if (facts.hp != null) rows.push(['PV', scalar(facts.hp)]);
  if (facts.ac != null) rows.push(['CA', scalar(facts.ac)]);
  if (facts.cr != null) rows.push(['ND/CR', scalar(facts.cr)]);
  if (facts.type != null) rows.push(['Tipo', scalar(facts.type)]);
  if (facts.movement && typeof facts.movement === 'object') rows.push(['Movimento', Object.entries(facts.movement).map(([key, value]) => `${key} ${scalar(value)}`).join(' · ')]);
  if (facts.level != null) rows.push(['Nível', scalar(facts.level)]);
  if (facts.school != null) rows.push(['Escola', scalar(facts.school)]);
  return rows.slice(0, 8);
}

function nativeFacts(entity, promotion) {
  if (!entity) return [];
  if (promotion?.nativeType === 'actor') {
    const attrs = entity.sheet?.attributes ?? {};
    const rows = [];
    if (attrs.hp != null) rows.push(['PV', scalar(attrs.hp)]);
    if (attrs.ac != null) rows.push(['CA', scalar(attrs.ac)]);
    if (attrs.cr != null) rows.push(['ND/CR', scalar(attrs.cr)]);
    if (attrs.creatureType != null) rows.push(['Tipo', scalar(attrs.creatureType)]);
    const speeds = entity.sheet?.movement?.speeds ?? entity.sheet?.movement ?? {};
    if (speeds && typeof speeds === 'object' && Object.keys(speeds).length) rows.push(['Movimento', Object.entries(speeds).filter(([, value]) => typeof value !== 'object').map(([key, value]) => `${key} ${scalar(value)}`).join(' · ')]);
    return rows.slice(0, 8);
  }
  const data = entity.data ?? {};
  const rows = [];
  if (data.level != null) rows.push(['Nível', scalar(data.level)]);
  if (data.school != null) rows.push(['Escola', scalar(data.school)]);
  if (data.facts?.quantity != null) rows.push(['Quantidade', scalar(data.facts.quantity)]);
  return rows;
}

function FactRows({ rows }) {
  if (!rows.length) return <small className="content-sync-muted">Sem campos mecânicos mapeados para comparar.</small>;
  return <dl className="content-sync-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function SyncComparison({ syncItem, sourceNode, promotion, nativeEntity, loadingNative, onResolve, onApplySource, busy }) {
  const mapping = promotion?.mapping ?? nativeEntity?.sheet?.metadata?.mapping ?? nativeEntity?.data?.mapping ?? null;
  const conflict = syncItem?.state === 'conflict' && !syncItem?.resolution;
  const canApplySource = Boolean(sourceNode && syncItem?.state !== 'removed' && syncItem?.reason !== 'SOURCE_REMOVED_NATIVE_PRESERVED');
  return (
    <div className={`content-sync-card ${syncItem?.state ?? 'unchanged'}`}>
      <div className="content-sync-card-header">
        <div><span className="eyebrow">Sync Foundry</span><strong>{syncItem?.name || sourceNode?.name || syncItem?.sourceUuid}</strong><small>{syncItem?.sourceUuid}</small></div>
        <span className={`review-status ${syncItem?.state}`}>{syncItem?.resolution || syncItem?.state}</span>
      </div>
      <div className="content-sync-compare">
        <article className="content-sync-side">
          <span className="eyebrow">Foundry · fonte</span>
          <h4>{sourceNode?.name || (syncItem?.state === 'conflict' && !sourceNode ? 'Removido da fonte' : syncItem?.name)}</h4>
          <small>{sourceNode?.kind || syncItem?.kind || 'entidade'} · hash {shortHash(syncItem?.sourceHash)}</small>
          <FactRows rows={entityFacts(sourceNode)} />
        </article>
        <article className="content-sync-side native">
          <span className="eyebrow">Fênix · nativo</span>
          <h4>{loadingNative ? 'Carregando…' : nativeEntity?.name || (promotion ? promotion.nativeId : 'Ainda não promovido')}</h4>
          <small>{promotion ? `${promotion.nativeType} · ${nativeEntity?.systemId || mapping?.targetSystemId || 'sistema da campanha'}` : 'Sem vínculo nativo'}</small>
          <FactRows rows={nativeFacts(nativeEntity, promotion)} />
        </article>
      </div>
      {mapping ? <div className="content-mapping-pill">{mapping.mapperId} · {mapping.sourceSystemId} → {mapping.targetSystemId}</div> : null}
      {syncItem?.reason ? <small className="content-review-safety">{syncItem.reason === 'SOURCE_AND_NATIVE_CHANGED' ? 'A fonte e a entidade nativa mudaram. Nenhum lado será aplicado sem sua decisão.' : syncItem.reason === 'SOURCE_REMOVED_NATIVE_PRESERVED' ? 'A fonte foi removida, mas a entidade nativa foi preservada.' : syncItem.reason}</small> : null}
      <div className="content-sync-actions">
        {syncItem?.state === 'changed' && promotion ? <button type="button" className="primary-button" disabled={busy || !canApplySource} onClick={onApplySource}>Aplicar atualização do Foundry</button> : null}
        {conflict ? (
          <>
            <button type="button" className="ghost-button" disabled={busy} onClick={() => onResolve('keep-local')}>Manter Fênix</button>
            <button type="button" className="primary-button" disabled={busy || !canApplySource} onClick={() => onResolve('accept-source')}>Aceitar Foundry</button>
            <button type="button" className="danger-button" disabled={busy} onClick={() => onResolve('detach')}>Desvincular</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ContentReviewWorkspace({ campaignId, onClose }) {
  const client = useMemo(() => createFenixApiClient(), []);
  const [catalog, setCatalog] = useState({ models: [], storeDriver: null });
  const [model, setModel] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [selectedSyncUuid, setSelectedSyncUuid] = useState(null);
  const [nativeEntity, setNativeEntity] = useState(null);
  const [loadingNative, setLoadingNative] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [importKind, setImportKind] = useState('pdf');

  const items = useMemo(() => reviewItems(model), [model]);
  const mapAssets = useMemo(() => (model?.assets?.extractedImages?.items ?? []).filter((item) => item.mapCandidate), [model]);
  const syncItems = useMemo(() => model?.sync?.items ?? [], [model]);
  const promotions = useMemo(() => model?.nativePromotions?.items ?? [], [model]);
  const promotionByUuid = useMemo(() => new Map(promotions.map((item) => [item.sourceUuid, item])), [promotions]);
  const sourceByUuid = useMemo(() => new Map((model?.entityGraph?.nodes ?? []).map((item) => [item.sourceUuid, item])), [model]);
  const promotable = useMemo(() => (model?.entityGraph?.nodes ?? []).filter((node) => ['actor', 'npc', 'item', 'spell'].includes(node.kind) && !promotionByUuid.has(node.sourceUuid)), [model, promotionByUuid]);
  const selectedSync = useMemo(() => syncItems.find((item) => item.sourceUuid === selectedSyncUuid) ?? syncItems.find((item) => item.state === 'conflict' && !item.resolution) ?? syncItems.find((item) => item.state === 'changed') ?? syncItems[0] ?? null, [syncItems, selectedSyncUuid]);
  const selectedPromotion = selectedSync ? promotionByUuid.get(selectedSync.sourceUuid) ?? null : null;
  const selectedSourceNode = selectedSync ? sourceByUuid.get(selectedSync.sourceUuid) ?? null : null;
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedReviewId) ?? items.find((item) => item.status === 'pending') ?? items[0] ?? null,
    [items, selectedReviewId]
  );

  const refreshCatalog = useCallback(async ({ keepSelection = true } = {}) => {
    const result = await client.listContent(campaignId);
    setCatalog(result);
    if (!keepSelection || !model) return result;
    if (!result.models?.some((entry) => entry.id === model.id)) setModel(null);
    return result;
  }, [campaignId, client, model]);

  const openModel = useCallback(async (adventureId) => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.getContent(campaignId, adventureId);
      setModel(result.model);
      const first = reviewItems(result.model).find((item) => item.status === 'pending') ?? reviewItems(result.model)[0] ?? null;
      const firstSync = result.model?.sync?.items?.find((item) => item.state === 'conflict' && !item.resolution) ?? result.model?.sync?.items?.find((item) => item.state === 'changed') ?? result.model?.sync?.items?.[0] ?? null;
      setSelectedReviewId(first?.id ?? null);
      setSelectedSyncUuid(firstSync?.sourceUuid ?? null);
      setEditedText(first?.originalText ?? '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [campaignId, client]);

  useEffect(() => { void refreshCatalog({ keepSelection: false }).catch((err) => setError(err.message)); }, [refreshCatalog]);
  useEffect(() => {
    if (!selectedItem) { setEditedText(''); return; }
    setEditedText(selectedItem.editedText || selectedItem.originalText || '');
  }, [selectedItem?.id]);
  useEffect(() => {
    let cancelled = false;
    setNativeEntity(null);
    if (!selectedPromotion) return undefined;
    setLoadingNative(true);
    void getPromotedNativeEntity(client, campaignId, selectedPromotion)
      .then((entity) => { if (!cancelled) setNativeEntity(entity); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoadingNative(false); });
    return () => { cancelled = true; };
  }, [campaignId, client, selectedPromotion?.nativeId, selectedPromotion?.nativeType, selectedSync?.sourceUuid]);

  async function handleImport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('sourceFile');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setError(null);
    setImportMessage(importKind === 'foundry' ? 'Compilando pacote do Foundry…' : 'Compilando PDF…');
    try {
      const options = { targetLanguage: String(form.get('targetLanguage') || 'pt-BR'), localize: form.get('localize') === 'on' };
      const result = importKind === 'foundry'
        ? await client.importFoundryJournal(campaignId, file, options)
        : await client.importAdventurePdf(campaignId, file, options);
      setModel(result.model);
      const first = reviewItems(result.model).find((item) => item.status === 'pending') ?? null;
      setSelectedReviewId(first?.id ?? null);
      setSelectedSyncUuid(null);
      setImportMessage(result.model.source?.type === 'foundry-journal'
        ? `Foundry importado · ${result.model.foundry?.pages?.length ?? 0} páginas · ${result.model.entityGraph?.stats?.nodes ?? 0} entidades · UUIDs preservados.`
        : result.model.ingestion?.extractionMode === 'ocr-vision'
          ? 'PDF escaneado compilado via OCR/Vision.'
          : 'PDF digital compilado com assets e layout semântico.');
      await refreshCatalog({ keepSelection: false });
      event.currentTarget.reset();
    } catch (err) {
      setError(err.message);
      setImportMessage(null);
    } finally {
      setBusy(false);
    }
  }

  async function decide(action) {
    if (!selectedItem || selectedItem.status !== 'pending') return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.reviewContent(campaignId, model.id, selectedItem.queue, [{
        reviewId: selectedItem.id,
        action,
        text: selectedItem.queue !== 'scene-binding' && action === 'accept' ? editedText : undefined
      }]);
      setModel(result.model);
      const next = reviewItems(result.model).find((item) => item.status === 'pending') ?? null;
      setSelectedReviewId(next?.id ?? selectedItem.id);
      await refreshCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function promoteMap(image) {
    if (!model || image.status === 'promoted' || !image.campaignAssetId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.promoteContentMap(campaignId, model.id, image.id, { name: `${model.title} · mapa ${image.objectId}`, gridSize: 70 });
      setModel(result.model);
      setImportMessage(`Mapa promovido para a cena “${result.scene.name}”. Revise grid e aceite o vínculo Area → Scene/Region antes da sessão.`);
      await refreshCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function promoteEntity(node) {
    if (!model || !node?.sourceUuid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await promoteImportedEntity(client, campaignId, model.id, node.sourceUuid, { actorType: node.kind === 'actor' ? 'character' : 'npc' });
      setModel(result.model);
      setSelectedSyncUuid(node.sourceUuid);
      setNativeEntity(result.native ?? null);
      setImportMessage(`${node.name || node.sourceUuid} promovido para ${result.promotion.nativeType} nativo do Fênix.`);
      await refreshCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applySourceUpdate() {
    if (!selectedSync || !selectedSourceNode) return;
    setBusy(true);
    setError(null);
    try {
      const result = await promoteImportedEntity(client, campaignId, model.id, selectedSync.sourceUuid, { actorType: selectedSourceNode.kind === 'actor' ? 'character' : 'npc' });
      setModel(result.model);
      setNativeEntity(result.native ?? null);
      setImportMessage(`Atualização do Foundry aplicada à entidade nativa ${result.native?.name || selectedSync.name}.`);
      await refreshCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveSync(action) {
    if (!selectedSync || selectedSync.state !== 'conflict') return;
    setBusy(true);
    setError(null);
    try {
      const result = await resolveFoundrySyncReview(client, campaignId, model.id, selectedSync.sourceUuid, action);
      setModel(result.model);
      const next = result.sync?.items?.find((item) => item.state === 'conflict' && !item.resolution) ?? null;
      setSelectedSyncUuid(next?.sourceUuid ?? selectedSync.sourceUuid);
      setImportMessage(action === 'keep-local' ? 'Alteração local preservada.' : action === 'accept-source' ? 'Versão do Foundry aceita e aplicada.' : 'Entidade nativa desvinculada da fonte Foundry.');
      await refreshCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCurrent() {
    if (!model || !globalThis.confirm?.(`Remover a aventura “${model.title}” desta campanha?`)) return;
    setBusy(true);
    try {
      await client.removeContent(campaignId, model.id);
      setModel(null);
      setSelectedReviewId(null);
      setSelectedSyncUuid(null);
      await refreshCatalog({ keepSelection: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const entityStats = model?.entityGraph?.stats ?? null;
  const syncPending = syncItems.filter((item) => item.state === 'conflict' && !item.resolution).length;

  return (
    <section className="content-review-backdrop" role="dialog" aria-modal="true" aria-label="Importador de aventuras">
      <div className="content-review-workspace">
        <header className="content-review-header">
          <div><span className="eyebrow">Universal Content Importer</span><h2>Revisão de conteúdo</h2></div>
          <div className="content-review-header-actions">
            <span className="content-store-pill">{catalog.storeDriver === 'postgres' ? 'PostgreSQL' : 'Local'}</span>
            <button type="button" className="ghost-button" onClick={onClose}>Fechar</button>
          </div>
        </header>

        <div className="content-review-grid">
          <aside className="content-import-column">
            <form className="content-import-form" onSubmit={handleImport}>
              <span className="eyebrow">Importar</span>
              <div className="scene-source-tabs" role="tablist" aria-label="Origem da aventura">
                <button type="button" className={importKind === 'pdf' ? 'active' : ''} onClick={() => setImportKind('pdf')}>PDF</button>
                <button type="button" className={importKind === 'foundry' ? 'active' : ''} onClick={() => setImportKind('foundry')}>Foundry JSON</button>
              </div>
              <label>{importKind === 'foundry' ? 'Journal/pacote exportado' : 'PDF da aventura'}<input name="sourceFile" type="file" accept={importKind === 'foundry' ? 'application/json,.json' : 'application/pdf,.pdf'} required /></label>
              <label>Idioma da mesa<select name="targetLanguage" defaultValue="pt-BR"><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></select></label>
              <label className="content-checkbox"><input name="localize" type="checkbox" defaultChecked /> Localizar para o idioma da mesa</label>
              <button className="primary-button" disabled={busy}>{busy ? 'Processando…' : 'Compilar conteúdo'}</button>
              <small>{importKind === 'foundry' ? 'Aceita JournalEntry puro ou pacote com Actor/Item/RollTable; preserva UUIDs e mantém detalhes das entidades GM-only.' : 'PDF digital usa texto/layout; scan usa OCR/Vision quando configurado; mapas extraíveis exigem promoção manual.'}</small>
            </form>

            {importMessage ? <div className="content-import-message">{importMessage}</div> : null}
            {error ? <div className="content-review-error" role="alert">{error}</div> : null}

            <div className="content-model-list">
              <div className="content-list-heading"><span className="eyebrow">Campanha</span><strong>{catalog.models?.length ?? 0} aventuras</strong></div>
              {(catalog.models ?? []).map((entry) => (
                <button key={entry.id} type="button" className={`content-model-row ${model?.id === entry.id ? 'active' : ''}`} onClick={() => openModel(entry.id)} disabled={busy}>
                  <strong>{entry.title}</strong>
                  <small>{sourceLabel(entry)} · {(entry.review?.pending ?? 0) + (entry.ocrReview?.pending ?? 0) + (entry.sync?.conflict ?? 0)} pendências</small>
                </button>
              ))}
              {!catalog.models?.length ? <div className="content-empty">Nenhuma aventura compilada nesta campanha.</div> : null}
            </div>
          </aside>

          <main className="content-review-main">
            {model ? (
              <>
                <div className="content-model-summary">
                  <div>
                    <span className="eyebrow">Adventure Model · {sourceLabel(model)}</span>
                    <h3>{model.title}</h3>
                    <small>{model.language?.source || 'und'} → {model.language?.target || model.language?.source || 'und'} · {model.stats?.pages ?? model.foundry?.pages?.length ?? 0} páginas</small>
                    {model.foundry?.journalUuid ? <small className="invite-link-preview">{model.foundry.journalUuid}</small> : null}
                    {entityStats ? <small>{entityStats.actors} atores/NPCs · {entityStats.items} itens · {entityStats.spells} magias · {entityStats.rollTables} tabelas</small> : null}
                  </div>
                  <div className="content-summary-actions"><span>{items.filter((item) => item.status === 'pending').length + syncPending} pendentes</span><button type="button" className="danger-button" onClick={removeCurrent} disabled={busy}>Remover</button></div>
                </div>

                {syncItems.length ? (
                  <section className="content-sync-review-section">
                    <div className="content-sync-heading">
                      <div><span className="eyebrow">Foundry Bridge</span><strong>Revisão de sincronização</strong></div>
                      <small>{model.sync?.summary?.changed ?? 0} alteradas · {model.sync?.summary?.removed ?? 0} removidas · {syncPending} conflitos</small>
                    </div>
                    <div className="content-sync-layout">
                      <nav className="content-sync-list" aria-label="Entidades sincronizadas do Foundry">
                        {syncItems.filter((item) => item.state !== 'unchanged' || item.localChanged).map((item) => (
                          <button key={item.sourceUuid} type="button" className={`content-sync-row ${selectedSync?.sourceUuid === item.sourceUuid ? 'active' : ''} ${item.state}`} onClick={() => setSelectedSyncUuid(item.sourceUuid)}>
                            <span><strong>{item.name}</strong><em>{item.resolution || item.state}</em></span>
                            <small>{item.kind} · {item.promoted ? 'nativo vinculado' : 'somente Knowledge'}</small>
                          </button>
                        ))}
                        {!syncItems.some((item) => item.state !== 'unchanged' || item.localChanged) ? <div className="content-empty">Sync sem diferenças relevantes.</div> : null}
                      </nav>
                      {selectedSync ? <SyncComparison syncItem={selectedSync} sourceNode={selectedSourceNode} promotion={selectedPromotion} nativeEntity={nativeEntity} loadingNative={loadingNative} onResolve={resolveSync} onApplySource={applySourceUpdate} busy={busy} /> : <div className="content-empty">Selecione uma alteração para comparar.</div>}
                    </div>
                    <small className="content-review-safety">Fail-closed: conflito nunca sobrescreve a entidade nativa. Remoção na fonte nunca apaga Actor ou Item do Fênix.</small>
                  </section>
                ) : null}

                {promotable.length ? (
                  <section className="content-entity-promotion-section">
                    <div className="content-sync-heading"><div><span className="eyebrow">Entidades importadas</span><strong>Promoção nativa</strong></div><small>{promotable.length} disponíveis</small></div>
                    <div className="content-entity-promotion-grid">
                      {promotable.slice(0, 24).map((node) => (
                        <article className="identity-card" key={node.sourceUuid}>
                          <strong>{node.name || node.sourceUuid}</strong>
                          <small>{node.kind} · {node.sourceUuid}</small>
                          <FactRows rows={entityFacts(node)} />
                          <button type="button" className="ghost-button" disabled={busy} onClick={() => promoteEntity(node)}>Promover para Fênix</button>
                        </article>
                      ))}
                    </div>
                    <small className="content-review-safety">A promoção usa um mapper do sistema da campanha. O mapper transforma dados; o RPG System Adapter continua sendo a autoridade das regras em runtime.</small>
                  </section>
                ) : null}

                {mapAssets.length ? (
                  <section className="panel-section">
                    <span className="eyebrow">Mapas extraídos do PDF</span>
                    <div className="content-model-list">
                      {mapAssets.map((image) => (
                        <div className="identity-card" key={image.id}>
                          <strong>Imagem {image.objectId} · {image.width}×{image.height}</strong>
                          <small>Confiança de mapa {percentage(image.mapConfidence)} · {image.extraction}</small>
                          <button type="button" className="ghost-button" disabled={busy || !image.campaignAssetId || image.status === 'promoted'} onClick={() => promoteMap(image)}>
                            {image.status === 'promoted' ? 'Scene criada' : image.campaignAssetId ? 'Promover para Scene' : 'Asset indisponível'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <small className="content-review-safety">A promoção cria apenas background + Scene. Grid, Walls, Doors e Regions continuam sob revisão do Mestre.</small>
                  </section>
                ) : null}

                <div className="content-review-body">
                  <nav className="content-review-queue" aria-label="Fila de revisão">
                    {items.map((item) => (
                      <button key={`${item.queue}:${item.id}`} type="button" className={`content-review-item ${selectedItem?.id === item.id ? 'active' : ''} ${item.status}`} onClick={() => setSelectedReviewId(item.id)}>
                        <span><strong>{item.origin}</strong><em>{percentage(item.confidence)}</em></span>
                        <small>p.{item.source?.page ?? '—'} · {item.proposedType}</small>
                        <p>{item.originalText}</p>
                      </button>
                    ))}
                    {!items.length ? <div className="content-empty">Nenhuma revisão semântica necessária. O conteúdo estruturado já está disponível para o Mestre Fênix.</div> : null}
                  </nav>

                  <section className="content-review-editor">
                    {selectedItem ? (
                      <>
                        <div className="content-review-evidence">
                          <div><span className="eyebrow">Evidência</span><strong>{selectedItem.origin} · confiança {percentage(selectedItem.confidence)}</strong></div>
                          <span className={`review-status ${selectedItem.status}`}>{selectedItem.status}</span>
                        </div>
                        <Preview item={selectedItem} />
                        {selectedItem.queue !== 'scene-binding' ? (
                          <label>Texto reconhecido<textarea rows="8" value={editedText} onChange={(event) => setEditedText(event.target.value)} disabled={selectedItem.status !== 'pending' || busy} /></label>
                        ) : <small className="content-review-safety">Aceitar este vínculo habilita o Knowledge Engine/room-entry para esta Area. Não move tokens nem cria geometria.</small>}
                        <div className="content-review-decision-row">
                          <button type="button" className="ghost-button" onClick={() => decide('reject')} disabled={selectedItem.status !== 'pending' || busy}>Rejeitar</button>
                          <button type="button" className="primary-button" onClick={() => decide('accept')} disabled={selectedItem.status !== 'pending' || busy || (selectedItem.queue !== 'scene-binding' && !editedText.trim())}>Aceitar</button>
                        </div>
                        <small className="content-review-safety">Fail-closed: conteúdo ou vínculo pendente nunca é usado automaticamente para jogadores.</small>
                      </>
                    ) : <div className="content-empty large">Sem revisão semântica pendente. Use o painel de sync para diferenças do Foundry ou promova entidades revisadas.</div>}
                  </section>
                </div>
              </>
            ) : <div className="content-empty large">Importe um PDF/Foundry JSON ou escolha uma aventura já compilada.</div>}
          </main>
        </div>
      </div>
    </section>
  );
}
