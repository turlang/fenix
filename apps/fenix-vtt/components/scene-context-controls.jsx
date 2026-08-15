'use client';

export function SceneContextControls({
  canEditMap = false,
  demoMode = false,
  context = 'tokens',
  paletteOpen = false,
  tool = 'select',
  gridEditorOpen = false,
  wallEditorOpen = false,
  regionEditorOpen = false,
  fogEditorOpen = false,
  fogPreview = false,
  fogEnabled = false,
  visionAvailable = false,
  zoomPercent = 100,
  onToggleContext,
  onTokenTool,
  onMapTool,
  onToggleVision,
  onZoomOut,
  onZoomIn,
  onFit
}) {
  const mapAvailable = canEditMap && !demoMode;

  return (
    <>
      <nav className="scene-context-rail" aria-label="Contextos da cena">
        <button
          type="button"
          className={context === 'tokens' ? 'active' : ''}
          onClick={() => onToggleContext?.('tokens')}
          title="Ferramentas de tokens"
          aria-pressed={context === 'tokens'}
        >
          <span aria-hidden="true">◉</span>
          <small>Tokens</small>
        </button>
        {canEditMap ? (
          <button
            type="button"
            className={context === 'map' ? 'active' : ''}
            onClick={() => onToggleContext?.('map')}
            title="Ferramentas do mapa"
            aria-pressed={context === 'map'}
          >
            <span aria-hidden="true">◇</span>
            <small>Mapa</small>
          </button>
        ) : null}
      </nav>

      {paletteOpen ? (
        <div className={`scene-context-palette palette-${context}`} aria-label={context === 'map' ? 'Ferramentas do mapa' : 'Ferramentas de tokens'}>
          <div className="scene-context-palette-heading">
            <strong>{context === 'map' ? 'Mapa' : 'Tokens'}</strong>
            <small>{context === 'map' ? 'Ambiente e geometria' : 'Entidades da cena'}</small>
          </div>

          {context === 'tokens' ? (
            <div className="scene-context-tool-list">
              <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => onTokenTool?.('select')}>
                <span aria-hidden="true">↖</span><span><strong>Selecionar / mover</strong><small>Token e entidade</small></span>
              </button>
              <div className="scene-context-hint">Botão direito no token abre suas configurações e o vínculo com ator/ficha.</div>
            </div>
          ) : (
            <div className="scene-context-tool-list">
              <button type="button" className={tool === 'pan' ? 'active' : ''} onClick={() => onMapTool?.('pan')}>
                <span aria-hidden="true">✋</span><span><strong>Câmera</strong><small>Mover pelo mapa</small></span>
              </button>
              {mapAvailable ? (
                <>
                  <button type="button" className={gridEditorOpen ? 'active' : ''} onClick={() => onMapTool?.('grid')}>
                    <span aria-hidden="true">#</span><span><strong>Grade</strong><small>Calibração e escala</small></span>
                  </button>
                  <button type="button" className={wallEditorOpen ? 'active' : ''} onClick={() => onMapTool?.('walls')}>
                    <span aria-hidden="true">╱</span><span><strong>Paredes / portas</strong><small>Geometria e bloqueio</small></span>
                  </button>
                  <button type="button" className={regionEditorOpen ? 'active' : ''} onClick={() => onMapTool?.('regions')}>
                    <span aria-hidden="true">▱</span><span><strong>Pisos</strong><small>Escadas e rampas</small></span>
                  </button>
                  <button type="button" className={fogEditorOpen ? 'active' : ''} onClick={() => onMapTool?.('fog')}>
                    <span aria-hidden="true">◐</span><span><strong>Fog</strong><small>Memória espacial</small></span>
                  </button>
                  <button type="button" className={fogPreview ? 'active' : ''} disabled={!fogEnabled || !visionAvailable} onClick={onToggleVision}>
                    <span aria-hidden="true">◉</span><span><strong>Visão</strong><small>Prévia do ator</small></span>
                  </button>
                </>
              ) : <div className="scene-context-hint">Ative uma cena persistente para editar sua geometria.</div>}
            </div>
          )}
        </div>
      ) : null}

      <div className="map-camera-controls" role="toolbar" aria-label="Câmera do mapa">
        <button type="button" onClick={onZoomOut} title="Diminuir zoom">−</button>
        <span>{zoomPercent}%</span>
        <button type="button" onClick={onZoomIn} title="Aumentar zoom">+</button>
        <button type="button" onClick={onFit} title="Ajustar mapa à tela">Ajustar</button>
      </div>
    </>
  );
}
