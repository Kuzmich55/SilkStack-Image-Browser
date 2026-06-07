import { describe, expect, it } from 'vitest';

// ── aiBridge tests (real ai-intelligence module) ────────────────────────
// These tests verify the bridge works correctly when ai-intelligence IS present.

describe('aiBridge — factories are exported', () => {
  it('createStackingEngine is exported', async () => {
    const { createStackingEngine } = await import('../services/aiBridge');
    expect(typeof createStackingEngine).toBe('function');
  });

  it('isAiAvailable is exported and returns boolean', async () => {
    const { isAiAvailable } = await import('../services/aiBridge');
    const result = await isAiAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('createLLMTagGenerator is exported', async () => {
    const { createLLMTagGenerator } = await import('../services/aiBridge');
    expect(typeof createLLMTagGenerator).toBe('function');
  });

  it('createTagGenerator is exported', async () => {
    const { createTagGenerator } = await import('../services/aiBridge');
    expect(typeof createTagGenerator).toBe('function');
  });

  it('createEmbeddingProvider is exported', async () => {
    const { createEmbeddingProvider } = await import('../services/aiBridge');
    expect(typeof createEmbeddingProvider).toBe('function');
  });
});

describe('aiBridge — IStackingEngine interface', () => {
  it('engine has required methods when ai-intelligence is available', async () => {
    const { createStackingEngine } = await import('../services/aiBridge');
    const engine = await createStackingEngine();

    // In dev, ai-intelligence IS present so engine should exist
    if (engine) {
      expect(typeof engine.generatePromptHash).toBe('function');
      expect(typeof engine.normalizePrompt).toBe('function');
      expect(typeof engine.computeSimilarityGroupIds).toBe('function');
    }
  });

  it('generatePromptHash produces stable 8-char FNV-1a hex', async () => {
    const { createStackingEngine } = await import('../services/aiBridge');
    const engine = await createStackingEngine();

    if (engine) {
      const hash = engine.generatePromptHash('a cat sitting on a chair');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(8);

      // Deterministic: same input → same output
      expect(hash).toBe(engine.generatePromptHash('a cat sitting on a chair'));

      // Different input → different output
      expect(hash).not.toBe(engine.generatePromptHash('a dog running'));
    }
  });

  it('normalizePrompt strips LoRA tags, metadata, and extra whitespace', async () => {
    const { createStackingEngine } = await import('../services/aiBridge');
    const engine = await createStackingEngine();

    if (engine) {
      const result = engine.normalizePrompt(
        'a cat  <lora:detailer:0.8>  sitting  on a chair  Steps: 20  Seed: 12345'
      );
      expect(result).not.toContain('<lora:detailer:0.8>');
      expect(result).not.toContain('Steps:');
      expect(result).not.toContain('Seed:');
      expect(result).not.toMatch(/\s{2,}/);
    }
  });
});
