export class InMemoryCampaignMemory {
  #events = [];
  append(event) { this.#events.push(structuredClone(event)); }
  list() { return structuredClone(this.#events); }
}
