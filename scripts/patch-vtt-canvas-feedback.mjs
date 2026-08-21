import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`Nenhuma alteração aplicada em ${path}`);
  await writeFile(path, next, 'utf8');
}

function replaceOne(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Padrão não encontrado: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

await edit('packages/campaign-scene-service/src/index.js', (source) =>
  replaceOne(
    source,
    /size: dimension\(grid\.size, 70, \{ min: 8, max: 500 \}\),/,
    "size: decimal(grid.size, 70, { min: 8, max: 500 }),",
    'grid size decimal'
  )
);

await edit('apps/fenix-vtt/components/vtt-shell.jsx', (source) => {
  let next = source;
  next = replaceOne(
    next,
    /const \[sceneInspectorId, setSceneInspectorId\] = useState\(null\);/,
    "const [sceneInspectorId, setSceneInspectorId] = useState(null);\n  const [requestedMapTool, setRequestedMapTool] = useState(null);",
    'requested map tool state'
  );
  next = replaceOne(
    next,
    /<div className="panel-heading scene-panel-heading">\s*<div><span className="eyebrow">Navegação<\/span><h2>Cenas<\/h2><\/div>\s*\{isGm \? \(\s*<button type="button" className="scene-add-button" onClick=\{\(\) => setSceneManagerOpen\(\(value\) => !value\)\}>\s*\{sceneManagerOpen \? 'Fechar' : '\+ Mapa'\}\s*<\/button>\s*\) : null\}\s*<\/div>/,
    `<div className="panel-heading scene-panel-heading">\n              <div><span className="eyebrow">Navegação</span><h2>Cenas</h2></div>\n              {isGm ? (\n                <div className="scene-panel-actions">\n                  {activeScene ? (\n                    <button type="button" className="scene-config-button" onClick={() => { setSceneManagerOpen(false); setSceneInspectorId(activeScene.id); }}>Configurar</button>\n                  ) : null}\n                  <button type="button" className="scene-add-button" onClick={() => setSceneManagerOpen((value) => !value)}>\n                    {sceneManagerOpen ? 'Fechar' : '+ Mapa'}\n                  </button>\n                </div>\n              ) : null}\n            </div>`,
    'scene visible configure action'
  );
  next = replaceOne(
    next,
    /onCancelPlacement=\{\(\) => setPlacementActorId\(null\)\}\s*\/>/,
    `onCancelPlacement={() => setPlacementActorId(null)}\n            requestedMapTool={requestedMapTool}\n            onRequestedMapToolConsumed={() => setRequestedMapTool(null)}\n          />`,
    'map stage external tool props'
  );
  next = replaceOne(
    next,
    /onUpdateElevation=\{updateSceneElevation\}\s*\/>/,
    `onUpdateElevation={updateSceneElevation}\n              onOpenMapTool={(tool) => {\n                setSceneInspectorId(null);\n                setRequestedMapTool({ tool, nonce: Date.now() });\n              }}\n            />`,
    'scene inspector map tool wiring'
  );
  return next;
});

await edit('apps/fenix-vtt/components/scene-settings-inspector.jsx', (source) => {
  let next = source;
  next = replaceOne(
    next,
    /<button type="button" onClick=\{\(\) => onOpenMapTool\('walls'\)\}>Paredes e portas<\/button>\s*<button type="button" onClick=\{\(\) => onOpenMapTool\('fog'\)\}>Fog \/ visão<\/button>/,
    `<button type="button" onClick={() => onOpenMapTool('walls')}>Paredes e portas</button>\n          <button type="button" onClick={() => onOpenMapTool('regions')}>Pisos / escadas</button>\n          <button type="button" onClick={() => onOpenMapTool('fog')}>Fog / visão</button>`,
    'scene inspector regions shortcut'
  );
  next = replaceOne(
    next,
    /<p className="context-inspector-note">Botão direito abre o objeto no contexto\./,
    `<p className="context-inspector-note">Use “Configurar” na lista de cenas para reabrir estas opções a qualquer momento. Botão direito também abre o objeto no contexto.`,
    'scene inspector visible help'
  );
  return next;
});

await edit('apps/fenix-vtt/app/scene-manager.css', (source) => `${source}\n\n.scene-panel-actions {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.scene-config-button {\n  border: 1px solid var(--line);\n  background: rgba(255,255,255,.025);\n  color: #b7bdc1;\n  border-radius: 9px;\n  padding: 7px 8px;\n  font-size: 9px;\n  cursor: pointer;\n}\n\n.scene-config-button:hover {\n  border-color: var(--line-strong);\n  color: var(--accent);\n}\n`);

await edit('apps/fenix-vtt/components/map-stage.jsx', (source) => {
  let next = source;

  next = replaceOne(
    next,
    /function samePoint\(a, b, tolerance = 0\.01\) \{/,
    `function positiveModulo(value, size) {\n  const numericSize = Math.max(0.0001, Number(size) || 1);\n  return ((Number(value) % numericSize) + numericSize) % numericSize;\n}\n\nfunction calibrateGridFromPoints(first, second, cells, grid) {\n  if (!first || !second) return null;\n  const cellCount = Math.max(1, Math.round(Number(cells) || 1));\n  const dx = Math.abs(Number(second.x) - Number(first.x));\n  const dy = Math.abs(Number(second.y) - Number(first.y));\n  const span = Math.max(dx, dy);\n  const cross = Math.min(dx, dy);\n  const size = span / cellCount;\n  if (!Number.isFinite(size) || size < 8 || size > 500) return null;\n  if (cross > Math.max(4, size * 0.35)) return null;\n  const roundedSize = Math.round(size * 100) / 100;\n  return {\n    ...normalizedGrid(grid),\n    size: roundedSize,\n    offsetX: Math.round(positiveModulo(first.x, roundedSize) * 100) / 100,\n    offsetY: Math.round(positiveModulo(first.y, roundedSize) * 100) / 100\n  };\n}\n\nfunction samePoint(a, b, tolerance = 0.01) {`,
    'grid two-point helpers'
  );

  next = replaceOne(
    next,
    /onCancelPlacement = null\s*\n\}\) \{/,
    `onCancelPlacement = null,\n  requestedMapTool = null,\n  onRequestedMapToolConsumed = null\n}) {`,
    'external map tool props'
  );

  next = replaceOne(
    next,
    /const gridDragRef = useRef\(null\);/,
    `const gridDragRef = useRef(null);\n  const wallEditDragRef = useRef(null);`,
    'wall edit drag ref'
  );

  next = replaceOne(
    next,
    /const \[gridSaving, setGridSaving\] = useState\(false\);/,
    `const [gridSaving, setGridSaving] = useState(false);\n  const [gridCalibration, setGridCalibration] = useState({ enabled: false, cells: 5, first: null, error: null });`,
    'grid calibration state'
  );

  next = replaceOne(
    next,
    /const \[wallMode, setWallMode\] = useState\('wall'\);/,
    `const [wallMode, setWallMode] = useState('select');\n  const [selectedWallId, setSelectedWallId] = useState(null);`,
    'wall select mode state'
  );

  next = replaceOne(
    next,
    /setGridEditorOpen\(false\);\s*setWallDraft/,
    `setGridEditorOpen(false);\n    setGridCalibration({ enabled: false, cells: 5, first: null, error: null });\n    setWallDraft`,
    'reset grid calibration'
  );

  next = replaceOne(
    next,
    /setWallHistory\(\[\]\);\s*setWallStart/,
    `setWallHistory([]);\n    setSelectedWallId(null);\n    wallEditDragRef.current = null;\n    setWallStart`,
    'reset wall selection'
  );

  next = replaceOne(
    next,
    /useEffect\(\(\) => \{\s*if \(!placementActor\) setPlacementPreview\(null\);\s*\}, \[placementActor\]\);/,
    `useEffect(() => {\n    if (!placementActor) setPlacementPreview(null);\n  }, [placementActor]);\n\n  useEffect(() => {\n    const nextTool = requestedMapTool?.tool;\n    if (!canMoveAny || !nextTool) return;\n    openSceneTool(nextTool);\n    onRequestedMapToolConsumed?.();\n  }, [canMoveAny, onRequestedMapToolConsumed, requestedMapTool]);`,
    'external tool effect'
  );

  next = replaceOne(
    next,
    /function rememberAndSetWalls\(nextWalls\) \{\s*setWallHistory\(\(history\) => \[\.\.\.history\.slice\(-29\), cloneWalls\(wallDraft\)\]\);\s*setWallDraft\(cloneWalls\(nextWalls\)\);\s*\}/,
    `function rememberAndSetWalls(nextWalls) {\n    setWallHistory((history) => [...history.slice(-29), cloneWalls(wallDraft)]);\n    setWallDraft(cloneWalls(nextWalls));\n  }\n\n  function selectedWall() {\n    return wallDraft.find((wall) => wall.id === selectedWallId) ?? null;\n  }\n\n  function endpointNear(point, wall) {\n    if (!wall) return null;\n    const threshold = 13 / Math.max(0.1, viewport.zoom);\n    const distanceA = Math.hypot(Number(point.x) - Number(wall.a.x), Number(point.y) - Number(wall.a.y));\n    const distanceB = Math.hypot(Number(point.x) - Number(wall.b.x), Number(point.y) - Number(wall.b.y));\n    const best = Math.min(distanceA, distanceB);\n    if (best > threshold) return null;\n    return distanceA <= distanceB ? 'a' : 'b';\n  }\n\n  function updateSelectedWallPoint(endpoint, axis, value) {\n    const wall = selectedWall();\n    const number = Number(value);\n    if (!wall || !Number.isFinite(number)) return;\n    rememberAndSetWalls(wallDraft.map((item) => item.id === wall.id\n      ? { ...item, [endpoint]: { ...item[endpoint], [axis]: number } }\n      : item));\n  }\n\n  function removeSelectedWall() {\n    if (!selectedWallId) return;\n    rememberAndSetWalls(wallDraft.filter((wall) => wall.id !== selectedWallId));\n    setSelectedWallId(null);\n  }`,
    'wall selection helpers'
  );

  next = replaceOne(
    next,
    /const point = boundedWallPoint\(hit\.world, \{ constrain: event\.shiftKey \}\);\s*\n\s*if \(wallMode === 'erase'\)/,
    `const point = boundedWallPoint(hit.world, { constrain: event.shiftKey });\n\n    if (wallMode === 'select') {\n      const nearest = nearestWall(hit.world);\n      setSelectedWallId(nearest?.id ?? null);\n      setWallStart(null);\n      if (nearest) {\n        const endpoint = endpointNear(hit.world, nearest);\n        if (endpoint) {\n          setWallHistory((history) => [...history.slice(-29), cloneWalls(wallDraft)]);\n          wallEditDragRef.current = { wallId: nearest.id, endpoint };\n          event.currentTarget.setPointerCapture?.(event.pointerId);\n        }\n      }\n      return true;\n    }\n\n    if (wallMode === 'erase')`,
    'wall select handling'
  );

  next = replaceOne(
    next,
    /if \(gridEditorOpen && canMoveAny && event\.button === 0\) \{\s*gridDragRef\.current = \{\s*x: event\.clientX,\s*y: event\.clientY,\s*offsetX: Number\(gridDraft\.offsetX\) \|\| 0,\s*offsetY: Number\(gridDraft\.offsetY\) \|\| 0\s*\};\s*event\.currentTarget\.setPointerCapture\?\.\(event\.pointerId\);\s*event\.preventDefault\(\);\s*return;\s*\}/,
    `if (gridEditorOpen && canMoveAny && event.button === 0) {\n      if (gridCalibration.enabled) {\n        if (!hit?.world) return;\n        if (!gridCalibration.first) {\n          setGridCalibration((current) => ({ ...current, first: { ...hit.world }, error: null }));\n        } else {\n          const calibrated = calibrateGridFromPoints(gridCalibration.first, hit.world, gridCalibration.cells, gridDraft);\n          if (calibrated) {\n            setGridDraft(calibrated);\n            setGridCalibration((current) => ({ ...current, enabled: false, first: null, error: null }));\n          } else {\n            setGridCalibration((current) => ({ ...current, first: null, error: 'Use dois cruzamentos da mesma linha ou coluna e confira o número de células.' }));\n          }\n        }\n        event.preventDefault();\n        return;\n      }\n      gridDragRef.current = {\n        x: event.clientX,\n        y: event.clientY,\n        offsetX: Number(gridDraft.offsetX) || 0,\n        offsetY: Number(gridDraft.offsetY) || 0\n      };\n      event.currentTarget.setPointerCapture?.(event.pointerId);\n      event.preventDefault();\n      return;\n    }`,
    'grid two point pointer handling'
  );

  next = replaceOne(
    next,
    /const hit = renderer\.hitTest\(event\);\s*\n\s*if \(placementActor && hit\?\.world\)/,
    `const hit = renderer.hitTest(event);\n\n    if (wallEditDragRef.current && hit?.world) {\n      const { wallId, endpoint } = wallEditDragRef.current;\n      const point = boundedWallPoint(hit.world);\n      setWallDraft((walls) => walls.map((wall) => wall.id === wallId\n        ? { ...wall, [endpoint]: point }\n        : wall));\n      return;\n    }\n\n    if (placementActor && hit?.world)`,
    'wall endpoint dragging'
  );

  next = replaceOne(
    next,
    /if \(gridDragRef\.current\) \{\s*gridDragRef\.current = null;\s*if \(event\.currentTarget\.hasPointerCapture\?\.\(event\.pointerId\)\) event\.currentTarget\.releasePointerCapture\?\.\(event\.pointerId\);\s*return;\s*\}/,
    `if (gridDragRef.current) {\n      gridDragRef.current = null;\n      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);\n      return;\n    }\n\n    if (wallEditDragRef.current) {\n      wallEditDragRef.current = null;\n      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);\n      return;\n    }`,
    'wall drag pointer up'
  );

  next = replaceOne(
    next,
    /setWallEditorOpen\(false\);\s*\n  \}/,
    `setWallEditorOpen(false);\n    setSelectedWallId(null);\n    wallEditDragRef.current = null;\n  }`,
    'cancel walls resets selection'
  );

  next = replaceOne(
    next,
    /setGridEditorOpen\(false\);\s*setWallEditorOpen\(false\);/,
    `setGridEditorOpen(false);\n    setGridCalibration((current) => ({ ...current, enabled: false, first: null, error: null }));\n    setWallEditorOpen(false);\n    setSelectedWallId(null);\n    wallEditDragRef.current = null;`,
    'close scene editors resets authoring'
  );

  next = replaceOne(
    next,
    /<label>Tamanho \(px\)<input type="number" min="8" max="500" step="1" value=\{gridDraft\.size\}/,
    `<label>Tamanho (px)<input type="number" min="8" max="500" step="0.01" value={gridDraft.size}`,
    'fractional grid size input'
  );

  next = replaceOne(
    next,
    /<div className="grid-nudge-controls" aria-label="Ajuste fino da grade">/,
    `<div className="grid-two-point-calibration">\n            <label>Células entre os pontos<input type="number" min="1" max="50" step="1" value={gridCalibration.cells} onChange={(event) => setGridCalibration((current) => ({ ...current, cells: Math.max(1, Number(event.target.value) || 1) }))} /></label>\n            <button type="button" className={gridCalibration.enabled ? 'active' : ''} onClick={() => setGridCalibration((current) => ({ ...current, enabled: !current.enabled, first: null, error: null }))}>\n              {gridCalibration.enabled ? (gridCalibration.first ? 'Clique no 2º cruzamento…' : 'Clique no 1º cruzamento…') : 'Calibrar por 2 pontos'}\n            </button>\n            <small>Para mapas que já têm grade: escolha dois cruzamentos na mesma linha/coluna e informe quantas células existem entre eles.</small>\n            {gridCalibration.error ? <small className="grid-calibration-error">{gridCalibration.error}</small> : null}\n          </div>\n          <div className="grid-nudge-controls" aria-label="Ajuste fino da grade">`,
    'grid two point controls'
  );

  next = replaceOne(
    next,
    /<button type="button" onClick=\{\(\) => nudgeGrid\('size', -1\)\}>− tamanho<\/button>\s*<button type="button" onClick=\{\(\) => nudgeGrid\('size', 1\)\}>\+ tamanho<\/button>/,
    `<button type="button" onClick={() => nudgeGrid('size', -0.1)}>− 0,1 tamanho</button>\n            <button type="button" onClick={() => nudgeGrid('size', 0.1)}>+ 0,1 tamanho</button>`,
    'grid subpixel nudge'
  );

  next = replaceOne(
    next,
    /<div className="wall-authoring-tools">\s*<button type="button" className=\{wallMode === 'wall' \? 'active' : ''\}/,
    `<div className="wall-authoring-tools">\n            <button type="button" className={wallMode === 'select' ? 'active' : ''} onClick={() => { setWallMode('select'); setWallStart(null); }}>Selecionar / editar</button>\n            <button type="button" className={wallMode === 'wall' ? 'active' : ''}`,
    'wall select button'
  );

  next = replaceOne(
    next,
    /<small className="wall-authoring-help">Parede: clique para iniciar e continue clicando para criar segmentos conectados\. Shift trava em ângulos de 45°\. Porta: clique diretamente sobre uma parede existente\.<\/small>/,
    `<small className="wall-authoring-help">Selecionar/editar: clique no segmento e arraste um dos vértices. Parede: clique para iniciar e continue clicando para criar segmentos conectados. Shift trava em ângulos de 45°. Porta: clique diretamente sobre uma parede existente.</small>\n          {wallMode === 'select' && selectedWall() ? (() => {\n            const wall = selectedWall();\n            return (\n              <div className="wall-selection-editor">\n                <div><span>Selecionado</span><strong>{wall.kind === SceneWallKind.DOOR ? 'Porta' : 'Parede'}</strong></div>\n                <div className="wall-coordinate-grid">\n                  <label>A · X<input type="number" step="0.5" value={numberLabel(wall.a.x)} onChange={(event) => updateSelectedWallPoint('a', 'x', event.target.value)} /></label>\n                  <label>A · Y<input type="number" step="0.5" value={numberLabel(wall.a.y)} onChange={(event) => updateSelectedWallPoint('a', 'y', event.target.value)} /></label>\n                  <label>B · X<input type="number" step="0.5" value={numberLabel(wall.b.x)} onChange={(event) => updateSelectedWallPoint('b', 'x', event.target.value)} /></label>\n                  <label>B · Y<input type="number" step="0.5" value={numberLabel(wall.b.y)} onChange={(event) => updateSelectedWallPoint('b', 'y', event.target.value)} /></label>\n                </div>\n                {wall.kind === SceneWallKind.DOOR ? (\n                  <label className="wall-selected-door-state">Estado da porta\n                    <select value={wall.doorState ?? SceneDoorState.CLOSED} onChange={(event) => rememberAndSetWalls(wallDraft.map((item) => item.id === wall.id ? { ...item, doorState: event.target.value } : item))}>\n                      <option value={SceneDoorState.CLOSED}>Fechada</option>\n                      <option value={SceneDoorState.OPEN}>Aberta</option>\n                      <option value={SceneDoorState.LOCKED}>Trancada</option>\n                    </select>\n                  </label>\n                ) : null}\n                <button type="button" className="danger" onClick={removeSelectedWall}>Excluir selecionada</button>\n              </div>\n            );\n          })() : null}`,
    'wall selection editor UI'
  );

  next = replaceOne(
    next,
    /<line className=\{`wall-segment wall-\$\{wall\.kind\}\$\{stateClass\}`\}/,
    `<line className={\`wall-segment wall-\${wall.kind}\${stateClass}\${wall.id === selectedWallId ? ' selected' : ''}\`}`,
    'selected wall line class'
  );

  next = replaceOne(
    next,
    /<circle className="wall-vertex-handle" cx=\{a\.x\} cy=\{a\.y\} r="3\.5" \/>\s*<circle className="wall-vertex-handle" cx=\{b\.x\} cy=\{b\.y\} r="3\.5" \/>/,
    `<circle className={\`wall-vertex-handle\${wall.id === selectedWallId ? ' selected' : ''}\`} cx={a.x} cy={a.y} r={wall.id === selectedWallId ? 6 : 3.5} />\n                <circle className={\`wall-vertex-handle\${wall.id === selectedWallId ? ' selected' : ''}\`} cx={b.x} cy={b.y} r={wall.id === selectedWallId ? 6 : 3.5} />`,
    'selected wall vertex handles'
  );

  return next;
});

