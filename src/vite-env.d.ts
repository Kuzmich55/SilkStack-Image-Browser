/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMH_LICENSE_SECRET: string
  readonly VITE_APP_VERSION: string
  readonly VITE_AI_FEATURES_AVAILABLE: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Ambient type declarations for the optional ai-intelligence package.
// When the package is present, its own .d.ts files take precedence.
// When absent, these stubs let tsc resolve the dynamic import() in aiBridge.ts.
declare module '@ai-images-browser/ai-intelligence' {
  export interface LoadProgressReport {
    progress: number;
    text: string;
  }

  export class LLMTagGenerator {
    constructor(modelId: string, onProgress?: (report: LoadProgressReport) => void);
    initialize(): Promise<void>;
    generateTagsFromPrompt(prompt: string, systemPrompt?: string): Promise<string[]>;
    dispose(): void;
    readonly lastRawResponse: string | null;
  }

  export class TagGenerator {
    generateTagsFromPrompt(prompt: string): Promise<string[]>;
  }

  export class WebLLMEmbeddingProvider {
    constructor(
      modelId: string,
      dimension: number,
      onProgress?: (report: LoadProgressReport) => void,
    );
    readonly dimension: number;
    readonly modelId: string;
    initialize(): Promise<void>;
    embed(texts: string[]): Promise<Float32Array[]>;
    dispose(): void;
  }

  export const TAG_GENERATION_MODEL_ID: string;
  export const EMBEDDING_MODEL_ID: string;
  export const SYSTEM_PROMPT: string;
}
