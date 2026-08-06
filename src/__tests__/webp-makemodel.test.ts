import { describe, it, expect } from 'vitest';
import { parseWebPMetadata } from '../services/parsers/binaryParsers';
import { parseComfyUIMetadataEnhanced } from '../services/parsers/comfyUIParser';

/**
 * ComfyUI SaveWebP (VideoHelperSuite) writes the workflow UI graph into the
 * EXIF `Make` tag ("workflow:{...}") and the execution prompt into the
 * `Model` tag ("prompt:{...}"). Regression test for animated webp files
 * whose metadata the app previously dropped because only ImageDescription /
 * UserComment / Parameters / Description were inspected.
 */

function buildTiff(makeValue: string, modelValue: string): Uint8Array {
  const make = 'workflow:' + makeValue;
  const model = 'prompt:' + modelValue;
  const makeBytes = new TextEncoder().encode(make + '\0');
  const modelBytes = new TextEncoder().encode(model + '\0');
  const ifdSize = 2 + 2 * 12 + 4;
  const makeOff = 8 + ifdSize;
  const modelOff = makeOff + makeBytes.length;
  const total = modelOff + modelBytes.length;
  const tiff = new Uint8Array(total);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x4d;
  tiff[1] = 0x4d; // MM — big-endian
  dv.setUint16(2, 0x002a, false);
  dv.setUint32(4, 8, false); // IFD0 offset
  dv.setUint16(8, 2, false); // entry count
  // Make — tag 0x010F (271), ASCII
  dv.setUint16(10, 0x010f, false);
  dv.setUint16(12, 2, false);
  dv.setUint32(14, makeBytes.length, false);
  dv.setUint32(18, makeOff, false);
  // Model — tag 0x0110 (272), ASCII
  dv.setUint16(22, 0x0110, false);
  dv.setUint16(24, 2, false);
  dv.setUint32(26, modelBytes.length, false);
  dv.setUint32(30, modelOff, false);
  dv.setUint32(34, 0, false); // next IFD offset
  tiff.set(makeBytes, makeOff);
  tiff.set(modelBytes, modelOff);
  return tiff;
}

function buildAnimatedWebP(tiff: Uint8Array): ArrayBuffer {
  const exif = new Uint8Array(6 + tiff.length);
  exif.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  exif.set(tiff, 6);
  const total = 12 + 8 + exif.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  dv.setUint32(4, total - 8, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set([0x45, 0x58, 0x49, 0x46], 12); // EXIF
  dv.setUint32(16, exif.length, true);
  out.set(exif, 20);
  return out.buffer as ArrayBuffer;
}

const WORKFLOW = JSON.stringify({
  id: '91f6bbe2-ed41-4fd6-bac7-71d5b5864ecb',
  last_node_id: 57,
  last_link_id: 106,
  nodes: [{ id: 30, type: 'CheckpointLoaderSimple', mode: 0, widgets_values: ['flux1-dev-fp8.safetensors'] }],
  links: [],
});

const PROMPT = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { model: ['30', 0], seed: 123, steps: 25, cfg: 1 } },
  30: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' } },
});

describe('WebP EXIF Make/Model (ComfyUI SaveWebP)', () => {
  it('extracts workflow/prompt from the Make/Model tags of an animated webp', async () => {
    const buffer = buildAnimatedWebP(buildTiff(WORKFLOW, PROMPT));
    const meta = await parseWebPMetadata(buffer);
    expect(meta).not.toBeNull();
    expect(meta!.workflow).toBeDefined();
    expect(meta!.prompt).toBeDefined();
    expect((meta!.workflow as any).last_node_id).toBe(57);
  });

  it('flows through the full pipeline and resolves the model', async () => {
    const buffer = buildAnimatedWebP(buildTiff(WORKFLOW, PROMPT));
    const meta = await parseWebPMetadata(buffer);
    const result = await parseComfyUIMetadataEnhanced(meta!);
    expect(result.model).toBe('flux1-dev-fp8.safetensors');
    expect(result.steps).toBe(25);
    expect(result.seed).toBe(123);
  });

  it('returns null for webp files without ComfyUI Make/Model tags', async () => {
    const tiff = buildTiff('', '');
    // Strip the workflow:/prompt: prefixes — plain empty tags must not match
    const noComfy = new Uint8Array(6 + tiff.length);
    noComfy.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
    noComfy.set(tiff, 6);
    const total = 12 + 8 + noComfy.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    out.set([0x52, 0x49, 0x46, 0x46], 0);
    dv.setUint32(4, total - 8, true);
    out.set([0x57, 0x45, 0x42, 0x50], 8);
    out.set([0x45, 0x58, 0x49, 0x46], 12);
    dv.setUint32(16, noComfy.length, true);
    out.set(noComfy, 20);
    const meta = await parseWebPMetadata(out.buffer as ArrayBuffer);
    expect(meta).toBeNull();
  });
});
