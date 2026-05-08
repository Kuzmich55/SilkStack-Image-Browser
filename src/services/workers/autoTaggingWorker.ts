/**
 * Auto-Tagging Web Worker
 *
 * The worker initializes the LLM-based Tag Generator (Llama 3.2 3B) when
 * WebGPU is available, falling back to rule-based extraction on errors or
 * unsupported environments.
 */

import type { AutoTag } from '../../types';
import type { TaggingImage } from '../autoTaggingEngine';
import {
  LLMTagGenerator,
  TagGenerator,
  TAG_GENERATION_MODEL_ID,
} from '@ai-images-browser/ai-intelligence';

type WorkerMessage =
  | {
      type: 'start';
      payload: {
        images: TaggingImage[];
        topN?: number;
        disableFallback?: boolean;
      };
    }
  | { type: 'cancel' };

type WorkerResponse =
  | {
      type: 'progress';
      payload: {
        current: number;
        total: number;
        message: string;
      };
    }
  | {
      type: 'complete';
      payload: {
        autoTags: Record<string, AutoTag[]>;
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

let isCancelled = false;
let llmGenerator: LLMTagGenerator | null = null;
let fallbackGenerator: TagGenerator | null = null;
let llmInitError: string | null = null;
let mode: 'llm' | 'fallback' = 'fallback';

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case 'start':
      await startAutoTagging(message.payload.images, {
        topN: message.payload.topN,
        disableFallback: message.payload.disableFallback,
      });
      break;
    case 'cancel':
      isCancelled = true;
      postProgress(0, 0, 'Cancelled');
      break;
  }
};

async function initLLM(): Promise<boolean> {
  if (llmGenerator) return true;

  postProgress(0, 0, 'Loading tag generation model...');

  try {
    llmGenerator = new LLMTagGenerator(TAG_GENERATION_MODEL_ID, (report) => {
      if (!isCancelled) {
        postProgress(report.progress, 0, `Loading model: ${report.text}`);
      }
    });

    await llmGenerator.initialize();

    if (!isCancelled) {
      mode = 'llm';
      return true;
    }
  } catch (err) {
    llmInitError = err instanceof Error ? err.message : String(err);
    console.warn('[autoTaggingWorker] LLM model failed to load, falling back to rule-based:', err);
  }

  return false;
}

function getFallbackGenerator(): TagGenerator {
  if (!fallbackGenerator) {
    fallbackGenerator = new TagGenerator();
  }
  return fallbackGenerator;
}

async function startAutoTagging(
  images: TaggingImage[],
  options: { topN?: number; disableFallback?: boolean },
): Promise<void> {
  try {
    isCancelled = false;

    // Try LLM first; fall back to rule-based if WebGPU/model unavailable
    const llmReady = await initLLM();

    if (isCancelled) return;

    if (!llmReady && options.disableFallback) {
      const detail = llmInitError ? ` Reason: ${llmInitError}` : '';
      postError(`AI model failed to load and fallback is disabled. Enable the fallback in Settings or check that WebGPU is available.${detail}`);
      return;
    }

    const autoTags: Record<string, AutoTag[]> = {};
    const total = images.length;

    for (let i = 0; i < images.length; i += 1) {
      if (isCancelled) {
        postProgress(0, 0, 'Cancelled');
        return;
      }

      const image = images[i];
      const prompt = image.prompt || '';

      let generatedTags: string[] = [];
      if (prompt.trim()) {
        if (llmReady && llmGenerator) {
          generatedTags = await llmGenerator.generateTagsFromPrompt(prompt);
        } else {
          generatedTags = await getFallbackGenerator().generateTagsFromPrompt(prompt);
        }
      }

      if (options.topN && generatedTags.length > options.topN) {
        generatedTags = generatedTags.slice(0, options.topN);
      }

      autoTags[image.id] = [...new Set(generatedTags)].map((t) => ({
        tag: t,
        sourceType: 'prompt' as const,
      }));

      const label = mode === 'llm' ? 'Generating AI tags' : 'Extracting tags';
      postProgress(i + 1, total, `${label}... (${i + 1}/${total})`);
    }

    // Clean up LLM engine to free GPU memory
    if (llmGenerator) {
      llmGenerator.dispose();
      llmGenerator = null;
    }

    postComplete(autoTags);
  } catch (error) {
    console.error('Auto-tagging worker error:', error);
    postError(error instanceof Error ? error.message : String(error));
  }
}

function postProgress(current: number, total: number, message: string): void {
  const response: WorkerResponse = {
    type: 'progress',
    payload: { current, total, message },
  };
  self.postMessage(response);
}

function postComplete(autoTags: Record<string, AutoTag[]>): void {
  const response: WorkerResponse = {
    type: 'complete',
    payload: { autoTags },
  };
  self.postMessage(response);
}

function postError(error: string): void {
  const response: WorkerResponse = {
    type: 'error',
    payload: { error },
  };
  self.postMessage(response);
}

export type { WorkerMessage, WorkerResponse };
