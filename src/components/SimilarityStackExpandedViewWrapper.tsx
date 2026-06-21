import React, { useCallback } from 'react';
import { IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';

interface SimilarityStackExpandedViewWrapperProps {
  images: IndexedImage[];
  subGroups: { promptHash: string; prompt: string; imageIds: string[] }[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBack: () => void;
  imageSize?: number;
}

// Lazy-load the package component when AI features are available.
// The compile-time ternary lets Vite/Rolldown tree-shake the import()
// entirely when VITE_AI_FEATURES_AVAILABLE is false.
const ExpandedViewInner = import.meta.env.VITE_AI_FEATURES_AVAILABLE
  ? React.lazy(() =>
      import('@ai-images-browser/ai-intelligence').then(m => ({
        default: m.SimilarityStackExpandedView,
      }))
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
  imageSize,
}) => {
  const thumbnailsDisabled = useSettingsStore(s => s.disableThumbnails);
  const toggleFavorite = useImageStore(s => s.toggleFavorite);
  const toggleImageSelection = useImageStore(s => s.toggleImageSelection);

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

  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading stack view…</p>
          </div>
        </div>
      }
    >
      <ExpandedViewInner
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
    </React.Suspense>
  );
};

export default SimilarityStackExpandedViewWrapper;
