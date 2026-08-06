import { describe, it, expect } from 'vitest';
import { resolvePromptFromGraph, parseComfyUIMetadataEnhanced } from '../services/parsers/comfyUIParser';

/**
 * ComfyUI API/execution prompt format regression tests.
 *
 * The API format is a map of nodeId → { class_type, inputs } (subgraph
 * instances flatten their internal ids, e.g. "84:75"). Some save/export
 * paths store it under the `workflow` key instead of `prompt` — the parser
 * must detect the format and promote it regardless of the key it arrives in.
 */

const API_PROMPT = {
  '84:75': { inputs: { ckpt_name: 'aMixIllustrious_aMix.safetensors' }, class_type: 'CheckpointLoaderSimple' },
  76: {
    inputs: {
      lora_1: { on: false, lora: 'Illustrious\\Disney_Animation_v5-V7.safetensors', strength: 0.3 },
      lora_8: { on: true, lora: 'rimixO-Pony-XL-Illustrious-Flux.safetensors', strength: 0.9 },
      model: ['84:75', 0],
      clip: ['84:75', 1],
    },
    class_type: 'Power Lora Loader (rgthree)',
  },
  '84:72': { inputs: { text: 'leia_organa, starwars, 1girl, masterwork, best quality', clip: ['84:71', 0] }, class_type: 'CLIPTextEncode' },
  '84:73': { inputs: { text: 'embedding:lazyneg, bad quality', clip: ['84:71', 0] }, class_type: 'CLIPTextEncode' },
  '84:71': { inputs: { stop_at_clip_layer: -2, clip: ['76', 1] }, class_type: 'CLIPSetLastLayer' },
  '84:81': {
    inputs: {
      seed: 809723627235556, steps: 40, cfg: 5, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 0.5,
      model: ['76', 0], positive: ['84:72', 0], negative: ['84:73', 0], latent_image: ['84:70', 0],
    },
    class_type: 'KSampler',
  },
};

describe('ComfyUI API-format prompt', () => {
  it('extracts model/prompt when the API map arrives under the workflow key', () => {
    const r = resolvePromptFromGraph(API_PROMPT as any, undefined);
    expect(r.model).toBe('aMixIllustrious_aMix.safetensors');
    expect(r.prompt).toContain('leia_organa');
    expect(r.negativePrompt).toContain('embedding:lazyneg');
    expect(r.steps).toBe(40);
    expect(r.seed).toBe(809723627235556);
    expect(r.sampler_name).toBe('euler_ancestral');
  });

  it('extracts the same when the API map arrives under the prompt key', () => {
    const r = resolvePromptFromGraph(undefined, API_PROMPT as any);
    expect(r.model).toBe('aMixIllustrious_aMix.safetensors');
    expect(r.prompt).toContain('leia_organa');
    expect(r.steps).toBe(40);
  });

  it('extracts only enabled LoRAs from API-format Power Lora Loader inputs', () => {
    const r = resolvePromptFromGraph(undefined, API_PROMPT as any);
    expect(r.lora).toContain('rimixO-Pony-XL-Illustrious-Flux');
    expect(r.lora).not.toContain('Disney_Animation_v5-V7');
  });

  it('does not promote UI-format workflows to the prompt slot', () => {
    const uiWorkflow = {
      last_node_id: 3,
      nodes: [{ id: 3, type: 'KSampler', mode: 0, inputs: [], outputs: [], widgets_values: [] }],
      links: [],
    };
    const r = resolvePromptFromGraph(uiWorkflow as any, undefined);
    // UI format must stay in the workflow slot — no promotion, no crash
    expect(r).toBeDefined();
    expect(r._telemetry?.warnings).toBeDefined();
  });

  it('works through parseComfyUIMetadataEnhanced', async () => {
    const r = await parseComfyUIMetadataEnhanced({ workflow: API_PROMPT } as any);
    expect(r.model).toBe('aMixIllustrious_aMix.safetensors');
    expect(r.steps).toBe(40);
  });
});
