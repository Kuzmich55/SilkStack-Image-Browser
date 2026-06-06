/**
 * AI Bridge — optional dependency abstraction layer.
 *
 * All AI features (LLM auto-tagging, prompt embeddings) flow through this module.
 * When the `@ai-images-browser/ai-intelligence` package is available, real
 * WebLLM-powered implementations are used. When absent, graceful fallbacks
 * ensure the app compiles and runs without AI features.
 *
 * Usage:
 *   const llm = await createLLMTagGenerator(modelId, onProgress);
 *   if (!llm) { ... handle unavailable case ... }
 *
 *   const tagger = await createTagGenerator();  // always succeeds (built-in fallback)
 */

// ── Local type declarations (mirrored from ai-intelligence) ──────────

/** Progress callback used during model loading. */
export interface LoadProgressReport {
  progress: number; // 0–1
  text: string;
}

/** Interface for rule-based tag extraction (no ML dependency). */
export interface ITagGenerator {
  generateTagsFromPrompt(prompt: string): Promise<string[]>;
}

/** Interface for LLM-powered tag extraction (WebLLM/WebGPU). */
export interface ILLMTagGenerator extends ITagGenerator {
  initialize(): Promise<void>;
  dispose(): void;
  readonly lastRawResponse: string | null;
  generateTagsFromPrompt(prompt: string, systemPrompt?: string): Promise<string[]>;
}

/** Interface for text embedding generation (WebLLM/WebGPU). */
export interface IEmbeddingProvider {
  readonly dimension: number;
  readonly modelId: string;
  initialize(): Promise<void>;
  embed(texts: string[]): Promise<Float32Array[]>;
  dispose(): void;
}

// ── Mirrored constants (always available, even without ai-intelligence) ──

/** Model used for LLM-based tag extraction. */
export const TAG_GENERATION_MODEL_ID = 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC';

/** Model used for prompt embedding generation. */
export const EMBEDDING_MODEL_ID = 'snowflake-arctic-embed-m-q0f32-MLC-b4';

/** Default system prompt for LLM tag generation. */
export const SYSTEM_PROMPT = `You are an expert image tagging and analyzing system that extracts visual concept tags from image generation prompts.

Rules:
- If the provided text is explicitly sex oriented, add 'nsfw' to the return list
- Return ONLY a valid JSON array of strings. No markdown, no explanations, no other text.
- Ignore quality keywords (masterpiece, 8k, award winning, etc.) and technical tokens (<lora:...>, etc.).
- Extract subjects, clothing, objects, settings, and styles.
- Keep tags simple and concise (no more than 2 words).
- For weighted tags like (cyberpunk city:1.2), extract just the descriptive text: "cyberpunk city".
- remove adjectives from subjects

Examples:
Input: a red fox sitting in a snowy forest, digital painting
Output: ["red fox", "snowy forest", "digital painting"]

Input: A oil painting in style of raja ravi varma, of a young busty fair beautiful and sexy indian girl holding a bouquet of flowers elegantly. bouquet with multi colored tulips, daffodils, in a majestic palace room. she is wearing an elegant yellow saree.
Output: ["oil painting", "raja ravi varma", "indian girl", "flowers", "tulips", "daffodils", "palace room", "yellow saree"]

Input: 1girl, solo, (cyberpunk city:1.2), neon lights, <lora:detailer:0.8>, 8k, high resolution
Output: ["1girl", "solo", "cyberpunk city", "neon lights"]`;

// ── Dynamic module loader ───────────────────────────────────────────

let aiModule: Record<string, unknown> | null = null;
let loadAttempted = false;
let loadError: string | null = null;

async function loadAiModule(): Promise<Record<string, unknown> | null> {
  if (loadAttempted) return aiModule;
  loadAttempted = true;

  // Compile-time guard: when ai-intelligence wasn't present at build time,
  // Vite dead-code-eliminates the import() below, so the module is never
  // resolved. This is what makes the dependency truly optional.
  if (!import.meta.env.VITE_AI_FEATURES_AVAILABLE) {
    loadError = 'AI features not available (ai-intelligence package not present at build time)';
    console.warn('[aiBridge] AI intelligence module not available at build time');
    return null;
  }

  try {
    aiModule = await import('@ai-images-browser/ai-intelligence');
    return aiModule;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.warn('[aiBridge] AI intelligence module unavailable:', loadError);
    return null;
  }
}

