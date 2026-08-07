import { describe, it, expect } from 'vitest';
import { resolvePromptFromGraph } from '../services/parsers/comfyUIParser';

/**
 * MiniMax H3 subgraph template-default regression.
 *
 * Real file: MiniMax_H3_00001_.mp4 (mdta prompt/flowwork tags). The UI
 * workflow holds a SUBGRAPH INSTANCE whose template definition (in
 * `definitions.subgraphs`) carries the DEFAULT prompt in the MiniMax node's
 * widgets_values. The API execution prompt carries what actually ran in
 * `inputs.prompt` with NO widgets_values.
 *
 * Pre-fix the MiniMaxH3ImageToVideo node was unregistered, so the standard
 * traversal dead-ended at it, and the global fallback scanner picked the
 * template default ("Vaporwave title sequence…") out of widgets_values —
 * even though the execution prompt was "A gentle, painterly-style video
 * starting from the image: the girl tenderly embraces the white spotted
 * horse…". The execution value must always win over the template default.
 */

const SUBGRAPH_ID = '4c314f31-ecda-4b08-ae98-faaba1bf613f';

const VAPORWAVE_TEMPLATE =
  'Vaporwave title sequence look: pink and blue gradient palette, VHS tracking artifacts, Greek statue motifs, chrome palm trees, RGB chromatic aberration, lo-fi retro atmosphere, mood languid and nostalgic.';

const HORSE_PROMPT =
  'A gentle, painterly-style video starting from the image: the girl tenderly embraces the white spotted horse, using her hand to give its face and cheek a slow, gentle rub.';

// UI workflow: subgraph instance (105) + template definition whose MiniMax
// node carries the DEFAULT prompt in widgets_values. This default is the
// node's idle state — NOT what executed.
const MINIMAX_WORKFLOW = {
  nodes: [
    { id: 92, type: 'SaveVideo', mode: 0, widgets_values: [], inputs: [], outputs: [] },
    { id: 105, type: SUBGRAPH_ID, mode: 0, widgets_values: [], inputs: [], outputs: [] },
  ],
  links: [],
  definitions: {
    subgraphs: [
      {
        id: SUBGRAPH_ID,
        nodes: [
          { id: 104, type: 'MiniMaxH3ImageToVideo', mode: 0, widgets_values: [VAPORWAVE_TEMPLATE, 1344, 768, 73], inputs: [], outputs: [] },
          { id: 6, type: 'UNETLoader', mode: 0, widgets_values: ['minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'default'], inputs: [], outputs: [] },
          { id: 16, type: 'BasicGuider', mode: 0, widgets_values: [], inputs: [], outputs: [] },
          { id: 14, type: 'SamplerCustomAdvanced', mode: 0, widgets_values: [], inputs: [], outputs: [] },
          { id: 17, type: 'KSamplerSelect', mode: 0, widgets_values: ['res_multistep'], inputs: [], outputs: [] },
          { id: 9, type: 'BasicScheduler', mode: 0, widgets_values: ['simple', 20, 1], inputs: [], outputs: [] },
          { id: 15, type: 'RandomNoise', mode: 0, widgets_values: [168866841893410], inputs: [], outputs: [] },
        ],
        links: [],
      },
    ],
  },
};

// API execution prompt: flattened subgraph ids. The MiniMax node has NO
// widgets_values — its values live in `inputs` (execution data).
const MINIMAX_PROMPT: Record<string, any> = {
  '105:104': {
    inputs: {
      prompt: HORSE_PROMPT,
      width: 832,
      height: 480,
      length: 73,
      clip: ['105:13', 0],
      vae: ['105:24', 0],
      first_frame: ['105:3', 0],
    },
    class_type: 'MiniMaxH3ImageToVideo',
  },
  '105:6': {
    inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
  },
  '105:16': { inputs: { model: ['105:6', 0], conditioning: ['105:104', 0] }, class_type: 'BasicGuider' },
  '105:14': {
    inputs: {
      noise: ['105:15', 0],
      guider: ['105:16', 0],
      sampler: ['105:17', 0],
      sigmas: ['105:9', 0],
      latent_image: ['105:104', 1],
    },
    class_type: 'SamplerCustomAdvanced',
  },
  '105:17': { inputs: { sampler_name: 'res_multistep' }, class_type: 'KSamplerSelect' },
  '105:9': { inputs: { scheduler: 'simple', steps: 20, denoise: 1, model: ['105:6', 0] }, class_type: 'BasicScheduler' },
  '105:15': { inputs: { noise_seed: 168866841893410 }, class_type: 'RandomNoise' },
};

describe('MiniMax H3 subgraph: execution prompt vs template default', () => {
  it('resolves the execution prompt (inputs.prompt), not the subgraph template default', () => {
    const r = resolvePromptFromGraph(MINIMAX_WORKFLOW as any, MINIMAX_PROMPT);

    // The horse text from the API execution prompt must win…
    expect(r.prompt).toContain('gentle, painterly-style video');
    expect(r.prompt).toContain('embraces the white spotted horse');
    // …and the vaporwave template default must NOT be picked up.
    expect(r.prompt).not.toContain('Vaporwave');
    // No global fallback needed — standard traversal found the prompt.
    expect(r._telemetry.warnings.join(' ')).not.toContain('global graph fallback');

    // Rest of the chain resolves from execution data too.
    expect(r.model).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
    expect(r.steps).toBe(20);
    expect(r.seed).toBe(168866841893410);
    expect(r.sampler_name).toBe('res_multistep');
  });

  it('MiniMaxH3TextToVideo is registered too (no template default involved)', () => {
    const workflow = {
      nodes: [
        { id: 200, type: SUBGRAPH_ID, mode: 0, widgets_values: [], inputs: [], outputs: [] },
      ],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: SUBGRAPH_ID,
            nodes: [
              { id: 201, type: 'MiniMaxH3TextToVideo', mode: 0, widgets_values: ['template default text here'], inputs: [], outputs: [] },
            ],
            links: [],
          },
        ],
      },
    };
    const prompt: Record<string, any> = {
      '200:201': { inputs: { prompt: 'A panda roller-skating through a bamboo forest at sunset', width: 832, height: 480, length: 73 }, class_type: 'MiniMaxH3TextToVideo' },
    };
    const r = resolvePromptFromGraph(workflow as any, prompt);
    expect(r.prompt).toContain('panda roller-skating');
    expect(r.prompt).not.toContain('template default');
  });
});
