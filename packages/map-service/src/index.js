import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_VERSION = 1;
const DEFAULT_FILE = resolve(process.cwd(), process.env.MAP_BLUEPRINT_FILE || 'data/map-blueprints.json');
const MAP_STATUSES = new Set(['DRAFT', 'READY', 'SCENE_CREATED']);
const MAP_STYLES = new Set(['DUNGEON', 'CAVE', 'CRYPT', 'TEMPLE', 'SEWER', 'FORTRESS', 'FOREST', 'CITY', 'GENERAL']);
const DOOR_TYPES = new Set(['DOOR', 'SECRET', 'OPEN']);
const LIGHT_LEVELS = new Set(['BRIGHT', 'DIM', 'DARK']);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cleanText(value, limit = 5000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, limit);
}

function compactText(value, limit = 1000) {
  return cleanText(value, limit).replace(/\s+/g, ' ').trim();
}

function safeId(value, fallback = '') {
  const normalized = compactText(value, 200).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeStyle(value) {
  const style = compactText(value, 40).toUpperCase();
  return MAP_STYLES.has(style) ? style : 'DUNGEON';
}

function normalizeStatus(value, fallback = 'DRAFT') {
  const status = compactText(value, 40).toUpperCase();
  return MAP_STATUSES.has(status) ? status : fallback;
}

function normalizeDoorType(value) {
  const type = compactText(value, 40).toUpperCase();
  return DOOR_TYPES.has(type) ? type : 'DOOR';
}

function normalizeLight(value) {
  const level = compactText(value, 40).toUpperCase();
  return LIGHT_LEVELS.has(level) ? level : 'DIM';
}

function emptyStore() {
  return { version: STORE_VERSION, campaigns: {} };
}

function emptyCampaign(campaignId) {
  const now = new Date().toISOString();
  return {
    id: safeId(campaignId, 'default'),
    blueprints: {},
    sequence: 0,
    createdAt: now,
    updatedAt: now
  };
}

function stripCodeFence(value) {
  const text = cleanText(value, 250000);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parsePayload(value) {
  if (value && typeof value === 'object') return clone(value);
  const text = stripCodeFence(value);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const error = new Error('O provedor não retornou uma planta estruturada válida.');
    error.code = 'MAP_INVALID_RESPONSE';
    throw error;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    const error = new Error('O JSON retornado para o mapa é inválido.', { cause });
    error.code = 'MAP_INVALID_RESPONSE';
    throw error;
  }
}

function normalizeRoomId(value, index) {
  return safeId(value, `room-${index + 1}`).toLowerCase();
}

function normalizeAbstractRooms(value, fallbackCount = 8) {
  const source = Array.isArray(value) ? value : [];
  const limited = source.slice(0, 80);
  if (!limited.length) {
    return Array.from({ length: fallbackCount }, (_, index) => ({
      id: `room-${index + 1}`,
      label: `Área ${index + 1}`,
      kind: index === 0 ? 'ENTRANCE' : index === fallbackCount - 1 ? 'OBJECTIVE' : 'ROOM',
      width: 8,
      height: 6,
      description: '',
      readAloud: '',
      secret: '',
      light: index % 4 === 0 ? 'DARK' : 'DIM'
    }));
  }
  const used = new Set();
  return limited.map((room, index) => {
    let id = normalizeRoomId(room?.id ?? room?.number ?? room?.label, index);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return {
      id,
      number: index + 1,
      label: compactText(room?.label ?? room?.name, 220) || `Área ${index + 1}`,
      kind: compactText(room?.kind ?? room?.type, 80).toUpperCase() || 'ROOM',
      width: clampInteger(room?.width, 4, 18, 8),
      height: clampInteger(room?.height, 4, 18, 6),
      description: compactText(room?.description, 1400),
      readAloud: compactText(room?.readAloud ?? room?.playerText, 1800),
      secret: compactText(room?.secret ?? room?.gmNotes, 1800),
      light: normalizeLight(room?.light)
    };
  });
}

function normalizeConnections(value, rooms) {
  const ids = new Set(rooms.map((room) => room.id));
  const source = Array.isArray(value) ? value : [];
  const connections = [];
  const seen = new Set();
  for (const entry of source.slice(0, 160)) {
    const from = safeId(entry?.from ?? entry?.source).toLowerCase();
    const to = safeId(entry?.to ?? entry?.target).toLowerCase();
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const pair = [from, to].sort().join('::');
    if (seen.has(pair)) continue;
    seen.add(pair);
    connections.push({
      id: `connection-${connections.length + 1}`,
      from,
      to,
      doorType: normalizeDoorType(entry?.doorType ?? entry?.type),
      locked: Boolean(entry?.locked),
      secret: compactText(entry?.secret, 800)
    });
  }
  if (!connections.length) {
    for (let index = 1; index < rooms.length; index += 1) {
      connections.push({
        id: `connection-${index}`,
        from: rooms[index - 1].id,
        to: rooms[index].id,
        doorType: 'DOOR',
        locked: false,
        secret: ''
      });
    }
    return connections;
  }

  const parent = new Map(rooms.map((room) => [room.id, room.id]));
  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    let next = id;
    while (parent.get(next) !== next) {
      const previous = parent.get(next);
      parent.set(next, current);
      next = previous;
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const connection of connections) union(connection.from, connection.to);

  const anchor = rooms[0]?.id;
  for (const room of rooms.slice(1)) {
    if (find(room.id) === find(anchor)) continue;
    const componentRoot = find(room.id);
    const previous = rooms.slice(0, rooms.indexOf(room)).reverse().find((candidate) => find(candidate.id) === find(anchor)) ?? rooms[0];
    const bridge = {
      id: `connection-${connections.length + 1}`,
      from: previous.id,
      to: room.id,
      doorType: 'DOOR',
      locked: false,
      secret: ''
    };
    connections.push(bridge);
    union(anchor, componentRoot);
  }
  return connections;
}

function normalizePlan(raw, input = {}) {
  const payload = parsePayload(raw);
  const requestedCount = clampInteger(input.roomCount, 2, 80, 8);
  const rooms = normalizeAbstractRooms(payload.rooms ?? payload.areas, requestedCount);
  const connections = normalizeConnections(payload.connections ?? payload.links, rooms);
  return {
    title: compactText(payload.title ?? input.title, 300) || 'Mapa sem título',
    summary: compactText(payload.summary ?? payload.description ?? input.prompt, 1800) || 'Planta tática gerada para a campanha.',
    style: normalizeStyle(payload.style ?? input.style),
    tags: [...new Set((Array.isArray(payload.tags) ? payload.tags : []).map((entry) => compactText(entry, 80).toLocaleLowerCase('pt-BR')).filter(Boolean))].slice(0, 20),
    rooms,
    connections
  };
}

function seededNumber(seed, index, minimum, maximum) {
  const digest = createHash('sha256').update(`${seed}:${index}`).digest();
  const value = digest.readUInt32BE(0) / 0xffffffff;
  return Math.round(minimum + value * (maximum - minimum));
}

function layoutAbstractPlan(plan, { gridSize = 100, padding = 3, gap = 6 } = {}) {
  const count = plan.rooms.length;
  const columns = Math.max(2, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.max(...plan.rooms.map((room) => room.width)) + gap;
  const cellHeight = Math.max(...plan.rooms.map((room) => room.height)) + gap;
  const placedRooms = plan.rooms.map((room, index) => {
    const logicalRow = Math.floor(index / columns);
    const columnInRow = index % columns;
    const logicalColumn = logicalRow % 2 === 0 ? columnInRow : columns - 1 - columnInRow;
    const jitterX = seededNumber(plan.title, index * 2, 0, 2);
    const jitterY = seededNumber(plan.title, index * 2 + 1, 0, 2);
    return {
      ...room,
      x: padding + logicalColumn * cellWidth + jitterX,
      y: padding + logicalRow * cellHeight + jitterY
    };
  });
  const widthUnits = Math.max(...placedRooms.map((room) => room.x + room.width)) + padding;
  const heightUnits = Math.max(...placedRooms.map((room) => room.y + room.height)) + padding;
  const roomById = new Map(placedRooms.map((room) => [room.id, room]));
  const connections = plan.connections.map((entry) => ({ ...entry, ...connectionGeometry(roomById.get(entry.from), roomById.get(entry.to)) }));
  const openingsByRoom = new Map(placedRooms.map((room) => [room.id, []]));
  for (const connection of connections) {
    openingsByRoom.get(connection.from)?.push({ ...connection.fromOpening, connection });
    openingsByRoom.get(connection.to)?.push({ ...connection.toOpening, connection });
  }
  const walls = [];
  const doors = [];
  for (const room of placedRooms) {
    const boundary = roomBoundary(room, openingsByRoom.get(room.id) ?? []);
    walls.push(...boundary.walls);
    doors.push(...boundary.doors);
  }
  const corridors = connections.map((entry) => ({ id: entry.id, points: entry.path }));
  for (const corridor of corridors) {
    walls.push(...corridorBoundary(corridor).map((entry, index) => ({
      id: `wall-${corridor.id}-corridor-${index + 1}`,
      roomId: null,
      connectionId: corridor.id,
      kind: 'corridor',
      ...entry
    })));
  }
  const lights = placedRooms
    .filter((room) => room.light !== 'DARK')
    .map((room) => ({
      id: `light-${room.id}`,
      roomId: room.id,
      x: room.x + room.width / 2,
      y: room.y + room.height / 2,
      bright: room.light === 'BRIGHT' ? Math.max(2, Math.floor(Math.min(room.width, room.height) / 2)) : 0,
      dim: Math.max(3, Math.floor(Math.max(room.width, room.height) * 0.75)),
      color: plan.style === 'CAVE' ? '#b8d5ff' : plan.style === 'TEMPLE' ? '#ffd88a' : '#f6c56f',
      alpha: room.light === 'BRIGHT' ? 0.35 : 0.5
    }));
  const notes = placedRooms.map((room) => ({
    id: `note-${room.id}`,
    roomId: room.id,
    number: room.number,
    label: room.label,
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
    description: room.description,
    readAloud: room.readAloud,
    secret: room.secret
  }));
  const spawnPoints = placedRooms.slice(0, 1).map((room) => ({
    id: 'spawn-party',
    label: 'Entrada do grupo',
    x: room.x + room.width / 2,
    y: room.y + room.height / 2
  }));
  return {
    grid: { type: 1, size: gridSize, distance: 5, units: 'ft' },
    dimensions: { columns: widthUnits, rows: heightUnits, width: widthUnits * gridSize, height: heightUnits * gridSize },
    rooms: placedRooms,
    connections,
    corridors,
    walls,
    doors,
    lights,
    notes,
    spawnPoints
  };
}

function connectionGeometry(from, to) {
  if (!from || !to) return { path: [], fromOpening: null, toOpening: null };
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
  let fromOpening;
  let toOpening;
  if (horizontal) {
    const toRight = toCenter.x >= fromCenter.x;
    fromOpening = { side: toRight ? 'E' : 'W', offset: from.height / 2 };
    toOpening = { side: toRight ? 'W' : 'E', offset: to.height / 2 };
  } else {
    const toBelow = toCenter.y >= fromCenter.y;
    fromOpening = { side: toBelow ? 'S' : 'N', offset: from.width / 2 };
    toOpening = { side: toBelow ? 'N' : 'S', offset: to.width / 2 };
  }
  const fromPoint = openingPoint(from, fromOpening);
  const toPoint = openingPoint(to, toOpening);
  const path = horizontal
    ? [fromPoint, { x: (fromPoint.x + toPoint.x) / 2, y: fromPoint.y }, { x: (fromPoint.x + toPoint.x) / 2, y: toPoint.y }, toPoint]
    : [fromPoint, { x: fromPoint.x, y: (fromPoint.y + toPoint.y) / 2 }, { x: toPoint.x, y: (fromPoint.y + toPoint.y) / 2 }, toPoint];
  return { path, fromOpening, toOpening };
}

function openingPoint(room, opening) {
  if (opening.side === 'N') return { x: room.x + opening.offset, y: room.y };
  if (opening.side === 'S') return { x: room.x + opening.offset, y: room.y + room.height };
  if (opening.side === 'W') return { x: room.x, y: room.y + opening.offset };
  return { x: room.x + room.width, y: room.y + opening.offset };
}

function roomBoundary(room, openings = []) {
  const walls = [];
  const doors = [];
  for (const side of ['N', 'E', 'S', 'W']) {
    const length = side === 'N' || side === 'S' ? room.width : room.height;
    const sideOpenings = openings.filter((entry) => entry?.side === side).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const opening of sideOpenings) {
      const start = Math.max(0.5, Math.min(length - 1.5, opening.offset - 0.5));
      const end = start + 1;
      if (start > cursor + 0.05) walls.push(segmentForSide(room, side, cursor, start));
      const segment = segmentForSide(room, side, start, end);
      doors.push({
        id: `door-${opening.connection.id}-${room.id}`,
        roomId: room.id,
        connectionId: opening.connection.id,
        side,
        type: opening.connection.doorType,
        locked: opening.connection.locked,
        secret: opening.connection.secret,
        ...segment
      });
      cursor = Math.max(cursor, end);
    }
    if (cursor < length - 0.05) walls.push(segmentForSide(room, side, cursor, length));
  }
  return {
    walls: walls.map((entry, index) => ({ id: `wall-${room.id}-${index + 1}`, roomId: room.id, ...entry })),
    doors
  };
}

function segmentForSide(room, side, start, end) {
  if (side === 'N') return { x1: room.x + start, y1: room.y, x2: room.x + end, y2: room.y };
  if (side === 'S') return { x1: room.x + start, y1: room.y + room.height, x2: room.x + end, y2: room.y + room.height };
  if (side === 'W') return { x1: room.x, y1: room.y + start, x2: room.x, y2: room.y + end };
  return { x1: room.x + room.width, y1: room.y + start, x2: room.x + room.width, y2: room.y + end };
}


function corridorBoundary(corridor) {
  const points = Array.isArray(corridor?.points) ? corridor.points : [];
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end || (start.x === end.x && start.y === end.y)) continue;
    if (start.y === end.y) {
      segments.push({ x1: start.x, y1: start.y - 0.5, x2: end.x, y2: end.y - 0.5 });
      segments.push({ x1: start.x, y1: start.y + 0.5, x2: end.x, y2: end.y + 0.5 });
    } else if (start.x === end.x) {
      segments.push({ x1: start.x - 0.5, y1: start.y, x2: end.x - 0.5, y2: end.y });
      segments.push({ x1: start.x + 0.5, y1: start.y, x2: end.x + 0.5, y2: end.y });
    }
  }
  return segments;
}

