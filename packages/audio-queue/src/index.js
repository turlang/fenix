export const AudioPriority = Object.freeze({
  ROOM_ENTRY: 0,
  CUTSCENE: 0,
  ACTION_RESOLUTION: 10,
  NPC_DIALOGUE: 20,
  AMBIENT: 30
});

function normalizeJob(input = {}) {
  const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new TypeError('AudioJob.text é obrigatório.');
  return {
    id: String(input.id ?? crypto.randomUUID()),
    text,
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : AudioPriority.AMBIENT,
    deduplicationKey: String(input.deduplicationKey ?? '').trim() || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export class InMemoryAudioQueue {
  constructor({ synthesize, maxPending = 100, logger = console } = {}) {
    if (typeof synthesize !== 'function') throw new TypeError('synthesize é obrigatório.');
    this.synthesize = synthesize;
    this.maxPending = Math.max(1, Number(maxPending) || 100);
    this.logger = logger;
    this.pending = [];
    this.inFlight = false;
    this.deduplication = new Map();
  }

  enqueue(input) {
    const job = normalizeJob(input);
    if (job.deduplicationKey && this.deduplication.has(job.deduplicationKey)) {
      return this.deduplication.get(job.deduplicationKey);
    }
    if (this.pending.length >= this.maxPending) {
      const error = new Error('Fila de áudio cheia.');
      error.code = 'AUDIO_QUEUE_FULL';
      return Promise.reject(error);
    }

    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const entry = { job, resolve: resolveJob, reject: rejectJob, promise };
    this.pending.push(entry);
    this.pending.sort((left, right) =>
      left.job.priority - right.job.priority ||
      Date.parse(left.job.createdAt) - Date.parse(right.job.createdAt)
    );
    if (job.deduplicationKey) this.deduplication.set(job.deduplicationKey, promise);
    queueMicrotask(() => this.#drain());
    return promise;
  }

  getStatus() {
    return {
      pending: this.pending.length,
      inFlight: this.inFlight,
      deduplicatedKeys: this.deduplication.size
    };
  }

  async #drain() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.pending.length) {
        const entry = this.pending.shift();
        try {
          const result = await this.synthesize(entry.job);
          entry.resolve(result);
        } catch (error) {
          this.logger.error?.('[Fênix][AudioQueue] síntese falhou', {
            jobId: entry.job.id,
            message: error.message
          });
          entry.reject(error);
        } finally {
          if (entry.job.deduplicationKey) {
            this.deduplication.delete(entry.job.deduplicationKey);
          }
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
