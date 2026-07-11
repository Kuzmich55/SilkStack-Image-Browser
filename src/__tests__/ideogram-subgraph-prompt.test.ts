import { describe, it, expect } from 'vitest';
import { resolvePromptFromGraph, parseComfyUIMetadataEnhanced } from '../services/parsers/comfyUIParser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ideogram 4.0 subgraph prompt extraction tests.
 *
 * Verifies that structured JSON prompts (Ideogram 4.0 caption format) embedded
 * inside CLIPTextEncode nodes within ComfyUI subgraphs are correctly extracted
 * through every code path — string inputs, parsed object inputs, enhanced
 * parser, and workflow-only (no separate API prompt).
 */
describe('Ideogram 4.0 subgraph prompt extraction', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'comfyui', 'ideogram4-workflow.json');
  const rawData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const assertValidJsonPrompt = (prompt: unknown) => {
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
    expect(prompt as string).toContain('high_level_description');
    expect(prompt as string).toContain('compositional_deconstruction');
    expect(prompt as string).toContain('COMFY');
    // Must be valid JSON
    expect(() => JSON.parse(prompt as string)).not.toThrow();
  };

  it('resolvePromptFromGraph with string inputs (raw PNG chunks)', () => {
    const result = resolvePromptFromGraph(rawData.workflow, rawData.prompt);
    assertValidJsonPrompt(result.prompt);
  });

  it('resolvePromptFromGraph with parsed objects (metadataParserFactory path)', () => {
    const workflow = JSON.parse(rawData.workflow);
    const prompt = JSON.parse(rawData.prompt);
    const result = resolvePromptFromGraph(workflow, prompt);
    assertValidJsonPrompt(result.prompt);
  });

  it('parseComfyUIMetadataEnhanced with string rawData', async () => {
    const result = await parseComfyUIMetadataEnhanced(JSON.stringify(rawData));
    assertValidJsonPrompt(result.prompt);
  });

  it('parseComfyUIMetadataEnhanced with object rawData', async () => {
    const result = await parseComfyUIMetadataEnhanced(rawData);
    assertValidJsonPrompt(result.prompt);
  });

  it('workflow-only (no separate API prompt chunk)', () => {
    const workflow = JSON.parse(rawData.workflow);
    const result = resolvePromptFromGraph(workflow, undefined);
    assertValidJsonPrompt(result.prompt);
  });
});

describe('Ideogram 4.0 model name extraction', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'comfyui', 'ideogram4-workflow.json');
  const rawData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  it('should extract the positive (conditional) model name from UNETLoader via DualModelGuider and CFGOverride', () => {
    const result = resolvePromptFromGraph(rawData.workflow, rawData.prompt);
    // The model should be extracted by tracing:
    // SamplerCustomAdvanced → guider → DualModelGuider → model → CFGOverride → model → UNETLoader
    // The UNETLoader node 23 has widgets_values: ["ideogram4_int8_convrot.safetensors", "default"]
    expect(result.model).toBe('ideogram4_int8_convrot.safetensors');
  });

  it('should extract the model even with parsed objects', () => {
    const workflow = JSON.parse(rawData.workflow);
    const prompt = JSON.parse(rawData.prompt);
    const result = resolvePromptFromGraph(workflow, prompt);
    expect(result.model).toBe('ideogram4_int8_convrot.safetensors');
  });

  it('should NOT extract the unconditional model (model_negative)', () => {
    const result = resolvePromptFromGraph(rawData.workflow, rawData.prompt);
    // The unconditional model (node 154) has "ideogram4_unconditional_int8_convrot.safetensors"
    // This should NOT be extracted as the main model
    expect(result.model).not.toBe('ideogram4_unconditional_int8_convrot.safetensors');
    expect(result.model).not.toContain('unconditional');
  });
});
