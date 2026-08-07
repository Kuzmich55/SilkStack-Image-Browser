import { describe, it, expect } from 'vitest';
import { extractMp4MdtaTags, extractMp4Dimensions } from '../services/parsers/binaryParsers';
import { resolvePromptFromGraph } from '../services/parsers/comfyUIParser';

/**
 * MP4 mdta metadata regression tests.
 *
 * ComfyUI save nodes (e.g. the MiniMax H3 / VideoHelperSuite outputs) embed the
 * workflow/prompt as Apple-style mdta tags: moov → udta → meta → keys/ilst.
 * The indexer now extracts them dependency-free (no ffprobe) from whatever
 * bytes it already has. These tests build a synthetic MP4 with that layout and
 * verify extraction + the full ComfyUI resolution pipeline.
 */

// ---- Synthetic MP4 builder (Apple-style mdta layout) ----
const enc = new TextEncoder();
const str = (s: string) => enc.encode(s);

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[i + 4] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32b(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

/** keys entry: [size u32]["mdta"][name\0] */
function keyEntry(name: string): Uint8Array {
  const payload = concat(str('mdta'), str(name + '\0'));
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(payload, 4);
  return out;
}

/** ilst entry: [size u32][index u32]["data"][kind u32=1][locale u32][payload] */
function ilstEntry(index: number, value: string): Uint8Array {
  const dataBox = box('data', concat(u32b(1), new Uint8Array(4), str(value)));
  const payload = concat(u32b(index), dataBox);
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(payload, 4);
  return out;
}

function buildMp4(tags: Record<string, string>): Uint8Array {
  const names = Object.keys(tags);
  const keysBox = box('keys', concat(new Uint8Array(4), u32b(names.length), ...names.map(keyEntry)));
  const ilstBox = box(
    'ilst',
    concat(...names.map((name, i) => ilstEntry(i + 1, tags[name])))
  );
  const metaBox = box('meta', concat(new Uint8Array(4), keysBox, ilstBox));
  const udtaBox = box('udta', metaBox);
  const moovBox = box('moov', udtaBox);
  return concat(box('ftyp', str('isom')), moovBox, box('mdat', str('fake video payload')));
}

/**
 * tkhd (track header) builder — the last 8 bytes of the payload hold the
 * display width/height as 16.16 fixed-point values. Version 0 uses 32-bit
 * creation/modification/duration, version 1 uses 64-bit.
 */
function tkhdBox(version: number, width: number, height: number): Uint8Array {
  const fixed = (n: number) => (n << 16) >>> 0;
  const widthHeight = concat(u32b(fixed(width)), u32b(fixed(height)));
  const version0 = concat(
    new Uint8Array([version, 0, 0, 0]), // version + flags
    u32b(0), u32b(0), // creation_time, modification_time
    u32b(1), u32b(0), // track_ID, reserved
    u32b(0), // duration
    new Uint8Array(8), // reserved
    new Uint8Array(8), // layer(2) alternate_group(2) volume(2) reserved(2)
    new Uint8Array(36), // matrix
    widthHeight,
  );
  const version1 = concat(
    new Uint8Array([version, 0, 0, 0]), // version + flags
    new Uint8Array(8), new Uint8Array(8), // 64-bit creation, modification
    u32b(1), u32b(0), // track_ID, reserved
    new Uint8Array(8), // 64-bit duration
    new Uint8Array(8),
    new Uint8Array(8),
    new Uint8Array(36),
    widthHeight,
  );
  return box('tkhd', version === 1 ? version1 : version0);
}

function buildMp4WithTrack(version: number, width: number, height: number, tracksBefore: Uint8Array[] = []): Uint8Array {
  const tracks = [...tracksBefore.map((t) => box('trak', t)), box('trak', tkhdBox(version, width, height))];
  const moovBox = box('moov', concat(...tracks));
  return concat(box('ftyp', str('isom')), moovBox, box('mdat', str('fake video payload')));
}

// ---- Fixtures ----
const API_PROMPT = {
  '84:75': { inputs: { ckpt_name: 'aMixIllustrious_aMix.safetensors' }, class_type: 'CheckpointLoaderSimple' },
  76: {
    inputs: {
      lora_1: { on: true, lora: 'rimixO-Pony-XL-Illustrious-Flux.safetensors', strength: 0.9 },
      model: ['84:75', 0],
      clip: ['84:75', 1],
    },
    class_type: 'Power Lora Loader (rgthree)',
  },
  '84:72': { inputs: { text: 'leia_organa, starwars, 1girl', clip: ['84:71', 0] }, class_type: 'CLIPTextEncode' },
  '84:73': { inputs: { text: 'embedding:lazyneg, bad quality', clip: ['84:71', 0] }, class_type: 'CLIPTextEncode' },
  '84:81': {
    inputs: {
      seed: 809723627235556, steps: 40, cfg: 5, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 0.5,
      model: ['76', 0], positive: ['84:72', 0], negative: ['84:73', 0], latent_image: ['84:70', 0],
    },
    class_type: 'KSampler',
  },
};

describe('extractMp4MdtaTags', () => {
  it('extracts Apple-style mdta tags from a synthetic MP4', () => {
    const tags = { workflow: JSON.stringify({ nodes: [] }), prompt: JSON.stringify(API_PROMPT), encoder: 'Lavf62.12.101' };
    const mp4 = buildMp4(tags);
    const result = extractMp4MdtaTags(mp4);
    expect(result.workflow).toBe(tags.workflow);
    expect(result.prompt).toBe(tags.prompt);
    expect(result.encoder).toBe('Lavf62.12.101');
  });

  it('returns empty for a buffer without a meta box', () => {
    const mp4 = concat(box('ftyp', str('isom')), box('mdat', str('no metadata here')));
    expect(extractMp4MdtaTags(mp4)).toEqual({});
  });

  it('returns empty for truncated/garbage input without crashing', () => {
    expect(extractMp4MdtaTags(new Uint8Array([1, 2, 3]))).toEqual({});
    const garbage = new Uint8Array(512);
    for (let i = 0; i < 512; i++) garbage[i] = (i * 31) & 0xff;
    expect(extractMp4MdtaTags(garbage)).toEqual({});
  });

  it('extracts from a head-read slice (moov at the front, like the 64KB head read)', () => {
    const tags = { workflow: JSON.stringify({ nodes: [] }), prompt: JSON.stringify(API_PROMPT) };
    const mp4 = buildMp4(tags);
    // The full file is small; simulate a head read that still contains moov.
    const head = mp4.subarray(0, Math.min(mp4.length, 64 * 1024));
    const result = extractMp4MdtaTags(head);
    expect(result.prompt).toBe(tags.prompt);
  });
});

describe('extractMp4Dimensions', () => {
  it('extracts width/height from a version-0 tkhd track header', () => {
    const mp4 = buildMp4WithTrack(0, 1344, 768);
    expect(extractMp4Dimensions(mp4)).toEqual({ width: 1344, height: 768 });
  });

  it('extracts width/height from a version-1 (64-bit) tkhd track header', () => {
    const mp4 = buildMp4WithTrack(1, 1280, 720);
    expect(extractMp4Dimensions(mp4)).toEqual({ width: 1280, height: 720 });
  });

  it('skips audio tracks (0x0) and takes the first video track', () => {
    const audio = tkhdBox(0, 0, 0);
    const mp4 = buildMp4WithTrack(0, 1920, 1080, [audio]);
    expect(extractMp4Dimensions(mp4)).toEqual({ width: 1920, height: 1080 });
  });

  it('extracts from a head-read slice (moov at the front)', () => {
    const mp4 = buildMp4WithTrack(0, 832, 480);
    const head = mp4.subarray(0, Math.min(mp4.length, 64 * 1024));
    expect(extractMp4Dimensions(head)).toEqual({ width: 832, height: 480 });
  });

  it('returns null for garbage/truncated input without crashing', () => {
    expect(extractMp4Dimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    const garbage = new Uint8Array(256);
    for (let i = 0; i < 256; i++) garbage[i] = (i * 7) & 0xff;
    expect(extractMp4Dimensions(garbage)).toBeNull();
    // No trak/tkhd at all — just a container without video tracks
    expect(extractMp4Dimensions(buildMp4({ encoder: 'Lavf62.12.101' }))).toBeNull();
  });
});

describe('MP4 mdta → ComfyUI pipeline', () => {
  it('resolves model/prompt from tags embedded in an MP4', () => {
    const tags = {
      workflow: JSON.stringify({ nodes: [], links: [] }),
      prompt: JSON.stringify(API_PROMPT),
    };
    const mp4 = buildMp4(tags);
    const extracted = extractMp4MdtaTags(mp4);

    // Mirror the indexer: strings are parsed before resolvePromptFromGraph
    const r = resolvePromptFromGraph(JSON.parse(extracted.workflow), JSON.parse(extracted.prompt));
    expect(r.model).toBe('aMixIllustrious_aMix.safetensors');
    expect(r.prompt).toContain('leia_organa');
    expect(r.negativePrompt).toContain('embedding:lazyneg');
    expect(r.steps).toBe(40);
    expect(r.seed).toBe(809723627235556);
    expect(r.lora).toContain('rimixO-Pony-XL-Illustrious-Flux');
  });

  it('execution inputs rebuild widgets_values (SamplerCustomAdvanced chain)', () => {
    // MiniMax H3 shape: the model chain runs SamplerCustomAdvanced → guider →
    // BasicGuider → model → UNETLoader. The UI template's widget values got
    // misaligned (VAE name in UNETLoader's slot 0); the API prompt's execution
    // inputs are authoritative and must rebuild the widget list. extractAdvancedModel
    // can't rescue here (SamplerCustomAdvanced has no `model` input to follow),
    // so this exercises the overlay rebuild specifically.
    const workflow = {
      nodes: [
        {
          id: 6, type: 'UNETLoader', mode: 0,
          widgets_values: ['minimax_h3_video_vae_fp16.safetensors', 'default'], // misaligned
          inputs: [], outputs: [],
        },
        { id: 16, type: 'BasicGuider', mode: 0, widgets_values: [], inputs: [], outputs: [] },
        { id: 14, type: 'SamplerCustomAdvanced', mode: 0, widgets_values: [], inputs: [], outputs: [] },
      ],
      links: [],
    };
    const prompt = {
      '6': { inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' }, class_type: 'UNETLoader' },
      '16': { inputs: { model: ['6', 0], conditioning: ['104', 0] }, class_type: 'BasicGuider' },
      '14': {
        inputs: {
          noise: ['15', 0], guider: ['16', 0], sampler: ['17', 0],
          sigmas: ['9', 0], latent_image: ['104', 1],
        },
        class_type: 'SamplerCustomAdvanced',
      },
      '17': { inputs: { sampler_name: 'res_multistep' }, class_type: 'KSamplerSelect' },
      '9': { inputs: { scheduler: 'simple', steps: 20, denoise: 1, model: ['6', 0] }, class_type: 'BasicScheduler' },
      '15': { inputs: { noise_seed: 168866841893410 }, class_type: 'RandomNoise' },
    };
    const r = resolvePromptFromGraph(workflow as any, prompt as any);
    // The misaligned UI widget (VAE name) must NOT win — the execution input does.
    expect(r.model).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
    expect(r.steps).toBe(20);
    expect(r.seed).toBe(168866841893410);
    expect(r.sampler_name).toBe('res_multistep');
  });
});
