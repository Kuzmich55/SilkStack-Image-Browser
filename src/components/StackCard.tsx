import React, { useEffect, useRef, useState } from 'react';
import { Layers, Lock } from 'lucide-react';
import { ImageCluster, IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';

interface StackCardProps {
  cluster: ImageCluster;
  images: IndexedImage[];
  onOpen: () => void;
}

const StackCard: React.FC<StackCardProps> = ({ cluster, images, onOpen }) => {
  const [previewIndex, setPreviewIndex] = useState(0);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingIndexRef = useRef(0);

  const previewImage = images[previewIndex] ?? images[0] ?? null;
  useThumbnail(previewImage);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const updatePreviewIndex = (nextIndex: number) => {
    pendingIndexRef.current = nextIndex;
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      setPreviewIndex(pendingIndexRef.current);
      rafRef.current = null;
    });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!cardRef.current || images.length < 2) return;
    const rect = cardRef.current.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = rect.width > 0 ? relativeX / rect.width : 0;
    const index = Math.floor(ratio * (images.length - 1));
    updatePreviewIndex(index);
  };

  const handlePointerLeave = () => {
    updatePreviewIndex(0);
  };

  const promptLabel = cluster.basePrompt || previewImage?.prompt || 'Untitled stack';
  const coverUrl = previewImage?.thumbnailUrl || '';
  const displayCount = images.length;
  const totalCount = cluster.size;
  const countLabel = displayCount === totalCount ? `${displayCount}` : `${displayCount}/${totalCount}`;
  const detailCountLabel = displayCount === totalCount ? `${displayCount} images` : `${displayCount}/${totalCount} images`;

  const handleClick = () => {
    onOpen();
  };

  return (
    <button
      ref={cardRef}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="group text-left bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-md transition-all hover:shadow-xl hover:shadow-blue-500/10 dark:bg-gray-900/60 dark:border-gray-800 dark:shadow-lg dark:hover:shadow-blue-500/20"
      type="button"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={promptLabel}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-100 via-gray-200 to-gray-100 flex items-center justify-center text-gray-400 dark:from-gray-800 dark:via-gray-900 dark:to-gray-800 dark:text-gray-400">
            <Layers className="w-8 h-8 opacity-70" />
          </div>
        )}


        <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-gray-100 shadow-sm backdrop-blur-sm dark:bg-black/60 dark:shadow-none">
          <Layers className="w-3.5 h-3.5" />
          {countLabel}
        </div>
        {images.length > 1 && (
          <div className="absolute bottom-3 left-3 right-3 h-1 rounded-full bg-black/20 overflow-hidden dark:bg-black/40">
            <div
              className="h-full bg-blue-400/80 transition-all duration-100"
              style={{
                width: images.length > 1 ? `${(previewIndex / (images.length - 1)) * 100}%` : '0%',
              }}
            />
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-100 truncate">{promptLabel}</p>
        <p className="text-xs text-gray-300 mt-1">
          {detailCountLabel} | similarity {Math.round(cluster.similarityThreshold * 100)}%
        </p>
      </div>
    </button>
  );
};

export default StackCard;
