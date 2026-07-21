import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function clone(value) {
  return structuredClone(value);
}

export class InMemoryNarrationMemory {
  records = [];

  async list(sceneKey, { limit = 20 } = {}) {
    return clone(this.records.filter((record) => record.sceneKey === sceneKey).slice(-limit));
  }

  async append(record) {
    this.records.push(clone(record));
    return clone(record);
  }
}

export class FileNarrationMemory {
  constructor({ filePath, logger = console, maxRecords = 2500 } = {}) {
    if (!filePath) throw new TypeError('filePath é obrigatório.');
    this.filePath = filePath;
    this.logger = logger;
    this.maxRecords = maxRecords;
    this.loaded = false;
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async #load() {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.records = Array.isArray(parsed?.records) ? parsed.records : [];
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn?.('[Mestre Orc][NarrationMemory] arquivo inválido; iniciando vazio', { message: error.message });
      this.records = [];
    }
    this.loaded = true;
  }

  async list(sceneKey, { limit = 20 } = {}) {
    await this.#load();
    return clone(this.records.filter((record) => record.sceneKey === sceneKey).slice(-limit));
  }

  async append(record) {
    await this.#load();
    this.records.push(clone(record));
    if (this.records.length > this.maxRecords) this.records = this.records.slice(-this.maxRecords);
    this.writeQueue = this.writeQueue.then(() => this.#persist());
    await this.writeQueue;
    return clone(record);
  }

  async #persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, records: this.records }, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }
}

export function createNarrationMemoryFromEnv({ logger = console } = {}) {
  const filePath = process.env.MESTRE_ORC_NARRATION_MEMORY_FILE?.trim()
    || path.resolve(process.cwd(), 'data', 'narration-history.json');
  return new FileNarrationMemory({ filePath, logger });
}
