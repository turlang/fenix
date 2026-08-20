function encoded(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

export function promoteImportedEntity(client, campaignId, adventureId, sourceUuid, { actorType = 'npc' } = {}) {
  if (!client?.request) throw new TypeError('FenixApiClient é obrigatório.');
  return client.request(`/v1/campaigns/${encoded(campaignId)}/content/${encoded(adventureId)}/entities/${encoded(sourceUuid)}/promote`, {
    method: 'POST',
    body: { actorType }
  });
}

export function resolveFoundrySyncReview(client, campaignId, adventureId, sourceUuid, action) {
  if (!client?.request) throw new TypeError('FenixApiClient é obrigatório.');
  if (!['keep-local', 'accept-source', 'detach'].includes(action)) throw new TypeError('Ação de sync inválida.');
  return client.request(`/v1/campaigns/${encoded(campaignId)}/content/${encoded(adventureId)}/sync-foundry/resolve`, {
    method: 'POST',
    body: { decisions: [{ sourceUuid: String(sourceUuid ?? ''), action }] }
  });
}

export async function getPromotedNativeEntity(client, campaignId, promotion) {
  if (!promotion?.nativeId || !promotion?.nativeType) return null;
  if (promotion.nativeType === 'actor') {
    const result = await client.getActor(campaignId, promotion.nativeId);
    return result.actor ?? null;
  }
  if (promotion.nativeType === 'item') {
    const result = await client.request(`/v1/campaigns/${encoded(campaignId)}/items/${encoded(promotion.nativeId)}`);
    return result.item ?? null;
  }
  return null;
}
