export function normalizeRecipientUserIds(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}

export function audioTargetsUser(directive, userId) {
  const recipients = normalizeRecipientUserIds(directive?.recipientUserIds);
  if (recipients === null) return true;
  return recipients.includes(String(userId ?? ''));
}

function asUsers(users) {
  if (Array.isArray(users)) return users;
  if (Array.isArray(users?.contents)) return users.contents;
  try {
    return [...(users ?? [])];
  } catch {
    return [];
  }
}

function userOwnsActor(actor, user, ownerLevel) {
  if (!actor || !user) return false;
  if (typeof actor.testUserPermission === 'function') {
    try {
      if (actor.testUserPermission(user, 'OWNER')) return true;
    } catch {
      // Instalações antigas podem não aceitar o nível como texto.
    }
  }
  const ownership = actor.ownership ?? {};
  const level = ownership[user.id] ?? ownership.default ?? 0;
  return Number(level) >= Number(ownerLevel);
}

export function ownerUserIdsForToken(token, users, ownerLevel = 3) {
  const document = token?.document ?? token ?? {};
  const actor = document.actor ?? token?.actor ?? null;
  if (!actor) return [];
  return asUsers(users)
    .filter((user) => user && !user.isGM && user.active !== false && userOwnsActor(actor, user, ownerLevel))
    .map((user) => String(user.id ?? '').trim())
    .filter(Boolean);
}