// ── Factory functions ────────────────────────────────────────────────

/**
 * Create an LLM-powered tag generator.
 * Returns `null` if the ai-intelligence module is unavailable or WebGPU
 * isn't supported.
 */
export async function createLLMTagGenerator(
  modelId: string = TAG_GENERATION_MODEL_ID,
  onProgress?: (report: LoadProgressReport) => void,
): Promise<ILLMTagGenerator | null> {
  const mod = await loadAiModule();
  if (!mod) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const LLMTagGenerator = (mod as any).LLMTagGenerator;
    if (!LLMTagGenerator) return null;
    return new LLMTagGenerator(modelId, onProgress) as ILLMTagGenerator;
  } catch (err) {
    console.warn('[aiBridge] Failed to create LLMTagGenerator:', err);
    return null;
  }
}

/**
 * Create a rule-based tag generator.
 * Always succeeds: uses the real TagGenerator from ai-intelligence if
 * available, otherwise falls back to the built-in implementation.
 */
export async function createTagGenerator(): Promise<ITagGenerator> {
  const mod = await loadAiModule();

  if (mod) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const TagGenerator = (mod as any).TagGenerator;
      if (TagGenerator) return new TagGenerator() as ITagGenerator;
    } catch {
      // Fall through to built-in fallback
    }
  }

  return new BuiltInTagGenerator();
}

/**
 * Create a WebLLM embedding provider.
 * Returns `null` if the ai-intelligence module is unavailable.
 */
export async function createEmbeddingProvider(
  modelId: string = EMBEDDING_MODEL_ID,
  dimension: number = 768,
  onProgress?: (report: LoadProgressReport) => void,
): Promise<IEmbeddingProvider | null> {
  const mod = await loadAiModule();
  if (!mod) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WebLLMEmbeddingProvider = (mod as any).WebLLMEmbeddingProvider;
    if (!WebLLMEmbeddingProvider) return null;
    return new WebLLMEmbeddingProvider(modelId, dimension, onProgress) as IEmbeddingProvider;
  } catch (err) {
    console.warn('[aiBridge] Failed to create EmbeddingProvider:', err);
    return null;
  }
}

// ── Stacking Engine ──────────────────────────────────────────────────

export type StackingProgressCallback = (current: number, total: number, message: string) => void;

export interface ISimilarityGroupInput {
  groups: Array<{ groupId: string; prompt: string }>;
  threshold?: number;
  onProgress?: StackingProgressCallback;
}

export interface ISimilarityGroupResult {
  groupIdToSimId: Map<string, string>;
}

export interface IStackingEngine {
  generatePromptHash(prompt: string): string;
  normalizePrompt(prompt: string): string;
  computeSimilarityGroupIds(input: ISimilarityGroupInput): Promise<ISimilarityGroupResult>;
}

/**
 * Create a stacking engine for prompt-based image grouping.
 * Returns `null` if the ai-intelligence module is unavailable.
 */
export async function createStackingEngine(): Promise<IStackingEngine | null> {
  const mod = await loadAiModule();
  if (!mod) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const StackingEngine = (mod as any).StackingEngine;
    if (!StackingEngine) return null;
    return new StackingEngine() as IStackingEngine;
  } catch (err) {
    console.warn('[aiBridge] Failed to create StackingEngine:', err);
    return null;
  }
}

// ── Diagnostics ──────────────────────────────────────────────────────

/** Check whether the ai-intelligence module is available at runtime. */
export async function isAiAvailable(): Promise<boolean> {
  return (await loadAiModule()) !== null;
}

/** Get the error message from the last load attempt, or null if successful. */
export async function getAiLoadError(): Promise<string | null> {
  await loadAiModule();
  return loadError;
}

// ── Built-in rule-based tag generator (no dependencies) ──────────────

/**
 * Minimal rule-based tag extractor for Stable Diffusion-style prompts.
 * Inlined from ai-intelligence so basic auto-tagging always works even
 * when the optional AI module is absent.
 */
class BuiltInTagGenerator implements ITagGenerator {
  async generateTagsFromPrompt(prompt: string): Promise<string[]> {
    return this.extractTags(prompt);
  }

  private extractTags(prompt: string): string[] {
    if (!prompt) return [];

    let cleaned = this.stripAngleBrackets(prompt);

    // Remove weight notation: (tag:1.2) → tag
    cleaned = cleaned.replace(/\(([^:)]+):\s*[0-9.]+\)/g, '$1');
    cleaned = cleaned.replace(/[\[\]\{\}\(\)]/g, ' ');

