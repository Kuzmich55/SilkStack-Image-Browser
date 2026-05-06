/**
 * Embedding Web Worker
 *
 * Loads a Snowflake Arctic Embed model via WebLLM (WebGPU) and generates
 * L2-normalized embedding vectors for prompt text batches.
 *
 * Protocol ─────────────────────────────────────────────────────────
 *  Main → Worker:
 *   { type: 'init',    payload: { modelId?: string } }
 *   { type: 'embed',   payload: { texts: string[]; requestId: string } }
 *   { type: 'cancel' }
 *
 *  Worker → Main:
 *   { type: 'progress',    payload: { progress: number; text: string } }
 *   { type: 'ready',       payload: { modelId: string; dimension: number } }
 *   { type: 'embeddings',  payload: { embeddings: Float32Array[]; requestId: string; done: number; total: number } }
 *   { type: 'error',       payload: { error: string; requestId?: string } }
 */

import {
  WebLLMEmbeddingProvider,
  EMBEDDING_MODEL_ID,
} from '@ai-images-browser/ai-intelligence';

// Arctic Embed M produces 768-dimensional vectors
const EMBEDDING_DIMENSION = 768;

type WorkerRequest =
  | { type: 'init'; payload?: { modelId?: string } }
  | { type: 'embed'; payload: { texts: string[]; requestId: string } }
  | { type: 'cancel' };

type WorkerResponse =
  | { type: 'progress'; payload: { progress: number; text: string } }
  | { type: 'ready'; payload: { modelId: string; dimension: number } }
  | {
      type: 'embeddings';
      payload: { embeddings: Float32Array[]; requestId: string; done: number; total: number };
    }
  | { type: 'error'; payload: { error: string; requestId?: string } };

let provider: WebLLMEmbeddingProvider | null = null;
let isCancelled = false;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      await handleInit(msg.payload?.modelId);
      break;
    case 'embed':
      await handleEmbed(msg.payload.texts, msg.payload.requestId);
      break;
    case 'cancel':
      isCancelled = true;
      break;
  }
};

async function handleInit(modelIdOverride?: string): Promise<void> {
  try {
    isCancelled = false;
    const modelId = modelIdOverride ?? EMBEDDING_MODEL_ID;

    postProgress(0, `Loading embedding model...`);

    provider = new WebLLMEmbeddingProvider(modelId, EMBEDDING_DIMENSION, (report) => {
      // report.progress is 0–1; report.text describes current step
      postProgress(report.progress, report.text ?? 'Downloading model weights...');
    });

    await provider.initialize();

    if (isCancelled) return;

    postReady(modelId);
  } catch (err) {
    postError(err instanceof Error ? err.message : String(err));
  }
}

async function handleEmbed(texts: string[], requestId: string): Promise<void> {
  try {
    if (!provider) {
      postError('Provider not initialized. Send "init" first.', requestId);
      return;
    }
    if (isCancelled) return;

    const total = texts.length;
    const embeddings = await provider.embed(texts);

    if (isCancelled) return;

    // Transfer Float32Array buffers for zero-copy postMessage
    const buffers = embeddings.map((e) => e.buffer as ArrayBuffer);
    const response: WorkerResponse = {
      type: 'embeddings',
      payload: { embeddings, requestId, done: total, total },
    };
    // Use bare postMessage — the global in DedicatedWorkerGlobalScope accepts Transferable[]
    postMessage(response, buffers);
  } catch (err) {
    postError(err instanceof Error ? err.message : String(err), requestId);
  }
}

function postProgress(progress: number, text: string): void {
  self.postMessage({
    type: 'progress',
    payload: { progress, text },
  } satisfies WorkerResponse);
}

function postReady(modelId: string): void {
  self.postMessage({
    type: 'ready',
    payload: { modelId, dimension: EMBEDDING_DIMENSION },
  } satisfies WorkerResponse);
}

function postError(error: string, requestId?: string): void {
  self.postMessage({
    type: 'error',
    payload: { error, requestId },
  } satisfies WorkerResponse);
}
