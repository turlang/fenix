export const demoScene = Object.freeze({
  id: 'fenix-demo-hall',
  name: 'Salão das Colunas',
  width: 1600,
  height: 1000,
  grid: { size: 80, type: 'square' }
});

export const demoTokens = Object.freeze([
  { id: 'hero-ayla', name: 'Ayla', x: 520, y: 430, size: 72, selected: true, visible: true },
  { id: 'hero-dorian', name: 'Dorian', x: 690, y: 520, size: 72, visible: true },
  { id: 'npc-warden', name: 'Guardião', x: 1030, y: 380, size: 80, visible: true }
]);

export const demoVisibleActors = Object.freeze([
  { id: 'hero-ayla', name: 'Ayla', type: 'character' },
  { id: 'hero-dorian', name: 'Dorian', type: 'character' },
  { id: 'npc-warden', name: 'Guardião', type: 'npc' }
]);

export const demoRoomZones = Object.freeze([
  {
    id: 'north-chamber-zone',
    bounds: { x: 1160, y: 160, width: 360, height: 360 },
    room: { id: '03', name: 'Câmara Norte' },
    source: {
      canonicalAnchor: true,
      type: 'ROOM_READ_ALOUD',
      extractionMode: 'STANDALONE_ZONE_READ_ALOUD',
      text: 'A passagem ao norte termina em uma câmara estreita de pedra. Duas colunas baixas dividem o espaço, e uma abertura escura ocupa a parede oriental.'
    }
  }
]);

export const demoSessionSnapshot = Object.freeze({
  activeScene: demoScene,
  campaign: { worldId: 'fenix-standalone-demo', title: 'Ecos do Salão Antigo' },
  visibleActors: demoVisibleActors,
  sceneJournal: {
    id: 'fenix-demo-journal',
    name: 'Salão das Colunas',
    explicitLink: true,
    selectedPage: {
      name: 'Salão das Colunas',
      areaName: '02. Salão das Colunas',
      canonicalAnchor: true,
      extractionMode: 'STANDALONE_SCENE_READ_ALOUD',
      content: 'Um salão amplo se estende entre colunas de pedra que sustentam o teto alto. A luz das tochas alcança o piso irregular, enquanto uma porta de madeira ocupa a parede norte.'
    }
  },
  system: { id: 'fenix-system-agnostic', version: '1' },
  metadata: { source: 'fenix-vtt', mode: 'standalone' }
});

export function findRoomZone(point = {}) {
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return demoRoomZones.find((zone) => {
    const bounds = zone.bounds;
    return x >= bounds.x && x <= bounds.x + bounds.width
      && y >= bounds.y && y <= bounds.y + bounds.height;
  }) ?? null;
}

export function createDemoRoomEnteredEvent(zone) {
  if (!zone?.room || !zone?.source) throw new TypeError('Zona de sala inválida.');
  return {
    room: zone.room,
    source: zone.source,
    scene: demoScene,
    campaign: demoSessionSnapshot.campaign,
    visibleActors: demoVisibleActors
  };
}