await edit('apps/fenix-vtt/app/grid-authoring-v2.css', (source) => `${source}\n\n.grid-two-point-calibration {\n  display: grid;\n  grid-template-columns: 120px minmax(0, 1fr);\n  gap: 7px;\n  align-items: end;\n  padding: 9px;\n  border: 1px solid var(--line);\n  border-radius: 10px;\n  background: rgba(93,173,232,.055);\n}\n\n.grid-two-point-calibration button {\n  min-height: 34px;\n  border: 1px solid var(--line-strong);\n  border-radius: 8px;\n  background: rgba(255,255,255,.025);\n  color: #c6ccd0;\n  cursor: pointer;\n  font-size: 9px;\n}\n\n.grid-two-point-calibration button.active {\n  background: rgba(93,173,232,.14);\n  border-color: rgba(93,173,232,.48);\n  color: #8fd0f1;\n}\n\n.grid-two-point-calibration > small {\n  grid-column: 1 / -1;\n  color: var(--muted);\n  font-size: 8px;\n  line-height: 1.4;\n}\n\n.grid-two-point-calibration .grid-calibration-error {\n  color: #e49a94;\n}\n`);

await edit('apps/fenix-vtt/app/wall-authoring.css', (source) => {
  let next = source.replace('grid-template-columns: repeat(4, minmax(0, 1fr));', 'grid-template-columns: repeat(5, minmax(0, 1fr));');
  next += `\n\n.wall-segment.selected {\n  stroke: #fff1c7;\n  stroke-width: 6;\n  filter: drop-shadow(0 0 4px rgba(230,177,83,.7));\n}\n\n.wall-vertex-handle.selected {\n  fill: var(--accent);\n  stroke: #fff1c7;\n  stroke-width: 2;\n}\n\n.wall-selection-editor {\n  display: grid;\n  gap: 8px;\n  padding: 9px;\n  border: 1px solid var(--line-strong);\n  border-radius: 10px;\n  background: rgba(230,177,83,.055);\n}\n\n.wall-selection-editor > div:first-child {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  font-size: 9px;\n  color: var(--muted);\n}\n\n.wall-selection-editor > div:first-child strong { color: var(--accent); }\n\n.wall-coordinate-grid {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.wall-coordinate-grid label,\n.wall-selected-door-state {\n  display: grid;\n  gap: 4px;\n  color: #aeb4b8;\n  font-size: 8px;\n}\n\n.wall-coordinate-grid input,\n.wall-selected-door-state select {\n  width: 100%;\n  border: 1px solid var(--line);\n  border-radius: 7px;\n  background: #090c0e;\n  color: var(--text);\n  padding: 6px;\n  font-size: 9px;\n}\n\n.wall-selection-editor > button.danger {\n  justify-self: end;\n  border: 1px solid rgba(220,119,111,.28);\n  border-radius: 8px;\n  background: rgba(220,119,111,.08);\n  color: #e49a94;\n  padding: 6px 8px;\n  cursor: pointer;\n  font-size: 9px;\n}\n\n@media (max-width: 760px) {\n  .wall-coordinate-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n`;
  return next;
});

