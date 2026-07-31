import { describe, it, expect } from 'vitest';
import { resolvePromptFromGraph, parseComfyUIMetadataEnhanced } from '../services/parsers/comfyUIParser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Subgraph prompt extraction through a routing node (ComfySwitchNode).
 *
 * The "Krea Generate" subgraph routes the positive prompt through a switch:
 *   subgraph text input → ComfySwitchNode (on_false = raw prompt,
 *   on_true = TextGenerate enhancement) → CLIPTextEncode
 *
 * The switch value (prompt_enhance) and the raw prompt are exposed as
 * widgets on the parent node — they must be propagated into the subgraph's
 * internal nodes even though there are no proxyWidgets definitions and no
 * external links on those inputs.
 */
describe('Subgraph prompt extraction through routing switch', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'comfyui', 'subgraph-switch-prompt.json');
  const rawData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const EXPECTED_PROMPT =
    'A whimsical watercolor painting of a beautiful woman standing outdoors. ' +
    'long thick wavy dark hair elegant saree with modern styling simple jewelry and ' +
    'bangles poised confident posture Kerala greenery and rustic architecture warm ' +
    'tropical sunlight';
  const EXPECTED_NEGATIVE = 'ugly, bad, blurred, watermark, dithered';

  it('extracts the parent widget prompt through the ComfySwitchNode routing path', () => {
    const result = resolvePromptFromGraph(rawData.workflow, undefined);
    expect(result.prompt).toBe(EXPECTED_PROMPT);
  });

  it('does NOT fall back to the stale internal CLIPTextEncode widget value', () => {
    const result = resolvePromptFromGraph(rawData.workflow, undefined);
    expect(result.prompt).not.toContain('tom cat');
    expect(result.prompt).not.toContain('tom and jerry');
    expect(result.prompt).not.toContain('ye-pop');
  });

  it('extracts the negative prompt via the text_1 subgraph input', () => {
    const result = resolvePromptFromGraph(rawData.workflow, undefined);
    expect(result.negativePrompt).toBe(EXPECTED_NEGATIVE);
  });

  it('does NOT confuse the LLM system prompt with the image prompt', () => {
    const result = resolvePromptFromGraph(rawData.workflow, undefined);
    expect(result.prompt).not.toContain('You are an expert prompt engineer');
    expect(result.prompt).not.toContain('text-to-image models');
  });

  it('works through parseComfyUIMetadataEnhanced as well', async () => {
    const result = await parseComfyUIMetadataEnhanced(rawData);
    expect(result.prompt).toBe(EXPECTED_PROMPT);
    expect(result.negativePrompt).toBe(EXPECTED_NEGATIVE);
  });

  it('extracts the prompt when the switch is off (on_false path)', () => {
    // Turn prompt_enhance off on the parent node
    const workflow = JSON.parse(JSON.stringify(rawData.workflow));
    const parent = workflow.nodes.find((n: any) => n.id === 152);
    parent.widgets_values[parent.widgets_values.length - 1] = false;

    const result = resolvePromptFromGraph(workflow, undefined);
    expect(result.prompt).toBe(EXPECTED_PROMPT);
  });
});
