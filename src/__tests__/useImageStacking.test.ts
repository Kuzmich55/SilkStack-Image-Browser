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
  stackGroupId: overrides.stackGroupId,
  isStackAnalyzed: overrides.isStackAnalyzed,
  ...overrides,
});

describe('useImageStacking Hook', () => {
  it('groups images by stackGroupId annotation field into stacks', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: false });

    // 'cat-hash' groupId on 3 images, 'dog-hash' on 1 image, no groupId on 1 image
    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'A beautiful cat', lastModified: 1000, stackGroupId: 'cat-hash' }),
      createImage({ id: '2', prompt: 'A beautiful dog', lastModified: 900, stackGroupId: 'dog-hash' }),
      createImage({ id: '3', prompt: 'A beautiful cat', lastModified: 800, stackGroupId: 'cat-hash' }),
      createImage({ id: '4', prompt: 'A beautiful cat', lastModified: 700, stackGroupId: 'cat-hash' }),
      createImage({ id: '5', prompt: '', stackGroupId: undefined }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // 1 stack (cat, 3 images) + 2 singletons (dog, no-prompt) = 3 items
    expect(stacked.length).toBe(3);

    const catStack = stacked.find(item => 'coverImage' in item) as any;
    expect(catStack).toBeDefined();
    expect(catStack.images.length).toBe(3);
    expect(catStack.images.map((img: any) => img.id)).toEqual(['1', '3', '4']);
    expect(catStack.coverImage.id).toBe('1'); // Latest image is cover

    const dog = stacked.find(item => (item as IndexedImage).id === '2');
    expect(dog).toBeDefined();
    expect('coverImage' in (dog as any)).toBe(false); // Singleton, not stack
  });

  it('treats images without stackGroupId as singletons', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: false });

    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'A beautiful cat', lastModified: 1000 }),
      createImage({ id: '2', prompt: 'A beautiful cat', lastModified: 800 }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // Both have no stackGroupId → both are singletons
    expect(stacked.length).toBe(2);
    expect('coverImage' in (stacked[0] as any)).toBe(false);
    expect('coverImage' in (stacked[1] as any)).toBe(false);
  });

  it('excludes images not in the visible set from stacks', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: false });

    // Image '5' has cat-hash but is NOT in the visible images array
    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'A beautiful cat', lastModified: 1000, stackGroupId: 'cat-hash' }),
      createImage({ id: '2', prompt: 'A beautiful dog', lastModified: 900, stackGroupId: 'dog-hash' }),
      createImage({ id: '3', prompt: 'A beautiful cat', lastModified: 800, stackGroupId: 'cat-hash' }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // cat stack should contain only 2 visible images
    const catStack = stacked.find(item => 'coverImage' in item) as any;
    expect(catStack).toBeDefined();
    expect(catStack.images.length).toBe(2);
    expect(catStack.images.map((img: any) => img.id)).toEqual(['1', '3']);

    // dog is a singleton
    const dog = stacked.find(item => (item as IndexedImage).id === '2');
    expect(dog).toBeDefined();
  });

  it('places starred images/stacks first when displayStarredFirst is enabled', () => {
    useImageStore.setState({ sortOrder: 'date-desc' });
    useSettingsStore.setState({ displayStarredFirst: true });

    const images: IndexedImage[] = [
      createImage({ id: '1', prompt: 'Prompt A', isFavorite: false, lastModified: 1000, stackGroupId: 'hash-a' }),
      createImage({ id: '2', prompt: 'Prompt B', isFavorite: true, lastModified: 900, stackGroupId: 'hash-b' }),
      createImage({ id: '3', prompt: 'Prompt A', isFavorite: false, lastModified: 800, stackGroupId: 'hash-a' }),
    ];

    const { result } = renderHook(() => useImageStacking(images, true));
    const stacked = result.current.stackedItems;

    // Expected: Starred Prompt B first, then stack for Prompt A
    expect(stacked.length).toBe(2);

    // First item is single starred image
    expect((stacked[0] as IndexedImage).id).toBe('2');

    // Second item is the Prompt A stack
    const stackA = stacked[1] as any;
    expect(stackA.coverImage.id).toBe('1');
    expect(stackA.images.length).toBe(2);
  });
});