const PALETTES = {
  DUNGEON: { background: '#17191d', floor: '#44484f', corridor: '#383c42', wall: '#b6a989', door: '#8a552f', secret: '#774866', grid: '#5d626a', label: '#f3e6c4' },
  CAVE: { background: '#111718', floor: '#354648', corridor: '#2d3d3f', wall: '#86a3a5', door: '#6f5136', secret: '#6b5178', grid: '#4c6466', label: '#d9f2ef' },
  CRYPT: { background: '#151318', floor: '#403a46', corridor: '#352f3a', wall: '#aea1b8', door: '#745039', secret: '#734d73', grid: '#5c5364', label: '#efe5f4' },
  TEMPLE: { background: '#1d1912', floor: '#5a4c35', corridor: '#4a3f2d', wall: '#d3bd87', door: '#8d5d2f', secret: '#795a79', grid: '#756343', label: '#fff1c9' },
  SEWER: { background: '#121713', floor: '#354438', corridor: '#29372c', wall: '#8fa488', door: '#65523b', secret: '#66516e', grid: '#4c5d4e', label: '#dff0d9' },
  FORTRESS: { background: '#17191c', floor: '#4b4d52', corridor: '#3f4146', wall: '#c3c5c8', door: '#80522f', secret: '#744f74', grid: '#65676b', label: '#f4f4f4' },
  FOREST: { background: '#111910', floor: '#324b2e', corridor: '#2b3f29', wall: '#78936e', door: '#725034', secret: '#66516e', grid: '#466341', label: '#e0f2d8' },
  CITY: { background: '#1a1817', floor: '#514843', corridor: '#443c38', wall: '#b8aaa1', door: '#845630', secret: '#745174', grid: '#665b55', label: '#f4e6dc' },
  GENERAL: { background: '#17191d', floor: '#44484f', corridor: '#383c42', wall: '#b6a989', door: '#8a552f', secret: '#774866', grid: '#5d626a', label: '#f3e6c4' }
};

function svgEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderSvg(blueprint) {
  const palette = PALETTES[blueprint.style] ?? PALETTES.GENERAL;
  const size = blueprint.grid.size;
  const width = blueprint.dimensions.width;
  const height = blueprint.dimensions.height;
  const corridorWidth = Math.max(size * 0.9, 16);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    `<pattern id="grid" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><path d="M ${size} 0 L 0 0 0 ${size}" fill="none" stroke="${palette.grid}" stroke-opacity="0.28" stroke-width="2"/></pattern>`,
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.45"/></filter>',
    '</defs>',
    `<rect width="100%" height="100%" fill="${palette.background}"/>`,
    '<g filter="url(#shadow)">'
  ];
  for (const corridor of blueprint.corridors) {
    if (corridor.points.length < 2) continue;
    const points = corridor.points.map((point) => `${point.x * size},${point.y * size}`).join(' ');
    lines.push(`<polyline points="${points}" fill="none" stroke="${palette.corridor}" stroke-width="${corridorWidth}" stroke-linejoin="round" stroke-linecap="square"/>`);
  }
  for (const room of blueprint.rooms) {
    lines.push(`<rect x="${room.x * size}" y="${room.y * size}" width="${room.width * size}" height="${room.height * size}" rx="${Math.round(size * 0.08)}" fill="${palette.floor}"/>`);
  }
  lines.push('</g>');
  lines.push('<rect width="100%" height="100%" fill="url(#grid)"/>');
  for (const wall of blueprint.walls) {
    lines.push(`<line x1="${wall.x1 * size}" y1="${wall.y1 * size}" x2="${wall.x2 * size}" y2="${wall.y2 * size}" stroke="${palette.wall}" stroke-width="${Math.max(5, size * 0.07)}" stroke-linecap="square"/>`);
  }
  for (const door of blueprint.doors) {
    const color = door.type === 'SECRET' ? palette.secret : palette.door;
    const dash = door.type === 'SECRET' ? ' stroke-dasharray="12 8"' : '';
    lines.push(`<line x1="${door.x1 * size}" y1="${door.y1 * size}" x2="${door.x2 * size}" y2="${door.y2 * size}" stroke="${color}" stroke-width="${Math.max(8, size * 0.11)}" stroke-linecap="round"${dash}/>`);
  }
  for (const note of blueprint.notes) {
    lines.push(`<circle cx="${note.x * size}" cy="${note.y * size}" r="${Math.max(18, size * 0.24)}" fill="#1b1711" fill-opacity="0.86" stroke="${palette.label}" stroke-width="3"/>`);
    lines.push(`<text x="${note.x * size}" y="${note.y * size + Math.max(8, size * 0.08)}" text-anchor="middle" font-family="serif" font-size="${Math.max(24, size * 0.34)}" font-weight="700" fill="${palette.label}">${note.number}</text>`);
  }
  lines.push('</svg>');
  return lines.join('');
}

