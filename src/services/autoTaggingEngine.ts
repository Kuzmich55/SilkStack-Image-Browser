import type { ImageMetadata, LoRAInfo } from '../types';

export interface TaggingImage {
  id: string;
  prompt?: string;
  models?: string[];
  loras?: Array<string | LoRAInfo>;
  metadata?: ImageMetadata;
}

export interface AutoTaggingOptions {
  topN?: number;
  minScore?: number;
}
