export function roomNarrationEntryKey(tokenId, roomKey) {
  const token = String(tokenId ?? '').trim();
  const room = String(roomKey ?? '').trim();
  return token && room ? `${token}::${room}` : '';
}

export class RoomTransitionTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.sessionId = null;
    this.sceneId = null;
    this.primed = false;
    this.checking = false;
    this.lastRoomCheck = 0;
    this.tokenRooms = new Map();
    this.narratedEntries = new Set();
    this.inFlightEntries = new Set();
    return this;
  }

  activate(sessionId = null) {
    this.active = true;
    this.sessionId = sessionId || null;
    return this;
  }

  prime(sceneId, occupancies = []) {
    this.sceneId = String(sceneId ?? '');
    this.tokenRooms.clear();
    for (const occupancy of occupancies) {
      const tokenId = String(occupancy?.tokenId ?? '');
      const roomKey = String(occupancy?.roomKey ?? '');
      if (!tokenId || !roomKey) continue;
      this.tokenRooms.set(tokenId, roomKey);
      // A abertura já representa a posição inicial. Não publique uma segunda
      // descrição de sala enquanto os tokens continuam no mesmo lugar.
      this.narratedEntries.add(roomNarrationEntryKey(tokenId, roomKey));
    }
    this.primed = true;
    return this;
  }

  observe(tokenId, roomKey) {
    const id = String(tokenId ?? '');
    const current = roomKey ? String(roomKey) : null;
    const previous = this.tokenRooms.get(id) ?? null;

    if (!id) return { changed: false, entered: false, shouldNarrate: false, previous, current, entryKey: '' };
    if (!current) {
      if (previous) this.tokenRooms.delete(id);
      return { changed: Boolean(previous), entered: false, shouldNarrate: false, previous, current: null, entryKey: '' };
    }
    const entryKey = roomNarrationEntryKey(id, current);
    if (current === previous) {
      return { changed: false, entered: false, shouldNarrate: false, previous, current, entryKey };
    }

    this.tokenRooms.set(id, current);
    const shouldNarrate = !this.narratedEntries.has(entryKey) && !this.inFlightEntries.has(entryKey);
    return { changed: true, entered: true, shouldNarrate, previous, current, entryKey };
  }

  begin(entryKey) {
    const key = String(entryKey ?? '').trim();
    if (!key || this.narratedEntries.has(key) || this.inFlightEntries.has(key)) return false;
    this.inFlightEntries.add(key);
    return true;
  }

  complete(entryKey) {
    const key = String(entryKey ?? '').trim();
    if (!key) return;
    this.inFlightEntries.delete(key);
    this.narratedEntries.add(key);
  }

  fail(entryKey) {
    this.inFlightEntries.delete(String(entryKey ?? '').trim());
  }

  rollback(tokenId, previousRoomKey) {
    const id = String(tokenId ?? '');
    if (!id) return;
    if (previousRoomKey) this.tokenRooms.set(id, String(previousRoomKey));
    else this.tokenRooms.delete(id);
  }
}