function blueprintSignature(blueprint) {
  const comparable = {
    style: blueprint.style,
    rooms: blueprint.rooms.map((room) => ({ label: room.label, kind: room.kind, width: room.width, height: room.height })),
    connections: blueprint.connections.map((entry) => ({ from: entry.from, to: entry.to, doorType: entry.doorType }))
  };
  return createHash('sha256').update(JSON.stringify(comparable)).digest('hex');
}

function publicBlueprint(blueprint, { includeSvg = false, includeSecrets = false } = {}) {
  if (!blueprint) return null;
  const result = clone(blueprint);
  if (!includeSvg) delete result.svg;
  if (!includeSecrets) {
    for (const room of result.rooms ?? []) delete room.secret;
    for (const note of result.notes ?? []) delete note.secret;
    for (const door of result.doors ?? []) delete door.secret;
    for (const connection of result.connections ?? []) delete connection.secret;
  }
  return result;
}

function summarizeCampaign(campaign) {
  const blueprints = Object.values(campaign?.blueprints ?? {})
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const counts = { DRAFT: 0, READY: 0, SCENE_CREATED: 0 };
  for (const blueprint of blueprints) counts[blueprint.status] = (counts[blueprint.status] ?? 0) + 1;
  return {
    campaignId: campaign?.id ?? 'default',
    count: blueprints.length,
    counts,
    updatedAt: campaign?.updatedAt ?? null,
    blueprints: blueprints.map((entry) => publicBlueprint(entry))
  };
}

