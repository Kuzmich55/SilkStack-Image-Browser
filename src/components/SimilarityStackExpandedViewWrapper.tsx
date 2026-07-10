import React, { useCallback, useMemo } from 'react';
import { Box, FileText, Puzzle } from 'lucide-react';
import { IndexedImage, StackGroupByDimension } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useThumbnail } from '../hooks/useThumbnail';
import { buildSubGroups } from '../hooks/useImageStacking';
import { safeLazy } from '../utils/safeLazy';

interface SimilarityStackExpandedViewWrapperProps {
  images: IndexedImage[];
  subGroups: { promptHash: string; prompt: string; label: string; groupKey: string; imageIds: string[] }[];
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

// ── Grouping dimension definitions ─────────────────────────────────────

type SegmentIcon = React.ComponentType<{ size?: number | string; className?: string }>;

const GROUPING_DIMENSIONS: { key: StackGroupByDimension; label: string; Icon: SegmentIcon; color: string }[] = [
  { key: 'prompt', label: 'Prompt', Icon: FileText as SegmentIcon, color: 'blue' },
  { key: 'model',  label: 'Model',  Icon: Box as SegmentIcon,     color: 'amber' },
  { key: 'loras',  label: 'Loras',  Icon: Puzzle as SegmentIcon,  color: 'emerald' },
];

const DIMENSION_COLORS: Record<string, { bg: string; text: string; shadow: string; ring: string }> = {
  blue:    { bg: 'bg-blue-600',    text: 'text-blue-400',    shadow: 'shadow-blue-600/25',    ring: 'ring-blue-500/50' },
  amber:   { bg: 'bg-amber-600',   text: 'text-amber-400',   shadow: 'shadow-amber-600/25',   ring: 'ring-amber-500/50' },
  emerald: { bg: 'bg-emerald-600', text: 'text-emerald-400', shadow: 'shadow-emerald-600/25', ring: 'ring-emerald-500/50' },
};

/**
 * Wrapper around the ai-intelligence SimilarityStackExpandedView that
 * bridges the app's Zustand stores to the component's callback props.
 *
 * Also provides a grouping-dimension toolbar: checkboxes for Model, Prompt,
 * and Loras that control how images are sub-grouped within the expanded
 * stack view. The user can toggle any combination — sub-groups are
 * recomputed on the fly from the raw image list.
 */
const SimilarityStackExpandedViewWrapper: React.FC<SimilarityStackExpandedViewWrapperProps> = ({
  images,
  subGroups: propSubGroups,
  onImageClick,
  selectedImages,
  onBack,
  imageSize: imageSizeProp,
}) => {
  const libraryImageSize = useSettingsStore(s => s.viewZoomLevels.library);
  const thumbnailsDisabled = useSettingsStore(s => s.disableThumbnails);
  const displayStarredFirst = useSettingsStore(s => s.displayStarredFirst);
  const stackGroupByDimensions = useSettingsStore(s => s.stackGroupByDimensions);
  const setStackGroupByDimensions = useSettingsStore(s => s.setStackGroupByDimensions);
  const toggleFavorite = useImageStore(s => s.toggleFavorite);
  const toggleImageSelection = useImageStore(s => s.toggleImageSelection);

  // Use the zoom level from settings when no explicit imageSize is provided.
  const imageSize = imageSizeProp ?? libraryImageSize;

  // ── Recompute sub-groups from raw images based on current dimensions ──

  const subGroups = useMemo(() => {
    if (images.length === 0) return [];
    return buildSubGroups(images, displayStarredFirst, stackGroupByDimensions);
  }, [images, displayStarredFirst, stackGroupByDimensions]);

  // ── Dimension labels for the external component heading ──────────────

  const groupByDimensionLabels = useMemo(() => {
    return stackGroupByDimensions.map(dim => {
      const def = GROUPING_DIMENSIONS.find(d => d.key === dim);
      return def ? def.label : dim;
    });
  }, [stackGroupByDimensions]);

  // ── Dimension toggle handler ─────────────────────────────────────────

  const handleToggleDimension = useCallback((dim: StackGroupByDimension) => {
    const current = useSettingsStore.getState().stackGroupByDimensions;
    const enabled = current.includes(dim);
    if (enabled) {
      setStackGroupByDimensions(current.filter(d => d !== dim));
    } else {
      setStackGroupByDimensions([...current, dim]);
    }
  }, [setStackGroupByDimensions]);

  // ── Build the group-by segmented control as a ReactNode ─────────────

  const groupByToolbar = useMemo(() => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-gray-500 select-none shrink-0">
        Group by
      </span>
      <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-full p-0.5 border border-gray-700/40 shadow-inner shadow-black/20">
        {GROUPING_DIMENSIONS.map(({ key, label, Icon, color }) => {
        const isChecked = stackGroupByDimensions.includes(key);
        const activeCount = stackGroupByDimensions.length;
        const c = DIMENSION_COLORS[color];
        return (
          <button
            key={key}
            onClick={() => handleToggleDimension(key)}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium select-none',
              'transition-all duration-200 ease-out',
              `focus:outline-none focus-visible:ring-2 focus-visible:${c.ring} focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900`,
              isChecked
                ? `${c.bg} text-white shadow-lg ${c.shadow} scale-[1.02]`
                : activeCount === 0
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5',
            ].join(' ')}
            title={`${isChecked ? 'Disable' : 'Enable'} grouping by ${label}`}
          >
            <Icon
              size={13}
              className={[
                'transition-all duration-200',
                isChecked ? 'opacity-100' : 'opacity-50',
              ].join(' ')}
            />
            {label}
          </button>
        );
      })}
      </div>
    </div>
  ), [stackGroupByDimensions, handleToggleDimension]);

  // ── Callback bridges ─────────────────────────────────────────────────

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
      {/* Trigger thumbnail loading for all images in the expanded view. */}
      {images.map(img => (
        <ThumbnailTrigger key={img.id} image={img} />
      ))}

      {/* ── Expanded view ─────────────────────────────────────────────── */}
      <Inner
        images={images as any}
        subGroups={subGroups as any}
        onImageClick={onImageClick as any}
        selectedImages={selectedImages}
        onBack={onBack}
        imageSize={imageSize}
        thumbnailsDisabled={thumbnailsDisabled}
        groupByDimensions={groupByDimensionLabels}
        groupByToolbar={groupByToolbar}
        onToggleFavorite={handleToggleFavorite}
        onToggleSelection={handleToggleSelection}
        onDragStart={handleDragStart as any}
        onDragEnd={handleDragEnd}
      />
    </>
  );
};

export default SimilarityStackExpandedViewWrapper;
