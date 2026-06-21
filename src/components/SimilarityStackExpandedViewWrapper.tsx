import React, { useCallback } from 'react';
import { IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useThumbnail } from '../hooks/useThumbnail';
import { safeLazy } from '../utils/safeLazy';

interface SimilarityStackExpandedViewWrapperProps {
  images: IndexedImage[];
  subGroups: { promptHash: string; prompt: string; imageIds: string[] }[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBack: () => void;
  imageSize?: number;
}

// ── Thumbnail preloader ────────────────────────────────────────────────
// Triggers useThumbnail for each image so thumbnails load before the
// images become visible. One hook call per component instance satisfies
// React's rules of hooks.

const ThumbnailTrigger: React.FC<{ image: IndexedImage | null }> = ({ image }) => {
  useThumbnail(image);
  return null;
};

// Lazy-load the package component when AI features are available.
// The compile-time ternary lets Vite/Rolldown tree-shake the import()
// entirely when VITE_AI_FEATURES_AVAILABLE is false.
const ExpandedViewInner = import.meta.env.VITE_AI_FEATURES_AVAILABLE
  ? safeLazy(
      () => import('@ai-images-browser/ai-intelligence'),
      'SimilarityStackExpandedView',
      (mod) => (mod as any).SimilarityStackExpandedView,
    )
  : null;

/**
 * Wrapper around the ai-intelligence SimilarityStackExpandedView that
 * bridges the app's Zustand stores to the component's callback props.
 *
 * The component itself is store-agnostic — this wrapper is the only place
 * that reads from useImageStore and useSettingsStore.
 */
const SimilarityStackExpandedViewWrapper: React.FC<SimilarityStackExpandedViewWrapperProps> = ({
  images,
  subGroups,
  onImageClick,
  selectedImages,
  onBack,
  imageSize: imageSizeProp,
}) => {
  const libraryImageSize = useSettingsStore(s => s.viewZoomLevels.library);
  const thumbnailsDisabled = useSettingsStore(s => s.disableThumbnails);
  const toggleFavorite = useImageStore(s => s.toggleFavorite);
  const toggleImageSelection = useImageStore(s => s.toggleImageSelection);

  // Use the zoom level from settings when no explicit imageSize is provided.
  // This makes the expanded view react to zoom slider changes.
  const imageSize = imageSizeProp ?? libraryImageSize;

  const handleToggleFavorite = useCallback((imageId: string) => {
    toggleFavorite(imageId);
  }, [toggleFavorite]);

  const handleToggleSelection = useCallback((imageId: string) => {
    toggleImageSelection(imageId);
  }, [toggleImageSelection]);

  // Drag start — builds payload from selected images (mirrors original getDragPayload)
  const handleDragStart = useCallback((image: IndexedImage, event: React.DragEvent<HTMLDivElement>) => {
    const canDragExternally = typeof window !== 'undefined' && !!(window as any).electronAPI?.startFileDrag;
    if (!canDragExternally) return;

    const storeState = useImageStore.getState();
    const currentSelectedImages = storeState.selectedImages;
    const currentImages = storeState.images;

    // If dragged image is part of selection, drag all selected images
    let filesToDrag: { sourcePath: string; name: string }[];

    if (currentSelectedImages.has(image.id)) {
      const selectedItems = currentImages.filter(img => currentSelectedImages.has(img.id));
      filesToDrag = selectedItems.map(img => {
        const [, relativeFromId] = img.id.split('::');
        const relativePath = relativeFromId || img.name;
        const sourcePath = img.directoryId
          ? `${img.directoryId}\\${relativePath}`.replace(/\\\\/g, '\\')
          : img.id.includes('::') ? img.id.split('::')[1] : img.id;
        return { sourcePath, name: img.name };
      });
    } else {
      const [, relativeFromId] = image.id.split('::');
      const relativePath = relativeFromId || image.name;
      const sourcePath = image.directoryId
        ? `${image.directoryId}\\${relativePath}`.replace(/\\\\/g, '\\')
        : image.id.includes('::') ? image.id.split('::')[1] : image.id;
      filesToDrag = [{ sourcePath, name: image.name }];
    }

    if (filesToDrag.length > 0) {
      // Set internal drag state
      storeState.setDraggedItems(filesToDrag);

      // Native file drag
      if (event.dataTransfer) {
        event.dataTransfer.setData('application/x-image-metahub-items', JSON.stringify(filesToDrag));
        event.dataTransfer.effectAllowed = 'copyMove';
      }
      event.preventDefault();

      // Electron external drag
      const firstFile = filesToDrag[0];
      const directoryPath = image.directoryId;
      if (directoryPath && (window as any).electronAPI?.startFileDrag) {
        (window as any).electronAPI.startFileDrag({
          files: filesToDrag.map(f => f.sourcePath),
          directoryPath,
          relativePath: firstFile.name,
          id: image.id,
          lastModified: image.lastModified,
        });
      }
    }
  }, []);

  const handleDragEnd = useCallback((_event: React.DragEvent<HTMLDivElement>) => {
    useImageStore.getState().clearDraggedItems();
  }, []);

  if (!import.meta.env.VITE_AI_FEATURES_AVAILABLE || !ExpandedViewInner) {
    return null;
  }

  const Inner = ExpandedViewInner;
  return (
    <>
      {/* Trigger thumbnail loading for all images in the expanded view.
          Each ThumbnailTrigger calls useThumbnail once (valid hook usage). */}
      {images.map(img => (
        <ThumbnailTrigger key={img.id} image={img} />
      ))}
      <Inner
        images={images as any}
        subGroups={subGroups}
        onImageClick={onImageClick as any}
        selectedImages={selectedImages}
        onBack={onBack}
        imageSize={imageSize}
        thumbnailsDisabled={thumbnailsDisabled}
        onToggleFavorite={handleToggleFavorite}
        onToggleSelection={handleToggleSelection}
        onDragStart={handleDragStart as any}
        onDragEnd={handleDragEnd}
      />
    </>
  );
};

export default SimilarityStackExpandedViewWrapper;
