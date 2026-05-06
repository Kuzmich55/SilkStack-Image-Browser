/**
 * Auto-Tagging Web Worker
 *
 * Extracts auto-tags in the background using rule-based prompt parsing.
 * No model loading needed — TagGenerator is purely algorithmic.
 */

import type { AutoTag } from '../../types';
import type { TaggingImage } from '../autoTaggingEngine';
import { TagGenerator } from '@ai-images-browser/ai-intelligence';

type WorkerMessage =
  | {
      type: 'start';
      payload: {
        images: TaggingImage[];
        topN?: number;
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

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case 'start':
      await startAutoTagging(message.payload.images, {
        topN: message.payload.topN,
      });
      break;
    case 'cancel':
      isCancelled = true;
      postProgress(0, 0, 'Cancelled');
      break;
  }
};

async function startAutoTagging(
  images: TaggingImage[],
  options: { topN?: number }
): Promise<void> {
  try {
    isCancelled = false;
    postProgress(0, images.length, 'Extracting tags...');

    const tagGenerator = new TagGenerator();
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
        generatedTags = await tagGenerator.generateTagsFromPrompt(prompt);
      }

      if (options.topN && generatedTags.length > options.topN) {
        generatedTags = generatedTags.slice(0, options.topN);
      }

      autoTags[image.id] = [...new Set(generatedTags)].map(t => ({
        tag: t,
        sourceType: 'prompt' as const,
      }));

      postProgress(i + 1, total, `Generating auto-tags... (${i + 1}/${total})`);
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
