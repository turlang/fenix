import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPriority, InMemoryAudioQueue } from '../packages/audio-queue/src/index.js';

test('fila prioriza transição de sala antes de áudio ambiente pendente', async () => {
  const calls = [];
  const queue = new InMemoryAudioQueue({
    async synthesize(job) {
      calls.push(job.id);
      return { id: job.id, ready: true };
    }
  });

  const ambient = queue.enqueue({ id: 'ambient', text: 'Som ambiente', priority: AudioPriority.AMBIENT });
  const room = queue.enqueue({ id: 'room', text: 'Entrada da sala', priority: AudioPriority.ROOM_ENTRY });
  await Promise.all([ambient, room]);

  assert.deepEqual(calls, ['room', 'ambient']);
  assert.equal(queue.getStatus().pending, 0);
});

test('fila deduplica sínteses idênticas ainda pendentes', async () => {
  let calls = 0;
  const queue = new InMemoryAudioQueue({
    async synthesize(job) {
      calls += 1;
      return { audioUrl: `memory://${job.id}` };
    }
  });

  const first = queue.enqueue({ text: 'A mesma fala', deduplicationKey: 'voice:text:hash' });
  const second = queue.enqueue({ text: 'A mesma fala', deduplicationKey: 'voice:text:hash' });
  assert.equal(first, second);
  await first;
  assert.equal(calls, 1);
});
