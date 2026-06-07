/**
 * Metadata Parsing Web Worker
 *
 * Receives raw ArrayBuffers from the main thread, parses image metadata
 * using the binary parsers (PNG chunks, EXIF, WebP RIFF), and returns
 * structured metadata. Runs entirely off the main thread — no Electron,
 * window, or DOM access needed.
 */

import { parseImageBuffer, extractDimensionsFromBuffer } from '../parsers/binaryParsers';
import type { ImageMetadata } from '../../types';

export interface MetadataWorkerInput {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
}

export interface MetadataWorkerOutput {
  id: number;
  metadata: ImageMetadata | null;
  dimensions: { width: number; height: number } | null;
  error: string | null;
}

self.onmessage = async (e: MessageEvent<MetadataWorkerInput>) => {
  const { id, buffer, fileName } = e.data;

  try {
    const [metadata, dimensions] = await Promise.all([
      parseImageBuffer(buffer),
      Promise.resolve(extractDimensionsFromBuffer(buffer)),
    ]);

    const output: MetadataWorkerOutput = {
      id,
      metadata,
      dimensions,
      error: null,
    };
    self.postMessage(output);
  } catch (err) {
    const output: MetadataWorkerOutput = {
      id,
      metadata: null,
      dimensions: null,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(output);
  }
};
