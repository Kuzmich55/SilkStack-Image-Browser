import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock the heavy testers — the shell only needs their identity as panes.
// (The pane wrapper in the shell carries data-testid="pane-<tool id>".)
vi.mock('../components/DevAutoTaggingTester', () => ({
  default: () => <div>Auto-Tag tester</div>,
}));
vi.mock('../components/DevSemanticSearchTester', () => ({
  default: () => <div>Semantic search tester</div>,
}));
vi.mock('../components/DevVectorSimilarityTester', () => ({
  default: () => <div>Vector similarity tester</div>,
}));

import DevToolsShell from '../components/DevToolsShell';

describe('DevToolsShell', () => {
  it('opens the requested tool and only mounts it', () => {
    render(<DevToolsShell initialTool="semantic-search" />);
    const semantic = screen.getByTestId('pane-semantic-search');
    expect(semantic).toBeTruthy();
    expect(semantic.style.display).not.toBe('none');
    // Lazy mount: the other tool is not mounted until first visited.
    expect(screen.queryByTestId('pane-auto-tag')).toBeNull();
  });

  it('falls back to the first tool for unknown ids (Semantic Search is the default)', () => {
    render(<DevToolsShell initialTool="bogus-tool" />);
    const semantic = screen.getByTestId('pane-semantic-search');
    expect(semantic).toBeTruthy();
    expect(semantic.style.display).not.toBe('none');
  });

  it('switches tools lazily and keeps visited panes alive', () => {
    render(<DevToolsShell initialTool="auto-tag" />);
    const autoTag = screen.getByTestId('pane-auto-tag');
    expect(autoTag.style.display).not.toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Semantic Search' }));
    const semantic = screen.getByTestId('pane-semantic-search');
    expect(semantic.style.display).not.toBe('none');
    // Auto-tag stays mounted (state preserved) but is hidden.
    expect(autoTag.style.display).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Tag' }));
    expect(autoTag.style.display).not.toBe('none');
    expect(semantic.style.display).toBe('none');
  });

  it('opens the Vector Similarity tool and mounts it lazily (not the default)', () => {
    render(<DevToolsShell initialTool="vector-similarity" />);
    const vector = screen.getByTestId('pane-vector-similarity');
    expect(vector).toBeTruthy();
    expect(vector.style.display).not.toBe('none');
    // Lazy mount: the default tool is not mounted just because it exists.
    expect(screen.queryByTestId('pane-semantic-search')).toBeNull();
  });

  it('keeps all three panes alive across tab switches', () => {
    render(<DevToolsShell initialTool="semantic-search" />);
    const semantic = screen.getByTestId('pane-semantic-search');

    fireEvent.click(screen.getByRole('button', { name: 'Vector Similarity' }));
    const vector = screen.getByTestId('pane-vector-similarity');
    expect(vector.style.display).not.toBe('none');
    expect(semantic.style.display).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Tag' }));
    const autoTag = screen.getByTestId('pane-auto-tag');
    expect(autoTag.style.display).not.toBe('none');
    expect(vector.style.display).toBe('none');

    // Back to Semantic Search — still mounted (state preserved), re-shown.
    fireEvent.click(screen.getByRole('button', { name: 'Semantic Search' }));
    expect(semantic.style.display).not.toBe('none');
    expect(autoTag.style.display).toBe('none');
  });
});
