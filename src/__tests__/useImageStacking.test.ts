import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  global.localStorage = {
    getItem: vi.fn().mockReturnValue('true'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  } as any;
});

import { renderHook } from '@testing-library/react';
import { useImageStacking } from '../hooks/useImageStacking';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { type IndexedImage } from '../types';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id || 'id',
  name: overrides.name || 'name',
  handle: {} as FileSystemFileHandle,
  metadata: {
    normalizedMetadata: {
      prompt: overrides.prompt || '',
      negativePrompt: overrides.negativePrompt || '',
    }
  } as any,
  metadataString: '',
  lastModified: overrides.lastModified || Date.now(),
  models: [],
  loras: [],
  scheduler: '',
  prompt: overrides.prompt,
  negativePrompt: overrides.negativePrompt,
  isFavorite: overrides.isFavorite,
  ...overrides,
});

describe('useImageStacking Hook', () => {
  it('groups all images with identical prompts globally into a single stack', () => {
    // Mock store states
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: false });

    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'A beautiful cat', lastModified: 1000 }),
      createImage({ id: '2', prompt: 'A beautiful dog', lastModified: 900 }),
      createImage({ id: '3', prompt: 'A beautiful cat', lastModified: 800 }),
      createImage({ id: '4', prompt: 'A beautiful cat', lastModified: 700 }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // We expect 1 stack for 'A beautiful cat' containing 3 images, and 1 single image for 'A beautiful dog'
    expect(stacked.length).toBe(2);

    const catStack = stacked.find(item => 'coverImage' in item) as any;
    expect(catStack).toBeDefined();
    expect(catStack.images.length).toBe(3);
    expect(catStack.images.map((img: any) => img.id)).toEqual(['1', '3', '4']);
    expect(catStack.coverImage.id).toBe('1'); // Latest image is the cover
  });

  it('normalizes spaces and casing to fully unify prompts', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: false });

    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'A beautiful cat', lastModified: 1000 }),
      createImage({ id: '2', prompt: '  a  beautiful  cat\n', lastModified: 800 }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    expect(stacked.length).toBe(1);
    const catStack = stacked[0] as any;
    expect(catStack.images.length).toBe(2);
    expect(catStack.coverImage.id).toBe('1');
  });

  it('places starred images/stacks first when displayStarredFirst is enabled', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: true });

    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'Prompt A', isFavorite: false, lastModified: 1000 }),
      createImage({ id: '2', prompt: 'Prompt B', isFavorite: true, lastModified: 900 }),
      createImage({ id: '3', prompt: 'Prompt A', isFavorite: false, lastModified: 800 }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // Expected order: Starred Prompt B first, then stack for Prompt A
    expect(stacked.length).toBe(2);
    
    // First item is single starred image
    expect(stacked[0].id).toBe('2');
    
    // Second item is the Prompt A stack
    const stackA = stacked[1] as any;
    expect(stackA.coverImage.id).toBe('1');
    expect(stackA.images.length).toBe(2);
  });
});
