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

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SmartLibrary from '../components/SmartLibrary';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

// Mock Lucide icons using the original module to preserve all standard icon exports
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
  };
});

// Mock electron API safely without overwriting global.window object properties
if (typeof global.window !== 'undefined') {
  (global.window as any).electronAPI = {
    openImageViewer: vi.fn(),
  };
}

describe('SmartLibrary Scroll Position and DOM Preservation', () => {
  it('keeps the grid container completely untouched in the DOM and layouts the expanded stack view absolutely over it', async () => {
    // Populate mock store data
    const mockImages = [
      { id: '1', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 1000 },
      { id: '2', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 900 },
      { id: '3', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 800 },
      { id: '4', prompt: 'test prompt B', directoryId: 'dir1', lastModified: 700 },
    ] as any;

    const mockClusters = [
      { id: 'cluster-1', basePrompt: 'test prompt A', size: 3, imageIds: ['1', '2', '3'], similarityThreshold: 0.9 },
    ] as any;

    useImageStore.setState({
      filteredImages: mockImages,
      clusters: mockClusters,
      directories: [{ id: 'dir1', path: 'C:/test' }] as any,
      scanSubfolders: false,
    });

    const { container } = render(<SmartLibrary />);

    // Grid container should be in DOM and visible
    const gridContainer = container.querySelector('#smart-library-grid-container') as HTMLElement;
    expect(gridContainer).not.toBeNull();
    expect(gridContainer.className).toBe('flex-1 min-h-0 overflow-y-auto');

    // Click on stack card open button to expand it
    const openBtn = screen.getByText(/images/i);
    fireEvent.click(openBtn);

    // Expanded view should be rendered
    expect(screen.getByText(/Back to stacks/i)).toBeDefined();

    // Crucially, the grid container MUST be completely untouched in the DOM to keep its scroll position
    const gridContainerAfterOpen = container.querySelector('#smart-library-grid-container') as HTMLElement;
    expect(gridContainerAfterOpen).not.toBeNull();
    expect(gridContainerAfterOpen.className).toBe('flex-1 min-h-0 overflow-y-auto');

    // The overlay container wrapping StackExpandedView should have absolute z-10 class
    const overlay = container.querySelector('.absolute.inset-0.bg-gray-900.z-10');
    expect(overlay).not.toBeNull();
  });
});
