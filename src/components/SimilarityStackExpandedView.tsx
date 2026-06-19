import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Star, Square, CheckSquare, X } from 'lucide-react';
import { IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { computeJustifiedLayout, getItemAspectRatio, type LayoutRow } from '../utils/layoutAlgo';

// ── Constants (matching ImageGrid) ─────────────────────────────────────

const GAP_SIZE = 8;
const CONTAINER_PADDING = 36; // Matches ImageGrid: p-2 (16px) + scrollbar (17px) + buffer

// ── Helpers ────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isVideoFile = (img: IndexedImage): boolean => {
  if (img.fileType?.startsWith('video/')) return true;
  const name = (img.name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
};

// ── Sub-group image card (triggers thumbnail loading) ──────────────────

interface SubGroupImageCardProps {
  image: IndexedImage;
  isSelected: boolean;
  onClick: (image: IndexedImage, event: React.MouseEvent) => void;
  getDragPayload?: (image: IndexedImage) => { sourcePath: string; name: string }[];
}

const SubGroupImageCard: React.FC<SubGroupImageCardProps> = React.memo(({
  image,
  isSelected,
  onClick,
  getDragPayload,
}) => {
  useThumbnail(image);

  const [imageUrl, setImageUrl] = useState<string | null>(() => {
    if (image.thumbnailStatus === 'ready' && image.thumbnailUrl) return image.thumbnailUrl;
    if (isVideoFile(image)) return null;
    return null;
  });

  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const setDraggedItems = useImageStore((state) => state.setDraggedItems);
  const clearDraggedItems = useImageStore((state) => state.clearDraggedItems);
  const canDragExternally = typeof window !== 'undefined' && !!window.electronAPI?.startFileDrag;

  // React to thumbnail becoming ready
  useEffect(() => {
    if (thumbnailsDisabled) {
      setImageUrl(null);
      return;
    }
    if (image.thumbnailStatus === 'ready' && image.thumbnailUrl) {
      setImageUrl(image.thumbnailUrl);
    }
  }, [image.thumbnailStatus, image.thumbnailUrl, thumbnailsDisabled]);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(image.id);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleImageSelection(image.id);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canDragExternally) {
      return;
    }

    const directoryPath = image.directoryId;
    if (!directoryPath) {
      return;
    }

    const [, relativeFromId] = image.id.split('::');
    const relativePath = relativeFromId || image.name;

    // Internal Drag and Drop Data
    if (getDragPayload && e.dataTransfer) {
      const payload = getDragPayload(image);
      e.dataTransfer.setData('application/x-image-metahub-items', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copyMove';

      // Set global drag state for reliable internal drops
      setDraggedItems(payload);
    }

    // Native File Drag (for external apps)
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copyMove';
    }

    // Get all files to drag
    let filesToDrag: string[] = [];
    if (getDragPayload) {
        const payload = getDragPayload(image);
        filesToDrag = payload.map(p => p.sourcePath).filter(Boolean);
    }

    // Fallback to single file if payload empty or failed
    if (filesToDrag.length === 0) {
        const directoryPath = image.directoryId;
        if (!directoryPath) return;
        const [, relativeFromId] = image.id.split('::');
        const relativePath = relativeFromId || image.name;
        filesToDrag = [`${directoryPath}\\${relativePath}`];
    }

    window.electronAPI?.startFileDrag({
      files: filesToDrag,
      directoryPath: image.directoryId,
      relativePath: (image.id.split('::')[1] || image.name),
      id: image.id,
      lastModified: image.lastModified
    });
  };

  const handleDragEnd = (_e: React.DragEvent<HTMLDivElement>) => {
    clearDraggedItems();
  };

  return (
    <div
      className={`relative group flex items-center justify-center bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-all duration-300 ease-out border border-gray-700/50 ${
        isSelected
          ? 'ring-4 ring-blue-500 ring-opacity-75 shadow-lg shadow-blue-500/20 translate-y-[-2px]'
          : 'hover:shadow-2xl hover:shadow-black/50 hover:border-gray-600 hover:translate-y-[-4px]'
      }`}
      style={{ width: '100%', height: '100%', flexShrink: 0 }}
      onClick={(e) => onClick(image, e)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      draggable={canDragExternally}
    >
      {/* Selection checkbox */}
      <button
        onClick={handleCheckboxClick}
        className={`absolute top-2 left-2 z-20 p-1 rounded transition-all focus:outline-none ${
          isSelected
            ? 'bg-blue-500 text-white opacity-100'
            : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-blue-500/80'
        }`}
        title={isSelected ? 'Deselect image' : 'Select image'}
      >
        {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
      </button>

      {/* Favorite button */}
      <button
        onClick={handleFavoriteClick}
        className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all focus:outline-none ${
          image.isFavorite
            ? 'bg-yellow-500/80 text-white opacity-100 hover:bg-yellow-600'
            : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-yellow-500'
        }`}
        title={image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={`h-4 w-4 ${image.isFavorite ? 'fill-current' : ''}`} />
      </button>

      {/* Image content */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={image.name || 'Image'}
          className="w-full h-full object-contain"
          loading="lazy"
          draggable={false}
        />
      ) : isVideoFile(image) ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-900">
          <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[10px] text-gray-500">Video</span>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-900">
          <div className="flex flex-col items-center gap-1">
            <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
            <span className="text-[10px] text-gray-500">Loading…</span>
          </div>
        </div>
      )}

      {/* Hover overlay with filename */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="text-[10px] text-white truncate leading-tight">
          {(image.name || '').split(/[/\\]/).pop() || 'Unknown'}
        </p>
      </div>
    </div>
  );
});

SubGroupImageCard.displayName = 'SubGroupImageCard';

// ── Justified row of images ────────────────────────────────────────────

interface JustifiedRowProps {
  row: LayoutRow;
  selectedImages: Set<string>;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  getDragPayload?: (image: IndexedImage) => { sourcePath: string; name: string }[];
}

const JustifiedRow: React.FC<JustifiedRowProps> = React.memo(({ row, selectedImages, onImageClick, getDragPayload }) => {
  return (
    <div className="flex flex-row" style={{ height: row.height, gap: GAP_SIZE }}>
      {row.items.map((item) => {
        const image = 'coverImage' in item ? item.coverImage : item;
        const aspectRatio = getItemAspectRatio(item);
        const itemWidth = row.height * aspectRatio;

        return (
          <div key={image.id} style={{ width: itemWidth, height: row.height, flexShrink: 0 }}>
            <SubGroupImageCard
              image={image}
              isSelected={selectedImages.has(image.id)}
              onClick={onImageClick}
              getDragPayload={getDragPayload}
            />
          </div>
        );
      })}
    </div>
  );
});

JustifiedRow.displayName = 'JustifiedRow';

// ── Main view ──────────────────────────────────────────────────────────

interface SimilarityStackExpandedViewProps {
  images: IndexedImage[];
  subGroups: { promptHash: string; prompt: string; imageIds: string[] }[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBack: () => void;
  /** Target row height for justified layout. Defaults to viewZoomLevels.library. */
  imageSize?: number;
}

/**
 * Drill-down view for a similarity-based library stack.
 *
 * Renders sub-groups of images organized by their exact prompt, using the same
 * justified layout algorithm as ImageGrid. Each sub-group displays its prompt
 * in a header panel above its rows of images.
 */
const SimilarityStackExpandedView: React.FC<SimilarityStackExpandedViewProps> = ({
  images,
  subGroups,
  onImageClick,
  selectedImages,
  onBack,
  imageSize: imageSizeProp,
}) => {
  const libraryImageSize = useSettingsStore((state) => state.viewZoomLevels.library);
  const imageSize = imageSizeProp ?? libraryImageSize;

  // Build a map from imageId to image for quick lookup
  const imageMap = useMemo(() => {
    const map = new Map<string, IndexedImage>();
    for (const img of images) {
      map.set(img.id, img);
    }
    return map;
  }, [images]);

  // Build drag payload — mirrors ImageGrid's getDragPayload for multi-select drag
  const getDragPayload = useCallback((targetImage: IndexedImage) => {
    const storeState = useImageStore.getState();
    const currentSelectedImages = storeState.selectedImages;
    const currentImages = storeState.images;

    // If the dragged image is part of the selection, drag all selected images
    if (currentSelectedImages.has(targetImage.id)) {
      const selectedItems = currentImages.filter(img => currentSelectedImages.has(img.id));

      if (selectedItems.length > 0) {
        return selectedItems.map(img => {
            const [, relativeFromId] = img.id.split('::');
            const relativePath = relativeFromId || img.name;
            const sourcePath = img.directoryId
              ? `${img.directoryId}\\${relativePath}`.replace(/\\\\/g, '\\')
              : img.id.includes('::') ? img.id.split('::')[1] : img.id;

            return {
              sourcePath,
              name: img.name
            };
        });
      }
    }

    // Fallback: drag just the target image
    const [, relativeFromId] = targetImage.id.split('::');
    const relativePath = relativeFromId || targetImage.name;
    const sourcePath = targetImage.directoryId
      ? `${targetImage.directoryId}\\${relativePath}`.replace(/\\\\/g, '\\')
      : targetImage.id.includes('::') ? targetImage.id.split('::')[1] : targetImage.id;

    return [{
       sourcePath,
       name: targetImage.name
    }];
  }, []);

  // Measure available width for justified layout
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });

    observer.observe(el);
    // Initial measurement
    if (el.clientWidth > 0) setContainerWidth(el.clientWidth);

    // Fallback: if ResizeObserver is unavailable (e.g. tests), measure synchronously
    if (typeof ResizeObserver === 'undefined' && el.clientWidth > 0) {
      setContainerWidth(el.clientWidth);
    }

    return () => observer.disconnect();
  }, []);

  const availableWidth = Math.max(1, (containerWidth || (containerRef.current?.clientWidth ?? 800)) - CONTAINER_PADDING);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0 px-6 py-2 bg-gray-900/40 border-b border-gray-800/40">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-md hover:bg-blue-500/20 transition-all text-xs font-medium border border-blue-500/20 shadow-sm"
        >
          <ArrowLeft size={14} />
          <span>Library</span>
        </button>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400">
            {images.length} {images.length === 1 ? 'image' : 'images'}
            {subGroups.length > 1 && (
              <span> · {subGroups.length} prompt variations</span>
            )}
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/60 transition-all"
            title="Close stack"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable content with justified rows */}
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0 scrollbar-adaptive">
        {subGroups.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">No prompt sub-groups found.</p>
          </div>
        )}

        {subGroups.map((sg) => {
          // Resolve images for this sub-group from the ID list
          const sgImages = sg.imageIds
            .map(id => imageMap.get(id))
            .filter((img): img is IndexedImage => img !== undefined);

          if (sgImages.length === 0) return null;

          // Compute justified layout using the same algorithm as ImageGrid
          const rows = availableWidth > 0
            ? computeJustifiedLayout(sgImages, availableWidth, imageSize, GAP_SIZE)
            : [];

          return (
            <div key={sg.promptHash} className="mb-2">
              {/* Prompt header panel */}
              <div className="mx-6 mt-4 bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-100">Prompt</h3>
                  <span className="text-xs text-gray-500">
                    {sgImages.length} {sgImages.length === 1 ? 'image' : 'images'}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed font-mono whitespace-pre-wrap break-all select-text">
                  {sg.prompt || '(no prompt)'}
                </p>
              </div>

              {/* Justified image rows (matching ImageGrid layout exactly) */}
              {rows.length > 0 && (
                <div className="px-3 mt-3" style={{ paddingRight: 12, paddingLeft: 12 }}>
                  {rows.map((row, rowIndex) => (
                    <div key={rowIndex} style={{ marginBottom: GAP_SIZE }}>
                      <JustifiedRow
                        row={row}
                        selectedImages={selectedImages}
                        onImageClick={onImageClick}
                        getDragPayload={getDragPayload}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Bottom padding */}
        <div className="h-8" />
      </div>
    </div>
  );
};

export default SimilarityStackExpandedView;
