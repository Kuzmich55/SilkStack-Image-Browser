import React from 'react';
import { ImageStack } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';

interface StackCardWrapperProps {
  stack: ImageStack;
  onOpen: () => void;
}

// Lazy-load the package StackCard when AI features are available.
// The compile-time ternary lets Vite/Rolldown tree-shake the import()
// entirely when VITE_AI_FEATURES_AVAILABLE is false.
const StackCardInner = import.meta.env.VITE_AI_FEATURES_AVAILABLE
  ? React.lazy(() =>
      import('@ai-images-browser/ai-intelligence').then(m => ({
        default: m.StackCard,
      }))
    )
  : null;

/**
 * Wrapper around the ai-intelligence StackCard that triggers thumbnail
 * loading for preview images before rendering the card.
 *
 * Keep in sync with the package's StackCardProps interface.
 */
const StackCardWrapper: React.FC<StackCardWrapperProps> = ({ stack, onOpen }) => {
  // Trigger thumbnail loading for the cover image.
  // Other images in the stack have their thumbnails triggered by the
  // parent grid/list virtualization as they come into view.
  const previewImage = stack.images[0] ?? null;
  useThumbnail(previewImage);

  if (!import.meta.env.VITE_AI_FEATURES_AVAILABLE || !StackCardInner) {
    return null;
  }

  return (
    <React.Suspense
      fallback={
        <div className="aspect-[4/5] rounded-2xl bg-gray-200 animate-pulse dark:bg-gray-800" />
      }
    >
      <StackCardInner stack={stack as any} onOpen={onOpen} />
    </React.Suspense>
  );
};

export default StackCardWrapper;