function fallbackPlanFromInput(input, sourceArtifact = null) {
  const roomCount = clampInteger(input.roomCount ?? sourceArtifact?.metadata?.roomCount, 2, 40, 8);
  const title = compactText(input.title ?? sourceArtifact?.title, 300) || 'Dungeon automática';
  const labels = [];
  const content = String(sourceArtifact?.content ?? '');
  const headingRegex = /^#{1,4}\s+(?:área|area|sala|room)?\s*(\d+)[.:\-–]?\s*(.+)$/gim;
  let match;
  while ((match = headingRegex.exec(content)) && labels.length < roomCount) labels.push(compactText(match[2], 180));
  const rooms = Array.from({ length: roomCount }, (_, index) => ({
    id: `room-${index + 1}`,
    label: labels[index] || (index === 0 ? 'Entrada' : index === roomCount - 1 ? 'Objetivo final' : `Área ${index + 1}`),
    kind: index === 0 ? 'ENTRANCE' : index === roomCount - 1 ? 'OBJECTIVE' : 'ROOM',
    width: seededNumber(title, index * 3, 6, 11),
    height: seededNumber(title, index * 3 + 1, 5, 9),
    description: '',
    readAloud: '',
    secret: '',
    light: index % 5 === 0 ? 'DARK' : 'DIM'
  }));
  return {
    title,
    summary: compactText(input.prompt ?? sourceArtifact?.summary, 1800) || 'Planta procedural criada a partir do material da dungeon.',
    style: normalizeStyle(input.style ?? sourceArtifact?.metadata?.theme),
    tags: ['mapa', 'procedural'],
    rooms,
    connections: normalizeConnections([], rooms)
  };
}