await writeFile('test/vtt-canvas-feedback-regression.test.js', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\n\nasync function source(path) {\n  return readFile(new URL(\`../\${path}\`, import.meta.url), 'utf8');\n}\n\ntest('grade suporta precisão decimal e calibração por dois pontos', async () => {\n  const [service, stage] = await Promise.all([\n    source('packages/campaign-scene-service/src/index.js'),\n    source('apps/fenix-vtt/components/map-stage.jsx')\n  ]);\n  assert.match(service, /size: decimal\\(grid\\.size, 70/);\n  assert.match(stage, /calibrateGridFromPoints/);\n  assert.match(stage, /Calibrar por 2 pontos/);\n  assert.match(stage, /step=\\"0\\.01\\"/);\n});\n\ntest('cena criada pode ser reaberta por botão Configurar', async () => {\n  const shell = await source('apps/fenix-vtt/components/vtt-shell.jsx');\n  assert.match(shell, />Configurar<\\/button>/);\n  assert.match(shell, /onOpenMapTool/);\n  assert.match(shell, /requestedMapTool/);\n});\n\ntest('paredes e portas possuem seleção e edição de vértices', async () => {\n  const stage = await source('apps/fenix-vtt/components/map-stage.jsx');\n  for (const marker of ['Selecionar / editar', 'selectedWallId', 'wallEditDragRef', 'updateSelectedWallPoint', 'Excluir selecionada']) {\n    assert.ok(stage.includes(marker), \`faltou marker \${marker}\`);\n  }\n});\n`, 'utf8');

console.log('Canvas feedback patch aplicado.');