    // Remove weight suffixes: tag:1.2 → tag
    cleaned = cleaned.replace(/:\s*[0-9.]+/g, '');

    // Replace periods with commas (sentence separators → tag separators)
    cleaned = cleaned.replace(/\./g, ',');

    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to',
      'by', 'for', 'with', 'is', 'it', 'its', 'be', 'as', 'has',
      'from', 'are', 'was', 'were', 'been', 'being', 'have', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
      'might', 'can', 'shall', 'this', 'that', 'these', 'those',
      'very', 'really', 'highly', 'extremely', 'ultra', 'over',
      'her', 'his', 'their', 'itself', 'into', 'up', 'out', 'just',
      'about', 'above', 'after', 'again', 'all', 'also', 'any',
      'because', 'before', 'between', 'both', 'but', 'during',
      'each', 'few', 'further', 'how', 'if', 'more', 'most',
      'no', 'not', 'now', 'once', 'only', 'other', 'our',
      'own', 'same', 'she', 'so', 'some', 'such', 'than',
      'then', 'there', 'through', 'too', 'under', 'until',
      'what', 'when', 'where', 'which', 'while', 'who', 'why',
      'you', 'your', 'should', 'would', 'could', 'here',
    ]);

    const boilerplate = new Set([
      'masterpiece', 'best quality', 'high quality', 'award winning',
      'trending', 'viral', 'beautiful', 'stunning', 'gorgeous', 'amazing',
      'fantastic', 'wonderful', 'excellent', 'perfect', 'great', 'awesome',
      'breathtaking', 'epic', 'impressive', 'incredible', 'spectacular',
      'dynamic', 'stylized', 'elaborate', 'centered',
      '4k', '8k', 'hd', 'hdr', 'uhd', 'ultra hd', 'high resolution',
      'high detail', 'highly detailed', 'intricate details', 'sharp focus',
      'hyperrealistic', 'photorealistic', 'realistic', 'ultra realistic',
      'hype realistic', 'high-quality', 'high quality detail',
      'close up', 'rendered', 'artwork',
    ]);

    const parts = cleaned
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const tags: string[] = [];

    for (const part of parts) {
      const stripped = part.replace(/^(a|an|the)\s+/, '').trim();
      if (!stripped) continue;

      const words = stripped.split(/\s+/).filter((w) => w.length > 0);
      const contentWords = words.filter((w) => !stopWords.has(w) && w.length > 1);
      if (contentWords.length === 0) continue;

      if (words.length <= 4) {
        tags.push(stripped);
      } else {
        for (let i = 0; i < contentWords.length; i++) {
          tags.push(contentWords[i]);
          if (i + 1 < contentWords.length) {
            tags.push(`${contentWords[i]} ${contentWords[i + 1]}`);
          }
        }
      }
    }

    return this.removeSubsetTags(
      [...new Set(tags)]
        .filter((t) => {
          if (t.length < 3) return false;
          if (t.length > 60) return false;
          if (stopWords.has(t)) return false;
          if (boilerplate.has(t)) return false;
          if (/^\d+$/.test(t)) return false;
          if (/[<>]/.test(t)) return false;
          if (/^\W+$/.test(t)) return false;
          return true;
        }),
    ).slice(0, 10);
  }

  /** Strip angle-bracket tokens like <lora:name:1.0> from the prompt. */
  private stripAngleBrackets(text: string): string {
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .trim();
  }

  /**
   * Remove tags whose words are all contained within another, longer tag.
   * E.g. "dress" is removed when "red dress" is present.
   */
  private removeSubsetTags(tags: string[]): string[] {
    const unique = [...new Set(tags)];
    if (unique.length <= 1) return unique;

    return unique.filter((tag, i) => {
      const tagWords = tag.split(/\s+/).sort();
      return !unique.some((other, j) => {
        if (i === j || other === tag) return false;
        const otherWords = other.split(/\s+/).sort();
        if (
          tagWords.length === otherWords.length &&
          tagWords.every((w, idx) => w === otherWords[idx])
        ) {
          return i > j;
        }
        return (
          otherWords.length > tagWords.length &&
          tagWords.every((w) => otherWords.includes(w))
        );
      });
    });
  }
}