export class InMemoryMapService {
  constructor({ narrator = null, generatorService = null, logger = console, maxAttempts = 2 } = {}) {
    this.narrator = narrator;
    this.generatorService = generatorService;
    this.logger = logger;
    this.maxAttempts = clampInteger(maxAttempts, 1, 5, 2);
    this.store = emptyStore();
    this.writeChain = Promise.resolve();
    this.generationChains = new Map();
  }

  async loadStore() { return this.store; }
  async saveStore(store) { this.store = store; }

  async mutate(operation) {
    const next = this.writeChain.then(async () => {
      const store = await this.loadStore();
      const result = await operation(store);
      await this.saveStore(store);
      return clone(result);
    });
    this.writeChain = next.catch(() => {});
    return next;
  }

  async list(campaignId, { status = null } = {}) {
    const key = safeId(campaignId, 'default');
    const store = await this.loadStore();
    const campaign = store.campaigns[key] ?? emptyCampaign(key);
    const snapshot = summarizeCampaign(campaign);
    const normalizedStatus = status ? normalizeStatus(status) : null;
    if (!normalizedStatus) return snapshot;
    return { ...snapshot, blueprints: snapshot.blueprints.filter((entry) => entry.status === normalizedStatus) };
  }

  async get(campaignId, mapId, options = {}) {
    const key = safeId(campaignId, 'default');
    const store = await this.loadStore();
    return publicBlueprint(store.campaigns[key]?.blueprints?.[safeId(mapId)] ?? null, options);
  }

