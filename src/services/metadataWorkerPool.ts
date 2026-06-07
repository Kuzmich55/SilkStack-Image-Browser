/**
 * Metadata Worker Pool
 *
 * Manages a pool of Web Workers for parallel metadata parsing. Uses a
 * round-robin distribution strategy to keep all workers equally busy.
 *
 * Usage:
 *   const pool = new MetadataWorkerPool(4);
 *   const { metadata, dimensions } = await pool.parse(buffer, 'image.png');
 *   pool.terminate();
 */

import type {
  MetadataWorkerInput,
  MetadataWorkerOutput,
} from './workers/metadataWorker';

interface PendingRequest {
  resolve: (value: MetadataWorkerOutput) => void;
  reject: (reason: Error) => void;
}

export class MetadataWorkerPool {
  private workers: Worker[];
  private pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private nextWorker = 0;

  /**
   * @param poolSize Number of workers. Defaults to half of available cores
   *                 (minimum 1, maximum 8) to leave room for other processing.
   */
  constructor(poolSize?: number) {
    const cores = navigator.hardwareConcurrency || 4;
    const size = poolSize ?? Math.max(1, Math.min(8, Math.floor(cores / 2)));
    this.workers = [];

    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL('./workers/metadataWorker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e: MessageEvent<MetadataWorkerOutput>) => {
        const { id } = e.data;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.resolve(e.data);
        }
      };
      worker.onerror = (err: ErrorEvent) => {
        // Reject all pending requests on a failed worker
        console.error('[MetadataWorkerPool] Worker error:', err);
        for (const [id, pending] of this.pending) {
          pending.reject(new Error(err.message || 'Worker error'));
        }
        this.pending.clear();
      };
      this.workers.push(worker);
    }
  }

  /**
   * Parse metadata from an ArrayBuffer.
   * Returns the raw metadata and dimensions extracted from the binary data.
   */
  async parse(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<MetadataWorkerOutput> {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker++;

    const promise = new Promise<MetadataWorkerOutput>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    const input: MetadataWorkerInput = { id, buffer, fileName };
    // Transfer the ArrayBuffer for zero-copy — the main thread
    // relinquishes ownership, the worker gets it directly.
    worker.postMessage(input, [buffer]);

    return promise;
  }

  /** Number of active workers in the pool. */
  get size(): number {
    return this.workers.length;
  }

  /** Number of requests currently being processed. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Terminate all workers and clear pending requests. */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;

    for (const [, pending] of this.pending) {
      pending.reject(new Error('Worker pool terminated'));
    }
    this.pending.clear();
  }
}
