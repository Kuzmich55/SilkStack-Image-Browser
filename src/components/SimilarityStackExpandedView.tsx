import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';

// ── Helpers ────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isVideo = (img: IndexedImage): boolean => {
  if (img.fileType?.startsWith('video/')) return true;
  const name = (img.name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
};

// ── Sub-group image card (triggers thumbnail loading) ──────────────────

interface SubGroupImageCardProps {
  image: IndexedImage;
  isSelected: boolean;
  onClick: (image: IndexedImage, event: React.MouseEvent) => void;
}

const SubGroupImageCard: React.FC<SubGroupImageCardProps> = React.memo(({
  image,
  isSelected,
  onClick,
}) => {
  // Trigger thumbnail generation — same hook used by ImageCard in ImageGrid
  useThumbnail(image);

  return (
    <div
      className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
        isSelected
          ? 'border-blue-500 shadow-lg shadow-blue-500/20 ring-1 ring-blue-500/30'
          : 'border-gray-700/50 hover:border-gray-500 hover:shadow-md'
      }`}
      style={{ width: 180, height: 180 }}
      onClick={(e) => onClick(image, e)}
      title={image.name || ''}
    >
      {/* Thumbnail image */}
      {image.thumbnailUrl && !isVideo(image) ? (
        <img
          src={image.thumbnailUrl}
          alt={image.name || 'Image'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : isVideo(image) ? (
        <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-1">
          <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-gray-500">Video</span>
        </div>
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
            <span className="text-[10px] text-gray-500">Loading…</span>
          </div>
        </div>
      )}

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 bg-blue-500 text-white text-[10px] font-bold w-5 h-5 rounded-md flex items-center justify-center shadow-md">
          ✓
        </div>
      )}

      {/* Hover overlay with filename */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="text-[10px] text-white truncate leading-tight">
          {image.name}
        </p>
      </div>
    </div>
  );
});

SubGroupImageCard.displayName = 'SubGroupImageCard';

// ── Main view ──────────────────────────────────────────────────────────

interface SimilarityStackExpandedViewProps {
  images: IndexedImage[];
  subGroups: { promptHash: string; prompt: string; imageIds: string[] }[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBack: () => void;
}

/**
 * Drill-down view for a similarity-based library stack.
 *
 * Renders sub-groups of images organized by their exact prompt. Each sub-group
 * displays the prompt in a header panel above its images, making it easy to see
 * how prompts vary within a similarity group.
 *
 * Replaces the flat ImageGrid when drilling into a stack that has subGroups.
 */
const SimilarityStackExpandedView: React.FC<SimilarityStackExpandedViewProps> = ({
  images,
  subGroups,
  onImageClick,
  selectedImages,
  onBack,
}) => {
  // Build a map from imageId to image for quick lookup within sub-groups
  const imageMap = React.useMemo(() => {
    const map = new Map<string, IndexedImage>();
    for (const img of images) {
      map.set(img.id, img);
    }
    return map;
  }, [images]);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar — replaces the default "Back to stacks" bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0 px-6 py-2 bg-gray-900/40 border-b border-gray-800/40">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-md hover:bg-blue-500/20 transition-all text-xs font-medium border border-blue-500/20 shadow-sm"
        >
          <ArrowLeft size={14} />
          <span>Library</span>
        </button>
        <div className="text-xs text-gray-400">
          {images.length} {images.length === 1 ? 'image' : 'images'}
          {subGroups.length > 1 && (
            <span> · {subGroups.length} prompt variations</span>
          )}
        </div>
      </div>

      {/* Scrollable sub-group sections */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-adaptive">
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

          return (
            <div key={sg.promptHash} className="mb-2">
              {/* Prompt header panel — styled like StackExpandedView's cluster prompt */}
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

              {/* Image cards for this sub-group */}
              <div className="px-6 mt-3">
                <div className="flex flex-row flex-wrap gap-2">
                  {sgImages.map((img) => (
                    <SubGroupImageCard
                      key={img.id}
                      image={img}
                      isSelected={selectedImages.has(img.id)}
                      onClick={onImageClick}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {/* Bottom padding for scroll comfort */}
        <div className="h-8" />
      </div>
    </div>
  );
};

export default SimilarityStackExpandedView;