  async generate(campaignId, input = {}) {
    const key = safeId(campaignId, 'default');
    const previous = this.generationChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.generateUnlocked(campaignId, input));
    this.generationChains.set(key, current);
    try { return await current; }
    finally { if (this.generationChains.get(key) === current) this.generationChains.delete(key); }
  }

  async generateUnlocked(campaignId, input = {}) {
    const key = safeId(campaignId, 'default');
    const sourceArtifactId = safeId(input.sourceArtifactId);
    const sourceArtifact = sourceArtifactId && this.generatorService?.get
      ? await this.generatorService.get(key, sourceArtifactId)
      : null;
    if (sourceArtifactId && !sourceArtifact) {
      const error = new Error('A dungeon selecionada não foi encontrada no arquivo da campanha.');
      error.code = 'MAP_SOURCE_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    if (sourceArtifact && sourceArtifact.type !== 'DUNGEON') {
      const error = new Error('Somente artefatos do tipo DUNGEON podem originar um mapa automático.');
      error.code = 'MAP_SOURCE_INVALID';
      error.statusCode = 400;
      throw error;
    }
    const prompt = compactText(input.prompt, 4000);
    if (!sourceArtifact && prompt.length < 10) throw new TypeError('Descreva o mapa ou selecione uma dungeon arquivada.');
    let abstractPlan = null;
    let aiGenerated = false;
    let lastError = null;
    if (this.narrator && typeof this.narrator.generateMapBlueprint === 'function') {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const raw = await this.narrator.generateMapBlueprint({
            title: compactText(input.title ?? sourceArtifact?.title, 300),
            prompt,
            style: normalizeStyle(input.style ?? sourceArtifact?.metadata?.theme),
            roomCount: clampInteger(input.roomCount ?? sourceArtifact?.metadata?.roomCount, 2, 80, 8),
            sourceArtifact: sourceArtifact ? {
              id: sourceArtifact.id,
              title: sourceArtifact.title,
              summary: sourceArtifact.summary,
              metadata: sourceArtifact.metadata,
              content: String(sourceArtifact.content ?? '').slice(0, 24000)
            } : null,
            attempt
          });
          abstractPlan = normalizePlan(raw, input);
          aiGenerated = true;
          break;
        } catch (error) {
          lastError = error;
          this.logger.warn?.('[Mestre Orc][Maps] planta da IA inválida; tentando novamente', { attempt, code: error.code });
        }
      }
    }
    if (!abstractPlan) {
      abstractPlan = fallbackPlanFromInput(input, sourceArtifact);
      if (lastError) this.logger.warn?.('[Mestre Orc][Maps] usando layout procedural seguro', { code: lastError.code });
    }
    const layout = layoutAbstractPlan(abstractPlan, { gridSize: clampInteger(input.gridSize, 50, 200, 100) });
    const now = new Date().toISOString();
    const blueprint = {
      id: randomUUID(),
      status: 'READY',
      title: abstractPlan.title,
      summary: abstractPlan.summary,
      style: abstractPlan.style,
      tags: abstractPlan.tags,
      source: {
        artifactId: sourceArtifact?.id ?? null,
        artifactTitle: sourceArtifact?.title ?? null,
        prompt,
        aiGenerated
      },
      ...layout,
      scene: null,
      createdAt: now,
      updatedAt: now
    };
    blueprint.svg = renderSvg(blueprint);
    blueprint.signature = blueprintSignature(blueprint);

    return this.mutate((store) => {
      const campaign = store.campaigns[key] ?? emptyCampaign(key);
      const duplicate = Object.values(campaign.blueprints).find((entry) => entry.signature === blueprint.signature);
      if (duplicate) {
        const error = new Error('Uma planta equivalente já existe nesta campanha.');
        error.code = 'MAP_DUPLICATE';
        error.statusCode = 409;
        error.mapId = duplicate.id;
        throw error;
      }
      campaign.sequence += 1;
      blueprint.sequence = campaign.sequence;
      campaign.blueprints[blueprint.id] = blueprint;
      campaign.updatedAt = now;
      store.campaigns[key] = campaign;
      return {
        blueprint: publicBlueprint(blueprint, { includeSvg: true, includeSecrets: true }),
        fallback: !aiGenerated,
        snapshot: summarizeCampaign(campaign)
      };
    });
  }

  async markSceneCreated(campaignId, mapId, scene = {}) {
    const key = safeId(campaignId, 'default');
    const mapKey = safeId(mapId);
    return this.mutate((store) => {
      const blueprint = store.campaigns[key]?.blueprints?.[mapKey];
      if (!blueprint) return null;
      blueprint.status = 'SCENE_CREATED';
      blueprint.scene = {
        id: compactText(scene.id, 200) || null,
        name: compactText(scene.name, 300) || blueprint.title,
        backgroundPath: compactText(scene.backgroundPath, 1000) || null,
        journalId: compactText(scene.journalId, 200) || null,
        createdAt: new Date().toISOString()
      };
      blueprint.updatedAt = new Date().toISOString();
      store.campaigns[key].updatedAt = blueprint.updatedAt;
      return { blueprint: publicBlueprint(blueprint, { includeSecrets: true }) };
    });
  }

  async remove(campaignId, mapId) {
    const key = safeId(campaignId, 'default');
    const mapKey = safeId(mapId);
    return this.mutate((store) => {
      const campaign = store.campaigns[key] ?? emptyCampaign(key);
      const removed = campaign.blueprints[mapKey] ?? null;
      if (removed) delete campaign.blueprints[mapKey];
      campaign.updatedAt = new Date().toISOString();
      store.campaigns[key] = campaign;
      return { removed: publicBlueprint(removed, { includeSecrets: true }), snapshot: summarizeCampaign(campaign) };
    });
  }
}

