import React from 'react';
import { ImageStack, IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';
import { safeLazy } from '../utils/safeLazy';

interface StackCardWrapperProps {
  stack: ImageStack;
  onOpen: () => void;
}

// Lazy-load the package StackCard when AI features are available.
// The compile-time ternary lets Vite/Rolldown tree-shake the import()
// entirely when VITE_AI_FEATURES_AVAILABLE is false.
const StackCardInner = import.meta.env.VITE_AI_FEATURES_AVAILABLE
  ? safeLazy(
      () => import('@ai-images-browser/ai-intelligence'),
      'StackCard',
      (mod) => (mod as any).StackCard,
    )
  : null;

/**
 * Invisible component that triggers thumbnail loading for a single image.
 * Using a dedicated component (rather than calling useThumbnail in a loop)
 * keeps the hooks call count deterministic regardless of stack size.
 */
const ThumbnailPreloader: React.FC<{ image: IndexedImage | null }> = ({ image }) => {
  useThumbnail(image);
  return null;
};

/**
 * Wrapper around the ai-intelligence StackCard that triggers thumbnail
 * loading for ALL images in the stack before rendering the card.
 *
 * We preload every image (not just the cover) so the hover-based image
 * scrubbing slider works immediately — without this, only the cover
 * image's thumbnail is available and scrubbing shows blank frames.
 *
 * Keep in sync with the package's StackCardProps interface.
 */
const StackCardWrapper: React.FC<StackCardWrapperProps> = ({ stack, onOpen }) => {
  // Trigger thumbnail loading for every image in the stack.
  // StackCard's hover scrubber switches between images[previewIndex]
  // thumbnails — all of them must be available for smooth scrubbing.
  const images = stack.images as IndexedImage[];

  if (!import.meta.env.VITE_AI_FEATURES_AVAILABLE || !StackCardInner) {
    return null;
  }

  const Inner = StackCardInner;
  return (
    <>
      {images.map((img) => (
        <ThumbnailPreloader key={img.id} image={img} />
      ))}
      <Inner stack={stack as any} onOpen={onOpen} />
    </>
  );
};

export default StackCardWrapper;
