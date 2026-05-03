import React, { useMemo, useEffect, useState } from 'react';
import { Layers, Sparkles } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

import { ImageCluster, IndexedImage } from '../types';
import StackCard from './StackCard';
import StackExpandedView from './StackExpandedView';
import Footer from './Footer';

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

interface ClusterEntry {
  cluster: ImageCluster;
  images: IndexedImage[];
}

interface SmartLibraryProps {
}

const SmartLibrary: React.FC<SmartLibraryProps> = () => {
  const filteredImages = useImageStore((state) => state.filteredImages);
  const clusters = useImageStore((state) => state.clusters);
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isClustering = useImageStore((state) => state.isClustering);
  const clusteringProgress = useImageStore((state) => state.clusteringProgress);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const autoTaggingProgress = useImageStore((state) => state.autoTaggingProgress);
  const startClustering = useImageStore((state) => state.startClustering);
  const cancelClustering = useImageStore((state) => state.cancelClustering);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);
  const cancelAutoTagging = useImageStore((state) => state.cancelAutoTagging);
  const setClusterNavigationContext = useImageStore((state) => state.setClusterNavigationContext);
  // const selectedImages = useImageStore((state) => state.selectedImages); // Unused in this file directly
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);
  const restoreSmartLibraryCache = useImageStore((state) => state.restoreSmartLibraryCache);

  const imageSize = useSettingsStore((state) => state.viewZoomLevels.smart);
  const { viewMode, toggleViewMode } = useSettingsStore();
  // const { handleDeleteSelectedImages, clearSelection } = useImageSelection(); // Unused
  const safeFilteredImages = Array.isArray(filteredImages) ? filteredImages : [];

  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'count' | 'similarity'>('count');

  const imageMap = useMemo(() => {
    return new Map(safeFilteredImages.map((image) => [image.id, image]));
  }, [safeFilteredImages]);

  const clusterEntries = useMemo(() => {
    return clusters
      .map((cluster) => ({
        cluster,
        images: cluster.imageIds
          .map((id) => imageMap.get(id))
          .filter((image): image is IndexedImage => Boolean(image)),
      }))
      .filter((entry) => entry.images.length >= 3); // Minimum 3 images per cluster
  }, [clusters, imageMap]);

  const sortedEntries = useMemo(() => {
    return [...clusterEntries].sort((a, b) => {
      if (sortBy === 'similarity') {
        return b.cluster.similarityThreshold - a.cluster.similarityThreshold;
      } else {
        const imageCountDelta = b.images.length - a.images.length;
        if (imageCountDelta !== 0) {
          return imageCountDelta;
        }
        return b.cluster.size - a.cluster.size;
      }
    });
  }, [clusterEntries, sortBy]);



  useEffect(() => {
    if (expandedClusterId && !clusterEntries.some((entry) => entry.cluster.id === expandedClusterId)) {
      setExpandedClusterId(null);
    }
  }, [expandedClusterId, clusterEntries]);

  const activeCluster = expandedClusterId
    ? clusterEntries.find((entry) => entry.cluster.id === expandedClusterId) ?? null
    : null;

  const activeClusterImages = useMemo(() => {
    if (!activeCluster) {
      return [];
    }
    return [...activeCluster.images].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  }, [activeCluster]);

  const primaryPath = directories[0]?.path ?? '';
  const hasDirectories = directories.length > 0;

  // Cache restoration is now handled globally in App.tsx
  // to ensure auto-tags and clusters are available before opening Smart Library 

  const handleGenerateClusters = () => {
    if (!primaryPath) return;
    startClustering(primaryPath, scanSubfolders, DEFAULT_SIMILARITY_THRESHOLD);
  };

  const handleGenerateAutoTags = () => {
    if (!primaryPath) return;
    startAutoTagging(primaryPath, scanSubfolders);
  };

  return (
    <section className="flex flex-col h-full min-h-0 pt-3">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeCluster ? (
          <StackExpandedView
            cluster={activeCluster.cluster}
            images={activeClusterImages}
            allImages={activeClusterImages}
            onBack={() => {
              setClusterNavigationContext(null);
              setExpandedClusterId(null);
            }}
            viewMode={viewMode}
          />
        ) : sortedEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <div className="w-14 h-14 rounded-full bg-gray-800/60 flex items-center justify-center mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-200">No clusters yet</h3>
            <p className="text-xs max-w-md mt-2">
              Generate clusters to group similar prompts into visual stacks. This is fully virtual and does not move files.
            </p>
          </div>
        ) : (
          <div className="min-h-0 pl-3 pr-2">
            <div 
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(350, Math.max(250, imageSize))}px, 1fr))` }}
            >
              {sortedEntries.map((entry) => {
                return (
                  <StackCard
                    key={entry.cluster.id}
                    cluster={entry.cluster}
                    images={entry.images}
                    onOpen={() => setExpandedClusterId(entry.cluster.id)}
                  />
                );
              })}
            </div>


          </div>
        )}
      </div>

      <Footer
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
        filteredCount={safeFilteredImages.length}
        totalCount={selectionTotalImages}
        enrichmentProgress={enrichmentProgress}
        autoTaggingProgress={autoTaggingProgress}
        clusteringProgress={clusteringProgress}
        onCancelAutoTag={cancelAutoTagging}
        onCancelClustering={cancelClustering}
        showSmartActions={true}
        onCluster={handleGenerateClusters}
        onAutoTag={handleGenerateAutoTags}
        isClustering={isClustering}
        isAutoTagging={isAutoTagging}
        hasDirectories={hasDirectories}
      />
    </section>
  );
};

export default SmartLibrary;