export class FileMapService extends InMemoryMapService {
  constructor({ filePath = DEFAULT_FILE, ...options } = {}) {
    super(options);
    this.filePath = resolve(filePath);
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.campaigns !== 'object') return;
      this.store = { version: STORE_VERSION, campaigns: parsed.campaigns };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Maps] arquivo inválido; iniciando vazio', { message: error.message });
      this.store = emptyStore();
    }
  }

  async loadStore() { return this.store; }

  async saveStore(store) {
    this.store = store;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}

export function createMapServiceFromEnv({ narrator, generatorService, logger = console, env = process.env } = {}) {
  return new FileMapService({
    narrator,
    generatorService,
    logger,
    filePath: env.MAP_BLUEPRINT_FILE || resolve(process.cwd(), env.MESTRE_ORC_DATA_DIRECTORY || 'data', 'map-blueprints.json'),
    maxAttempts: Number(env.MAP_GENERATION_MAX_ATTEMPTS) || 2
  });
}

export const MapStatuses = [...MAP_STATUSES];
export const MapStyles = [...MAP_STYLES];
export const mapInternals = {
  parsePayload,
  normalizePlan,
  layoutAbstractPlan,
  connectionGeometry,
  roomBoundary,
  corridorBoundary,
  renderSvg,
  blueprintSignature,
  fallbackPlanFromInput,
  summarizeCampaign
};
