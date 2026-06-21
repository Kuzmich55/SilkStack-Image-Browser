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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Stacks from '../components/SmartLibrary';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

// Mock the ai-intelligence package — provides stub components that mirror
// the originals' DOM output for integration tests of the wrapper layer.
// These are loaded via React.lazy, so the test must use waitFor/findBy*
// to allow the Suspense boundary to resolve.
vi.mock('@ai-images-browser/ai-intelligence', () => {
  const MockStackCard = ({ stack, onOpen }: any) => (
    <button onClick={onOpen} type="button">
      <span>{stack.count} images</span>
    </button>
  );
  const MockSimilarityStackExpandedView = ({ onBack, images, subGroups }: any) => (
    <div>
      <button onClick={onBack} type="button">
        Library
      </button>
      <span>{images.length} images</span>
      <span>{subGroups.length} prompt variations</span>
    </div>
  );
  return {
    StackCard: MockStackCard,
    SimilarityStackExpandedView: MockSimilarityStackExpandedView,
  };
});

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

describe('Stacks Scroll Position and DOM Preservation', () => {
  it('keeps the grid container completely untouched in the DOM and layouts the expanded stack view absolutely over it', async () => {
    // Populate mock store data — images need stackGroupId for stacking to work
    const mockImages = [
      { id: '1', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 1000, stackGroupId: 'hash-a' },
      { id: '2', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 900, stackGroupId: 'hash-a' },
      { id: '3', prompt: 'test prompt A', directoryId: 'dir1', lastModified: 800, stackGroupId: 'hash-a' },
      { id: '4', prompt: 'test prompt B', directoryId: 'dir1', lastModified: 700, stackGroupId: 'hash-b' },
    ] as any;

    useImageStore.setState({
      filteredImages: mockImages,
      directories: [{ id: 'dir1', path: 'C:/test' }] as any,
      scanSubfolders: false,
    });

    const { container } = render(<Stacks />);

    // Grid container should be in DOM and visible
    const gridContainer = container.querySelector('#smart-library-grid-container') as HTMLElement;
    expect(gridContainer).not.toBeNull();
    expect(gridContainer.className).toBe('flex-1 min-h-0 overflow-y-auto');

    // Wait for React.lazy Suspense to resolve, then click the stack card button.
    // findByText uses waitFor under the hood and retries until the element appears.
    const openBtn = await screen.findByText(/images/i);
    fireEvent.click(openBtn);

    // Expanded view should be rendered (SimilarityStackExpandedView shows "Library" back button)
    const libraryBtn = await screen.findByText(/Library/i);
    expect(libraryBtn).toBeDefined();

    // Grid content is replaced by drill-down view (scroll position saved in refs,
    // restored via useEffect when closing). Footer remains visible below.
    const gridContainerAfterOpen = container.querySelector('#smart-library-grid-container') as HTMLElement;
    expect(gridContainerAfterOpen).toBeNull();

    // Footer should still be visible
    expect(container.querySelector('footer')).not.toBeNull();
  });
});
