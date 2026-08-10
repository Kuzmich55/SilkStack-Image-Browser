import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { copyImageToClipboard } from '../utils/imageUtils';

// jsdom has no canvas backing store, real bitmap decoding, or clipboard —
// stub the pieces copyImageToClipboard depends on and assert on what is
// handed to navigator.clipboard.write.

class FakeClipboardItem {
  items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

const makeImage = (name: string, type: string, content = 'image-data') => {
  const file = new File([content], name, { type });
  return {
    handle: { getFile: vi.fn().mockResolvedValue(file) },
  } as any;
};

describe('copyImageToClipboard', () => {
  let writtenItems: FakeClipboardItem[];
  let writeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writtenItems = [];

    // Canvas: fake 2D context + toBlob producing a PNG blob
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob(['png-bytes'], { type: 'image/png' }));
      }),
    });

    // Bitmap decoding: fake dimensions
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10 }));

    // Clipboard write: capture the items instead of touching a real clipboard
    writeMock = vi.fn(async (items: FakeClipboardItem[]) => {
      writtenItems = items;
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeMock },
    });

    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('re-encodes JPEG files to PNG before writing (Chromium rejects image/jpeg)', async () => {
    const result = await copyImageToClipboard(makeImage('photo.jpg', 'image/jpeg'));

    expect(result.success).toBe(true);
    expect(writtenItems).toHaveLength(1);
    expect(Object.keys(writtenItems[0].items)).toEqual(['image/png']);
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it('writes PNG files directly without re-encoding', async () => {
    const result = await copyImageToClipboard(makeImage('render.png', 'image/png'));

    expect(result.success).toBe(true);
    expect(Object.keys(writtenItems[0].items)).toEqual(['image/png']);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('writes WebP files directly (supported on write in Chromium)', async () => {
    const result = await copyImageToClipboard(makeImage('render.webp', 'image/webp'));

    expect(result.success).toBe(true);
    expect(Object.keys(writtenItems[0].items)).toEqual(['image/webp']);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('refuses non-image files with a clear error', async () => {
    const result = await copyImageToClipboard(makeImage('clip.mp4', 'video/mp4'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only image files');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('reports clipboard write failures', async () => {
    writeMock.mockRejectedValueOnce(new Error('Type Image/jpeg not supported on write'));
    const result = await copyImageToClipboard(makeImage('photo.jpg', 'image/jpeg'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported on write');
  });
});
