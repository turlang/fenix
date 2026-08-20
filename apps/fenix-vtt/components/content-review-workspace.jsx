'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function reviewItems(model) {
  const layout = (model?.review?.items ?? []).map((item) => ({ ...item, queue: 'layout', origin: 'Layout' }));
  const ocr = (model?.ocr?.review?.items ?? []).map((item) => ({ ...item, queue: 'ocr', origin: 'OCR/Vision' }));
  return [...ocr, ...layout].sort((a, b) => {
    const pending = Number(b.status === 'pending') - Number(a.status === 'pending');
    return pending || (a.source?.page ?? 0) - (b.source?.page ?? 0);
  });
}

function Preview({ item }) {
  const preview = item?.source?.preview;
  if (preview?.dataUrl) {
    return <img className="content-review-preview-image" src={preview.dataUrl} alt={`Prévia da página ${item.source?.page ?? ''}`} />;
  }
  return (
    <div className="content-review-preview-placeholder">
      <strong>Página {item?.source?.page ?? '—'}</strong>
      <span>{item?.source?.bounds ? `x ${Math.round(item.source.bounds.x)} · y ${Math.round(item.source.bounds.y)}` : 'Sem recorte rasterizado'}</span>
      <small>O provider OCR pode enviar uma miniatura/recorte em `preview.dataUrl`.</small>
    </div>
  );
}

export function ContentReviewWorkspace({ campaignId, onClose }) {
  const client = useMemo(() => createFenixApiClient(), []);
  const [catalog, setCatalog] = useState({ models: [], storeDriver: null });
  const [model, setModel] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [importMessage, setImportMessage] = useState(null);

  const items = useMemo(() => reviewItems(model), [model]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedReviewId) ?? items.find((item) => item.status === 'pending') ?? items[0] ?? null,
    [items, selectedReviewId]
  );

  const refreshCatalog = useCallback(async ({ keepSelection = true } = {}) => {
    const result = await client.listContent(campaignId);
    setCatalog(result);
    if (!keepSelection || !model) return result;
    const exists = result.models?.some((entry) => entry.id === model.id);
    if (!exists) setModel(null);
    return result;
  }, [campaignId, client, model]);

  const openModel = useCallback(async (adventureId) => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.getContent(campaignId, adventureId);
      setModel(result.model);
      const first = reviewItems(result.model).find((item) => item.status === 'pending') ?? reviewItems(result.model)[0] ?? null;
      setSelectedReviewId(first?.id ?? null);
      setEditedText(first?.originalText ?? '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [campaignId, client]);

  useEffect(() => {
    void refreshCatalog({ keepSelection: false }).catch((err) => setError(err.message));
  }, [refreshCatalog]);

  useEffect(() => {
    if (!selectedItem) {
      setEditedText('');
      return;
    }
    setEditedText(selectedItem.editedText || selectedItem.originalText || '');
  }, [selectedItem?.id]);

  async function handleImport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('pdf');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setError(null);
    setImportMessage('Compilando PDF…');
    try {
      const result = await client.importAdventurePdf(campaignId, file, {
        targetLanguage: String(form.get('targetLanguage') || 'pt-BR'),
        localize: form.get('localize') === 'on'
      });
      setModel(result.model);
      const first = reviewItems(result.model).find((item) => item.status === 'pending') ?? null;
      setSelectedReviewId(first?.id ?? null);
      setImportMessage(result.model.ingestion?.extractionMode === 'ocr-vision'
        ? 'PDF escaneado compilado via OCR/Vision.'
        : 'PDF digital compilado com layout semântico.');
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
        text: action === 'accept' ? editedText : undefined
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

  async function removeCurrent() {
    if (!model || !globalThis.confirm?.(`Remover a aventura “${model.title}” desta campanha?`)) return;
    setBusy(true);
    try {
      await client.removeContent(campaignId, model.id);
      setModel(null);
      setSelectedReviewId(null);
      await refreshCatalog({ keepSelection: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-review-backdrop" role="dialog" aria-modal="true" aria-label="Importador de aventuras">
      <div className="content-review-workspace">
        <header className="content-review-header">
          <div>
            <span className="eyebrow">Universal Content Importer</span>
            <h2>Revisão de conteúdo</h2>
          </div>
          <div className="content-review-header-actions">
            <span className="content-store-pill">{catalog.storeDriver === 'postgres' ? 'PostgreSQL' : 'Local'}</span>
            <button type="button" className="ghost-button" onClick={onClose}>Fechar</button>
          </div>
        </header>

        <div className="content-review-grid">
          <aside className="content-import-column">
            <form className="content-import-form" onSubmit={handleImport}>
              <span className="eyebrow">Importar</span>
              <label>PDF da aventura<input name="pdf" type="file" accept="application/pdf,.pdf" required /></label>
              <label>Idioma da mesa<select name="targetLanguage" defaultValue="pt-BR"><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></select></label>
              <label className="content-checkbox"><input name="localize" type="checkbox" defaultChecked /> Localizar para o idioma da mesa</label>
              <button className="primary-button" disabled={busy}>{busy ? 'Processando…' : 'Compilar PDF'}</button>
              <small>PDF digital usa a camada de texto. PDF escaneado usa OCR/Vision somente se um provider estiver configurado no Engine.</small>
            </form>

            {importMessage ? <div className="content-import-message">{importMessage}</div> : null}
            {error ? <div className="content-review-error" role="alert">{error}</div> : null}

            <div className="content-model-list">
              <div className="content-list-heading"><span className="eyebrow">Campanha</span><strong>{catalog.models?.length ?? 0} aventuras</strong></div>
              {(catalog.models ?? []).map((entry) => (
                <button key={entry.id} type="button" className={`content-model-row ${model?.id === entry.id ? 'active' : ''}`} onClick={() => openModel(entry.id)} disabled={busy}>
                  <strong>{entry.title}</strong>
                  <small>{entry.ingestion?.extractionMode === 'ocr-vision' ? 'OCR/Vision' : 'PDF digital'} · {(entry.review?.pending ?? 0) + (entry.ocrReview?.pending ?? 0)} pendências</small>
                </button>
              ))}
              {!catalog.models?.length ? <div className="content-empty">Nenhuma aventura compilada nesta campanha.</div> : null}
            </div>
          </aside>

          <main className="content-review-main">
            {model ? (
              <>
                <div className="content-model-summary">
                  <div><span className="eyebrow">Adventure Model</span><h3>{model.title}</h3><small>{model.language?.source || 'und'} → {model.language?.target || model.language?.source || 'und'} · {model.stats?.pages ?? 0} páginas</small></div>
                  <div className="content-summary-actions"><span>{items.filter((item) => item.status === 'pending').length} pendentes</span><button type="button" className="danger-button" onClick={removeCurrent} disabled={busy}>Remover</button></div>
                </div>

                <div className="content-review-body">
                  <nav className="content-review-queue" aria-label="Fila de revisão">
                    {items.map((item) => (
                      <button key={`${item.queue}:${item.id}`} type="button" className={`content-review-item ${selectedItem?.id === item.id ? 'active' : ''} ${item.status}`} onClick={() => setSelectedReviewId(item.id)}>
                        <span><strong>{item.origin}</strong><em>{percentage(item.confidence)}</em></span>
                        <small>p.{item.source?.page ?? '—'} · {item.proposedType}</small>
                        <p>{item.originalText}</p>
                      </button>
                    ))}
                    {!items.length ? <div className="content-empty">Nenhuma revisão necessária. O conteúdo estruturado já está disponível para o Mestre Fênix.</div> : null}
                  </nav>

                  <section className="content-review-editor">
                    {selectedItem ? (
                      <>
                        <div className="content-review-evidence">
                          <div><span className="eyebrow">Evidência</span><strong>{selectedItem.origin} · confiança {percentage(selectedItem.confidence)}</strong></div>
                          <span className={`review-status ${selectedItem.status}`}>{selectedItem.status}</span>
                        </div>
                        <Preview item={selectedItem} />
                        <label>Texto reconhecido<textarea rows="8" value={editedText} onChange={(event) => setEditedText(event.target.value)} disabled={selectedItem.status !== 'pending' || busy} /></label>
                        <div className="content-review-decision-row">
                          <button type="button" className="ghost-button" onClick={() => decide('reject')} disabled={selectedItem.status !== 'pending' || busy}>Rejeitar</button>
                          <button type="button" className="primary-button" onClick={() => decide('accept')} disabled={selectedItem.status !== 'pending' || busy || !editedText.trim()}>Aceitar conteúdo</button>
                        </div>
                        <small className="content-review-safety">Fail-closed: enquanto pendente, este bloco permanece GM-only e não entra na narração do jogador.</small>
                      </>
                    ) : <div className="content-empty large">Selecione uma aventura ou importe um PDF para revisar.</div>}
                  </section>
                </div>
              </>
            ) : <div className="content-empty large">Importe um PDF ou escolha uma aventura já compilada.</div>}
          </main>
        </div>
      </div>
    </section>
  );
}
