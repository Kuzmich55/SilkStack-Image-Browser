import { create } from 'zustand';
import { IndexedImage, Directory, ThumbnailStatus, ImageAnnotations, TagInfo, ImageCluster, AutoTag, LibraryStackContext } from '../types';
import { loadSelectedFolders, saveSelectedFolders, loadExcludedFolders, saveExcludedFolders } from '../services/folderSelectionStorage';
import { loadFolderPreferences, saveFolderPreference, deleteFolderPreference, FolderPreference } from '../services/folderPreferencesStorage';
import {
  loadAllAnnotations,
  saveAnnotation,
  bulkSaveAnnotations,
  getAllTags,
} from '../services/imageAnnotationsStorage';

import { normalizePath } from '../utils/pathUtils';
import { getAspectRatio as getImageAspectRatio } from '../utils/imageUtils';
import { useSettingsStore } from './useSettingsStore';

const RECENT_TAGS_STORAGE_KEY = 'image-metahub-recent-tags';
const MAX_RECENT_TAGS = 12;

const loadRecentTags = (): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = localStorage.getItem(RECENT_TAGS_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter(Boolean)
            .slice(0, MAX_RECENT_TAGS);
    } catch (error) {
        console.warn('Failed to load recent tags:', error);
        return [];
    }
};

const persistRecentTags = (tags: string[]) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(RECENT_TAGS_STORAGE_KEY, JSON.stringify(tags));
    } catch (error) {
        console.warn('Failed to persist recent tags:', error);
    }
};

const updateRecentTags = (currentTags: string[], tag: string): string[] => {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
        return currentTags;
    }

    const next = [normalizedTag, ...currentTags.filter(existing => existing !== normalizedTag)];
    return next.slice(0, MAX_RECENT_TAGS);
};


const getImageFolderPath = (image: IndexedImage, directoryPath: string): string => {
    const normalizedDirectory = normalizePath(directoryPath);
    const idParts = image.id.split('::');
    if (idParts.length !== 2) {
        return normalizedDirectory;
    }

    const relativePath = idParts[1];
    const segments = relativePath.split(/[/\\]/).filter(Boolean);
    if (segments.length <= 1) {
        return normalizedDirectory;
    }

    const folderSegments = segments.slice(0, -1);
    const folderRelativePath = folderSegments.join('/');
    return joinPath(normalizedDirectory, folderRelativePath);
};

const detectSeparator = (path: string) => (path.includes('\\') && !path.includes('/')) ? '\\' : '/';

const joinPath = (base: string, relative: string) => {
    if (!relative) {
        return normalizePath(base);
    }
    const separator = detectSeparator(base);
    const normalizedBase = normalizePath(base);
    const normalizedRelative = relative
        .split(/[/\\]/)
        .filter(segment => segment.length > 0)
        .join(separator);
    if (!normalizedBase) {
        return normalizedRelative;
    }
    return `${normalizedBase}${separator}${normalizedRelative}`;
};

const getRelativeImagePath = (image: IndexedImage): string => {
    if (!image?.id) return image?.name ?? '';
    const [, relative = ''] = image.id.split('::');
    return relative || image.name;
};

const buildCatalogSearchText = (image: IndexedImage): string => {
    const relativePath = getRelativeImagePath(image).replace(/\\/g, '/').toLowerCase();
    const name = (image.name || '').toLowerCase();
    const directory = (image.directoryName || '').replace(/\\/g, '/').toLowerCase();
    
    const tags = (image.tags || []).join(' ').toLowerCase();
    const autoTags = (image.autoTags || []).join(' ').toLowerCase();
    const metadataTags = (image.metadataTags || []).join(' ').toLowerCase();

    return [name, relativePath, directory, tags, autoTags, metadataTags].filter(Boolean).join(' ');
};

const buildEnrichedSearchText = (image: IndexedImage): string => {
    if (image.enrichmentState !== 'enriched') {
        return '';
    }

    const segments: string[] = [];
    if (image.metadataString) {
        // metadataString is intentionally set to '' to save memory
        // keeping this block in case older clients have it, but skipping segments.push to avoid bloat
    }
    if (image.prompt) {
        segments.push(image.prompt.toLowerCase());
    }
    if (image.negativePrompt) {
        segments.push(image.negativePrompt.toLowerCase());
    }
    if (image.models?.length) {
        segments.push(image.models.filter(model => typeof model === 'string').map(model => model.toLowerCase()).join(' '));
    }
    if (image.loras?.length) {
        const loraNames = image.loras.map(lora => {
            if (typeof lora === 'string') {
                return lora.toLowerCase();
            } else if (lora && typeof lora === 'object' && lora.name) {
                return lora.name.toLowerCase();
            }
            return '';
        }).filter(Boolean);
        if (loraNames.length > 0) {
            segments.push(loraNames.join(' '));
        }
    }
    if (image.scheduler) {
        segments.push(image.scheduler.toLowerCase());
    }
    if (image.board) {
        segments.push(image.board.toLowerCase());
    }

    return segments.join(' ');
};

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  selectionTotalImages: number;
  selectionDirectoryCount: number;
  directories: Directory[];
  selectedFolders: Set<string>;
  excludedFolders: Set<string>;
  isFolderSelectionLoaded: boolean;
  includeSubfolders: boolean;
  folderPreferences: Map<string, FolderPreference>;

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number } | null;
  enrichmentProgress: { processed: number; total: number } | null;
  indexingState: 'idle' | 'indexing' | 'paused' | 'completed';
  error: string | null;
  success: string | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;
  previewImage: IndexedImage | null;
  focusedImageIndex: number | null;
  isStackingEnabled: boolean;
  scanSubfolders: boolean;
  libraryStackContext: LibraryStackContext | null;  // For Back to Stacks navigation (ID-based, preserves search bar)
  isFullscreenMode: boolean;
  activeView: 'library' | 'smart' | 'model';



  // Filter & Sort State
  searchQuery: string;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  availableDimensions: string[];
  availableAspectRatios: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random';
  randomSeed: number;
  advancedFilters: any;

  // Annotations State
  annotations: Map<string, ImageAnnotations>;
  availableTags: TagInfo[];
  recentTags: string[];
  selectedTags: string[];
  showFavoritesOnly: boolean;
  selectionFavoriteCount: number;
  isAnnotationsLoaded: boolean;
  activeWatchers: Set<string>; // IDs das pastas sendo monitoradas
  refreshingDirectories: Set<string>;

  // Smart Clustering State (Phase 2)
  clusters: ImageCluster[];
  clusteringProgress: { current: number; total: number; message: string } | null;
  clusteringWorker: Worker | null;
  isClustering: boolean;
  clusterNavigationContext: IndexedImage[] | null; // Images from currently opened cluster for modal navigation

  // Auto-Tagging State (Phase 3)

  autoTaggingProgress: { current: number; total: number; message: string } | null;
  autoTaggingWorker: Worker | null;
  isAutoTagging: boolean;

  // Actions
  addDirectory: (directory: Directory) => void;
  updateDirectoryStatus: (directoryId: string, isConnected: boolean) => void;
  removeDirectory: (directoryId: string) => void;
  reorderDirectories: (orderedIds: string[]) => void;
  toggleDirectoryVisibility: (directoryId: string) => void;
  toggleAutoWatch: (directoryId: string) => void;
  initializeFolderSelection: () => Promise<void>;
  toggleFolderSelection: (path: string, ctrlKey: boolean) => void;
  clearFolderSelection: () => void;
  // Excluded Folders Actions
  addExcludedFolder: (path: string) => void;
  removeExcludedFolder: (path: string) => void;
  isFolderSelected: (path: string) => boolean;
  setFolderEmoji: (path: string, emoji: string | undefined) => Promise<void>;
  setFolderScanSubfolders: (path: string, scanSubfolders: boolean) => Promise<void>;
  toggleIncludeSubfolders: () => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number } | null) => void;
  setEnrichmentProgress: (progress: { processed: number; total: number } | null) => void;
  setIndexingState: (indexingState: 'idle' | 'indexing' | 'paused' | 'completed') => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setImages: (images: IndexedImage[]) => void;
  addImages: (newImages: IndexedImage[]) => void;
  replaceDirectoryImages: (directoryId: string, newImages: IndexedImage[]) => void;
  mergeImages: (updatedImages: IndexedImage[]) => void;
  removeImage: (imageId: string) => void;
  removeImages: (imageIds: string[]) => void;
  removeImagesByPaths: (paths: string[]) => void;
  updateImage: (imageId: string, newName: string) => void;
  updateImageDimensions: (imageId: string, dimensions: string) => void;
  clearImages: (directoryId?: string) => void;
  setImageThumbnail: (
    imageId: string,
    data: {
      thumbnailUrl?: string | null;
      thumbnailHandle?: FileSystemFileHandle | null;
      status: ThumbnailStatus;
      error?: string | null;
    }
  ) => void;
  clearAllThumbnails: () => void;

  // Filter & Sort Actions
  setSearchQuery: (query: string) => void;
  setFilterOptions: (options: { models: string[]; loras: string[]; schedulers: string[]; dimensions: string[] }) => void;
  setSelectedFilters: (filters: { models?: string[]; loras?: string[]; schedulers?: string[] }) => void;
  setSortOrder: (order: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random') => void;
  reshuffle: () => void;
  setAdvancedFilters: (filters: any) => void;
  filterAndSortImages: () => void;

  // Selection Actions
  setPreviewImage: (image: IndexedImage | null) => void;
  setSelectedImage: (image: IndexedImage | null) => void;
  toggleImageSelection: (imageId: string) => void;
  selectAllImages: () => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;
  setFocusedImageIndex: (index: number | null) => void;
  setLibraryStackContext: (context: LibraryStackContext | null) => void;
  syncNewImagesToStacks: () => Promise<void>;
  handleStackImageDeletion: (deletedImageIds: string[]) => void;
  computeSimilarityGroups: () => Promise<void>;
  setFullscreenMode: (isFullscreen: boolean) => void;

  // Clustering Actions (Phase 2)
  startClustering: (directoryPath: string, scanSubfolders: boolean, threshold: number) => Promise<void>;
  cancelClustering: () => void;
  setClusters: (clusters: ImageCluster[]) => void;
  setClusteringProgress: (progress: { current: number; total: number; message: string } | null) => void;
  handleClusterImageDeletion: (deletedImageIds: string[]) => void;
  setClusterNavigationContext: (images: IndexedImage[] | null) => void;

  // Auto-Tagging Actions (Phase 3)
  startAutoTagging: (
    directoryPath: string,
    scanSubfolders: boolean,
    options?: { topN?: number; minScore?: number }
  ) => Promise<void>;
  cancelAutoTagging: () => void;
  setAutoTaggingProgress: (progress: { current: number; total: number; message: string } | null) => void;
  restoreSmartLibraryCache: (directoryPath: string, scanSubfolders: boolean) => Promise<void>;



  // Annotations Actions
  loadAnnotations: () => Promise<void>;
  toggleFavorite: (imageId: string) => Promise<void>;
  bulkToggleFavorite: (imageIds: string[], isFavorite: boolean) => Promise<void>;
  addTagToImage: (imageId: string, tag: string) => Promise<void>;
  removeTagFromImage: (imageId: string, tag: string) => Promise<void>;
  bulkAddTag: (imageIds: string[], tag: string) => Promise<void>;
  bulkRemoveTag: (imageIds: string[], tag: string) => Promise<void>;
  setSelectedTags: (tags: string[]) => void;
  setShowFavoritesOnly: (show: boolean) => void;
  getImageAnnotations: (imageId: string) => ImageAnnotations | null;
  refreshAvailableTags: () => Promise<void>;
  clearAutoTags: () => Promise<void>;
  importMetadataTags: (images: IndexedImage[]) => Promise<void>;
  flushPendingImages: () => void;
  setDirectoryRefreshing: (directoryId: string, isRefreshing: boolean) => void;

  // Navigation Actions
  handleNavigateNext: () => void;
  handleNavigatePrevious: () => void;

  // Cleanup invalid images
  cleanupInvalidImages: () => void;
  setStackingEnabled: (enabled: boolean) => void;

  // Drag and Drop State (Internal)
  draggedItems: { sourcePath: string; name: string }[];
  setDraggedItems: (items: { sourcePath: string; name: string }[]) => void;
  clearDraggedItems: () => void;

  // Scroll Positions
  folderScrollPositions: Record<string, number>;
  setFolderScrollPosition: (key: string, position: number) => void;
  setActiveView: (view: 'library' | 'smart' | 'model') => void;

  // Reset Actions
  resetState: () => void;
}

export const useImageStore = create<ImageState>((set, get) => {
    // --- Throttle map to prevent excessive setImageThumbnail calls ---
    const thumbnailUpdateTimestamps = new Map<string, { count: number; lastUpdate: number }>();
    const thumbnailUpdateInProgress = new Set<string>();
    const lastThumbnailState = new Map<string, {
        url: string | undefined;
        handle: FileSystemFileHandle | undefined;
        status: ThumbnailStatus;
        error: string | null | undefined;
    }>();
    let pendingImagesQueue: IndexedImage[] = [];
    let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL_MS = 100;
    let pendingMergeQueue: IndexedImage[] = [];
    let pendingMergeTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingFilterRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingDimensionUpdates = new Map<string, string>();
    let pendingDimensionTimer: ReturnType<typeof setTimeout> | null = null;
    const MERGE_FLUSH_INTERVAL_MS = 250;
    const MERGE_FLUSH_INTERVAL_INDEXING_MS = 3000;
    const MERGE_FLUSH_INTERVAL_INDEXING_LARGE_MS = 15000;
    const MERGE_FLUSH_LARGE_THRESHOLD = 8000;
    const FILTER_RECOMPUTE_INDEXING_MS = 5000;

    const clearPendingQueue = () => {
        pendingImagesQueue = [];
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }
        pendingMergeQueue = [];
        if (pendingMergeTimer) {
            clearTimeout(pendingMergeTimer);
            pendingMergeTimer = null;
        }
        if (pendingFilterRecomputeTimer) {
            clearTimeout(pendingFilterRecomputeTimer);
            pendingFilterRecomputeTimer = null;
        }
        pendingDimensionUpdates.clear();
        if (pendingDimensionTimer) {
            clearTimeout(pendingDimensionTimer);
            pendingDimensionTimer = null;
        }
    };

    const flushPendingImages = () => {
        if (pendingImagesQueue.length === 0) {
            return;
        }

        const imagesToAdd = pendingImagesQueue;
        pendingImagesQueue = [];
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }

        let addedImages: IndexedImage[] = [];
        set(state => {
            const deduped = new Map<string, IndexedImage>();
            for (const img of imagesToAdd) {
                if (img?.id && !deduped.has(img.id.toLowerCase())) {
                    deduped.set(img.id.toLowerCase(), img);
                }
            }
            const queuedUnique = Array.from(deduped.values());
            const existingIdsLower = new Set(state.images.map(img => img.id.toLowerCase()));
            const uniqueNewImages = queuedUnique.filter(img => !existingIdsLower.has(img.id.toLowerCase()));

            if (uniqueNewImages.length === 0) {

                return state;
            }
            addedImages = uniqueNewImages;
            const allImages = [...state.images, ...uniqueNewImages];

            const newState = _updateState(state, allImages);

            return newState;
        });

        // Import tags from metadata after images are added to store
        if (addedImages.length > 0) {
            get().importMetadataTags(addedImages);
        }
    };

    const scheduleFlush = () => {
        if (pendingFlushTimer) {
            return;
        }
        pendingFlushTimer = setTimeout(() => {
            flushPendingImages();
        }, FLUSH_INTERVAL_MS);
    };

    const flushPendingMerges = (forceFullRecompute: boolean = false) => {
        if (pendingMergeQueue.length === 0) {
            return;
        }

        const updatesToMerge = pendingMergeQueue;
        pendingMergeQueue = [];
        if (pendingMergeTimer) {
            clearTimeout(pendingMergeTimer);
            pendingMergeTimer = null;
        }

        set(state => {
            const updates = new Map<string, IndexedImage>();
            for (const img of updatesToMerge) {
                if (img?.id) {
                    updates.set(img.id, img);
                }
            }
            if (updates.size === 0) {
                return state;
            }

            let hasChanges = false;
            const merged = state.images.map(img => {
                const updated = updates.get(img.id);
                if (updated) {
                    hasChanges = true;
                    return updated;
                }
                return img;
            });

            if (!hasChanges) {
                return state;
            }

            const isIndexing = state.indexingState === 'indexing';
            if (isIndexing && !forceFullRecompute) {
                const filtersActive = isFilteringActive(state);
                let nextFilteredImages = state.filteredImages;
                let availableFiltersUpdate: Partial<ImageState> = {};

                if (!filtersActive) {
                    nextFilteredImages = merged;
                    const models = new Set(state.availableModels);
                    const loras = new Set(state.availableLoras);
                    const schedulers = new Set(state.availableSchedulers);
                    const dimensions = new Set(state.availableDimensions);
                    const aspectRatios = new Set(state.availableAspectRatios);

                    for (const img of updates.values()) {
                        img.models?.forEach(model => { if (typeof model === 'string' && model) models.add(model); });
                        img.loras?.forEach(lora => {
                            if (typeof lora === 'string' && lora) {
                                loras.add(lora);
                            } else if (lora && typeof lora === 'object' && lora.name) {
                                loras.add(lora.name);
                            }
                        });
                        if (img.scheduler) {
                            schedulers.add(img.scheduler);
                        }
                        if (img.dimensions) {
                            dimensions.add(img.dimensions);
                            const [w, h] = img.dimensions.split('x').map(Number);
                            if (w > 0 && h > 0) {
                                const ar = getImageAspectRatio(w, h);
                                if (ar) aspectRatios.add(ar);
                            }
                        }
                    }

                    availableFiltersUpdate = {
                        availableModels: Array.from(models),
                        availableLoras: Array.from(loras),
                        availableSchedulers: Array.from(schedulers),
                        availableDimensions: Array.from(dimensions),
                        availableAspectRatios: Array.from(aspectRatios),
                    };
                } else {
                    nextFilteredImages = state.filteredImages.map(img => updates.get(img.id) ?? img);
                    scheduleFilterRecompute();
                }

                return {
                    ...state,
                    images: merged,
                    filteredImages: nextFilteredImages,
                    selectionTotalImages: merged.length,
                    selectionDirectoryCount: state.directories.length,
                    ...availableFiltersUpdate,
                };
            }

            return _updateState(state, merged);
        });
    };

    const scheduleMergeFlush = () => {
        if (pendingMergeTimer) {
            return;
        }
        const isIndexing = get().indexingState === 'indexing';
        const interval = isIndexing
            ? (get().images.length >= MERGE_FLUSH_LARGE_THRESHOLD
                ? MERGE_FLUSH_INTERVAL_INDEXING_LARGE_MS
                : MERGE_FLUSH_INTERVAL_INDEXING_MS)
            : MERGE_FLUSH_INTERVAL_MS;
        pendingMergeTimer = setTimeout(() => {
            flushPendingMerges();
        }, interval);
    };

    const isFilteringActive = (state: ImageState) => {
        if (state.searchQuery) return true;
        if (state.libraryStackContext) return true;
        if (state.showFavoritesOnly) return true;
        if (state.selectedTags?.length) return true;

        if (state.selectedModels?.length || state.selectedLoras?.length || state.selectedSchedulers?.length) return true;
        if (state.advancedFilters && Object.keys(state.advancedFilters).length > 0) return true;
        if (state.selectedFolders && state.selectedFolders.size > 0) return true;
        if (state.directories.some(dir => dir.visible === false)) return true;
        return false;
    };

    const scheduleFilterRecompute = () => {
        if (pendingFilterRecomputeTimer) {
            return;
        }
        pendingFilterRecomputeTimer = setTimeout(() => {
            pendingFilterRecomputeTimer = null;
            set(state => {
                const filteredResult = filterAndSort(state);
                const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);
                return { ...state, ...filteredResult, ...availableFilters };
            });
        }, FILTER_RECOMPUTE_INDEXING_MS);
    };

    const getImageById = (state: ImageState, imageId: string): IndexedImage | undefined => {
        return state.images.find(img => img.id === imageId) || state.filteredImages.find(img => img.id === imageId);
    };

    // --- Helper function to recalculate available filters from visible images ---
    const recalculateAvailableFilters = (visibleImages: IndexedImage[]) => {
        const models = new Set<string>();
        const loras = new Set<string>();
        const schedulers = new Set<string>();
        const dimensions = new Set<string>();
        const aspectRatios = new Set<string>();

        for (const image of visibleImages) {
            image.models?.forEach(model => { if(typeof model === 'string' && model) models.add(model) });
            image.loras?.forEach(lora => {
                if (typeof lora === 'string' && lora) {
                    loras.add(lora);
                } else if (lora && typeof lora === 'object' && lora.name) {
                    loras.add(lora.name);
                }
            });
            if (image.scheduler) schedulers.add(image.scheduler);
            if (image.dimensions && image.dimensions !== '0x0') {
                dimensions.add(image.dimensions);
                const [w, h] = image.dimensions.split('x').map(Number);
                if (w > 0 && h > 0) {
                    const ar = getImageAspectRatio(w, h);
                    if (ar) aspectRatios.add(ar);
                }
            }
        }

        // Case-insensitive alphabetical comparator
        const caseInsensitiveSort = (a: string, b: string) => {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        };

        return {
            availableModels: Array.from(models).sort(caseInsensitiveSort),
            availableLoras: Array.from(loras).sort(caseInsensitiveSort),
            availableSchedulers: Array.from(schedulers).sort(caseInsensitiveSort),
            availableDimensions: Array.from(dimensions).sort((a, b) => {
                // Sort dimensions by total pixels (width * height)
                const [aWidth, aHeight] = a.split('x').map(Number);
                const [bWidth, bHeight] = b.split('x').map(Number);
                return (aWidth * aHeight) - (bWidth * bHeight);
            }),
            availableAspectRatios: Array.from(aspectRatios).sort((a, b) => {
                // Sort by ratio value (width/height)
                const [aW, aH] = a.split(':').map(Number);
                const [bW, bH] = b.split(':').map(Number);
                return (aW / aH) - (bW / bH);
            }),
        };
    };

    const mergeAnnotationTags = (annotation: ImageAnnotations): string[] => {
        return [...new Set([
            ...(annotation.tags || []),
            ...(annotation.autoTags || []),
            ...(annotation.metadataTags || []),
        ])];
    };

    // --- Helper function to apply annotations to images ---
    const applyAnnotationsToImages = (images: IndexedImage[], annotations: Map<string, ImageAnnotations>): IndexedImage[] => {
        let hasChanges = false;
        const result = images.map(img => {
            const annotation = annotations.get(img.id);
            if (annotation) {
                // Check if annotation values are different from current image values
                const isFavoriteChanged = img.isFavorite !== annotation.isFavorite;
                const mergedTags = mergeAnnotationTags(annotation);
                const tagsChanged = JSON.stringify(img.tags || []) !== JSON.stringify(mergedTags);
                const stackChanged = img.stackGroupId !== annotation.stackGroupId
                    || img.isStackAnalyzed !== annotation.isStackAnalyzed
                    || img.similarityGroupId !== annotation.similarityGroupId;

                if (isFavoriteChanged || tagsChanged || stackChanged) {
                    hasChanges = true;
                    return {
                        ...img,
                        isFavorite: annotation.isFavorite,
                        tags: mergedTags,
                        autoTags: annotation.autoTags || [],
                        metadataTags: annotation.metadataTags || [],
                        stackGroupId: annotation.stackGroupId,
                        isStackAnalyzed: annotation.isStackAnalyzed,
                        similarityGroupId: annotation.similarityGroupId,
                    };
                }
            }
            return img;
        });

        // Only return new array if there were actual changes
        return hasChanges ? result : images;
    };

    // --- Helper function for recalculating all derived state ---
    const _updateState = (currentState: ImageState, newImages: IndexedImage[]) => {
        // Apply annotations to new images
        const imagesWithAnnotations = applyAnnotationsToImages(newImages, currentState.annotations);

        // Early return if images didn't change (prevents unnecessary recalculations)
        if (imagesWithAnnotations === currentState.images) {
            return currentState;
        }

        const newState: Partial<ImageState> = {
            images: imagesWithAnnotations,
        };

        const combinedState = { ...currentState, ...newState };

        // First, get filtered images based on folder selection

        const filteredResult = filterAndSort(combinedState);


        // Then, recalculate available filters based on the filtered images (after folder selection)
        const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);

        return {
            ...combinedState,
            ...filteredResult,
            ...availableFilters,
        };
    };

    // --- Helper for calculating available tags and favorites in a given image set ---
    const calculateTagInfo = (images: IndexedImage[]): TagInfo[] => {
        const tagCounts = new Map<string, number>();
        for (const img of images) {
            if (img.tags && img.tags.length > 0) {
                for (const tag of img.tags) {
                    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                }
            }
        }

        const result: TagInfo[] = Array.from(tagCounts.entries()).map(([name, count]) => ({
            name,
            count,
        }));

        return result.sort((a, b) => a.name.localeCompare(b.name));
    };

    // --- Helper function for basic filtering and sorting ---
    const filterAndSort = (state: ImageState) => {
        const { images, searchQuery, libraryStackContext, selectedModels, selectedLoras, selectedSchedulers, sortOrder, advancedFilters, directories, selectedFolders, excludedFolders, includeSubfolders } = state;

        const visibleDirectoryIds = new Set(
            directories.filter(dir => (dir.visible ?? true) && (dir.isConnected !== false)).map(dir => dir.id)
        );


        const directoryPathMap = new Map<string, string>();
        directories.forEach(dir => {
            const normalized = normalizePath(dir.path);
            directoryPathMap.set(dir.id, normalized);
        });

        // Filter images based on folder selection and exclusion
        const selectionFiltered = images.filter((img) => {
            if (!visibleDirectoryIds.has(img.directoryId || '')) {
                return false;
            }

            const parentPath = directoryPathMap.get(img.directoryId || '');
            if (!parentPath) {
                return false;
            }

            const folderPath = normalizePath(getImageFolderPath(img, parentPath));

            // EXCLUSION CHECK: If folder is excluded, hide image
            if (excludedFolders && excludedFolders.size > 0) {
                for (const excludedFolder of excludedFolders) {
                    const normalizedExcluded = normalizePath(excludedFolder);
                    // Check if folderPath IS the excluded folder or IS A CHILD of the excluded folder
                    if (folderPath === normalizedExcluded ||
                        folderPath.startsWith(normalizedExcluded + '/') ||
                        folderPath.startsWith(normalizedExcluded + '\\')) {
                        return false;
                    }
                }
            }

            // If no folders are selected, show all images from visible directories (unless excluded)
            if (selectedFolders.size === 0) {
                return true;
            }

            // Direct matching - check if folder is explicitly selected
            if (selectedFolders.has(folderPath)) {
                return true;
            }

            // If includeSubfolders is enabled, check if any parent folder is selected
            if (includeSubfolders) {
                for (const selectedFolder of selectedFolders) {
                    const normalizedSelected = normalizePath(selectedFolder);
                    // Check if folderPath is a subfolder of selectedFolder
                    if (folderPath.startsWith(normalizedSelected + '/') || folderPath.startsWith(normalizedSelected + '\\')) {
                        return true;
                    }
                }
            }

            return false;
        });

        const selectionFavoriteCount = selectionFiltered.filter(img => img.isFavorite).length;
        const availableTags = calculateTagInfo(selectionFiltered);

        let results = selectionFiltered;

        // Step 2: Favorites filter
        if (state.showFavoritesOnly) {
            results = results.filter(img => img.isFavorite === true);
        }

        // Step 3: Sensitive tags filter (safe mode)
        const { sensitiveTags, blurSensitiveImages, enableSafeMode, displayStarredFirst } = useSettingsStore.getState();
        const normalizedSensitiveTags = (sensitiveTags ?? [])
            .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter(Boolean);
        const sensitiveTagSet = new Set(normalizedSensitiveTags);
        const shouldFilterSensitive = enableSafeMode && !blurSensitiveImages && sensitiveTagSet.size > 0;
        if (shouldFilterSensitive) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return true;
                return !img.tags.some(tag => sensitiveTagSet.has(tag.toLowerCase()));
            });
        }

        // Step 4: Tags filter
        if (state.selectedTags && state.selectedTags.length > 0) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return false;
                // Match ANY selected tag (OR logic)
                return state.selectedTags.some(tag => img.tags!.includes(tag));
            });
        }

        // ID-based stack filtering (preserves search bar state)
        if (libraryStackContext) {
            const contextImageIds = new Set(libraryStackContext.imageIds);
            results = results.filter(image => contextImageIds.has(image.id));
        } else if (searchQuery) {
            const searchTerms = searchQuery
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean);

            if (searchTerms.length > 0) {
                results = results.filter(image => {
                    const catalogText = buildCatalogSearchText(image);
                    const catalogMatch = searchTerms.every(term => catalogText.includes(term));
                    if (catalogMatch) {
                        return true;
                    }

                    const enrichedText = buildEnrichedSearchText(image);
                    if (!enrichedText) {
                        return false;
                    }

                    return searchTerms.every(term => enrichedText.includes(term));
                });
            }
        }

        if (selectedModels.length > 0) {
            results = results.filter(image =>
                image.models?.length > 0 && selectedModels.some(sm => image.models.includes(sm))
            );
        }

        if (selectedLoras.length > 0) {
            results = results.filter(image => {
                if (!image.loras || image.loras.length === 0) return false;

                // Extract LoRA names from both strings and LoRAInfo objects
                const loraNames = image.loras.map(lora =>
                    typeof lora === 'string' ? lora : (lora?.name || '')
                ).filter(Boolean);

                return selectedLoras.some(sl => loraNames.includes(sl));
            });
        }

        if (selectedSchedulers.length > 0) {
            results = results.filter(image =>
                selectedSchedulers.includes(image.scheduler)
            );
        }

        if (advancedFilters) {
            if (advancedFilters.dimension) {
                results = results.filter(image => {
                    if (!image.dimensions) return false;
                    // Normalize dimensions format (handle both "512x512" and "512 x 512")
                    const imageDim = image.dimensions.replace(/\s+/g, '');
                    const filterDim = advancedFilters.dimension.replace(/\s+/g, '');
                    return imageDim === filterDim;
                });
            }
            if (advancedFilters.aspectRatio) {
                results = results.filter(image => {
                    if (!image.dimensions) return false;
                    const [w, h] = image.dimensions.split('x').map(Number);
                    if (!w || !h) return false;
                    return getImageAspectRatio(w, h) === advancedFilters.aspectRatio;
                });
            }
            if (advancedFilters.steps) {
                 results = results.filter(image => {
                    const steps = image.steps;
                    if (steps !== null && steps !== undefined) {
                        return steps >= advancedFilters.steps.min && steps <= advancedFilters.steps.max;
                    }
                    return false;
                });
            }
            if (advancedFilters.cfg) {
                 results = results.filter(image => {
                    const cfg = image.cfgScale;
                    if (cfg !== null && cfg !== undefined) {
                        return cfg >= advancedFilters.cfg.min && cfg <= advancedFilters.cfg.max;
                    }
                    return false;
                });
            }
            if (advancedFilters.date && (advancedFilters.date.from || advancedFilters.date.to)) {
                results = results.filter(image => {
                    const imageTime = image.lastModified;
                    
                    // Check "from" date if provided
                    if (advancedFilters.date!.from) {
                        const fromTime = new Date(advancedFilters.date!.from).getTime();
                        if (imageTime < fromTime) return false;
                    }
                    
                    // Check "to" date if provided
                    if (advancedFilters.date!.to) {
                        const toDate = new Date(advancedFilters.date!.to);
                        toDate.setDate(toDate.getDate() + 1); // Include full end date
                        const toTime = toDate.getTime();
                        if (imageTime >= toTime) return false;
                    }
                    
                    return true;
                });
            }

        }

        const totalInScope = images.length; // Total absoluto de imagens indexadas
        const selectionDirectoryCount = state.directories.length;

        const compareById = (a: IndexedImage, b: IndexedImage) => a.id.localeCompare(b.id);
        const compareByNameAsc = (a: IndexedImage, b: IndexedImage) => {
            const nameComparison = (a.name || '').localeCompare(b.name || '');
            if (nameComparison !== 0) {
                return nameComparison;
            }
            return compareById(a, b);
        };
        const compareByNameDesc = (a: IndexedImage, b: IndexedImage) => {
            const nameComparison = (b.name || '').localeCompare(a.name || '');
            if (nameComparison !== 0) {
                return nameComparison;
            }
            return compareById(a, b);
        };
        const compareByDateAsc = (a: IndexedImage, b: IndexedImage) => {
            const dateComparison = a.lastModified - b.lastModified;
            if (dateComparison !== 0) {
                return dateComparison;
            }
            return compareByNameAsc(a, b);
        };
        const compareByDateDesc = (a: IndexedImage, b: IndexedImage) => {
            const dateComparison = b.lastModified - a.lastModified;
            if (dateComparison !== 0) {
                return dateComparison;
            }
            return compareByNameAsc(a, b);
        };

        // Seeded random number generator helper
        const seededRandom = (seed: number) => {
            const x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };

        // Simple string hash function
        const stringHash = (str: string) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash;
        };

        const compareRandom = (a: IndexedImage, b: IndexedImage) => {
            // Combine image ID with state.randomSeed to create a stable sort key for this seed
            // We use the stringHash of the ID + seed to get a pseudo-random value fixed for this session/seed
            const seed = state.randomSeed || 0;
            const hashA = stringHash(a.id + seed.toString());
            const hashB = stringHash(b.id + seed.toString());
            
            if (hashA !== hashB) {
                return hashA - hashB;
            }
            return a.id.localeCompare(b.id);
        };

        const sorted = [...results].sort((a, b) => {
            if (displayStarredFirst) {
                if (a.isFavorite && !b.isFavorite) return -1;
                if (!a.isFavorite && b.isFavorite) return 1;
            }

            if (sortOrder === 'asc') return compareByNameAsc(a, b);
            if (sortOrder === 'desc') return compareByNameDesc(a, b);
            if (sortOrder === 'date-asc') return compareByDateAsc(a, b);
            if (sortOrder === 'date-desc') return compareByDateDesc(a, b);
            if (sortOrder === 'random') return compareRandom(a, b);
            return compareById(a, b);
        });

        return {
            filteredImages: sorted,
            selectionTotalImages: totalInScope,
            selectionDirectoryCount,
            selectionFavoriteCount,
            availableTags,
        };
    };

    const flushDimensionUpdates = () => {
        if (pendingDimensionUpdates.size === 0) return;
        if (pendingDimensionTimer) {
            clearTimeout(pendingDimensionTimer);
            pendingDimensionTimer = null;
        }

        set(state => {
            let changed = false;
            const updatedImages = state.images.map(img => {
                const newDim = pendingDimensionUpdates.get(img.id);
                if (newDim && img.dimensions !== newDim) {
                    changed = true;
                    return { ...img, dimensions: newDim };
                }
                return img;
            });
            
            pendingDimensionUpdates.clear();
            
            if (!changed) return state;
            return _updateState(state, updatedImages);
        });
    };

    return {
        // Initial State
        images: [],
        filteredImages: [],
        selectionTotalImages: 0,
        selectionDirectoryCount: 0,
        selectionFavoriteCount: 0,
        directories: [],
        selectedFolders: new Set(),
        excludedFolders: new Set(),
        isFolderSelectionLoaded: false,
        includeSubfolders: localStorage.getItem('image-metahub-include-subfolders') !== 'false', // Default to true
        folderPreferences: new Map(),
        isLoading: false,
        progress: null,
        enrichmentProgress: null,
        indexingState: 'idle',
        error: null,
        success: null,
        selectedImage: null,
        previewImage: null,
        selectedImages: new Set(),
        focusedImageIndex: null,
        isStackingEnabled: false,
        searchQuery: '',
        availableModels: [],
        availableLoras: [],
        availableSchedulers: [],
        availableDimensions: [],
        availableAspectRatios: [],
        selectedModels: [],
        selectedLoras: [],
        selectedSchedulers: [],
        sortOrder: 'date-desc',
        randomSeed: Date.now(),
        advancedFilters: {},
        scanSubfolders: localStorage.getItem('image-metahub-scan-subfolders') !== 'false', // Default to true
        libraryStackContext: null,
        activeView: 'library',
        isFullscreenMode: false,


        // Annotations initial values
        annotations: new Map(),
        availableTags: [],
        recentTags: loadRecentTags(),
        selectedTags: [],
        showFavoritesOnly: false,
        isAnnotationsLoaded: false,
        activeWatchers: new Set(),
        refreshingDirectories: new Set(),

        // Smart Clustering initial values (Phase 2)
        clusters: [],
        clusteringProgress: null,
        clusteringWorker: null,
        isClustering: false,
        clusterNavigationContext: null,

        // Auto-Tagging initial values (Phase 3)

        autoTaggingProgress: null,
        autoTaggingWorker: null,
        isAutoTagging: false,
        draggedItems: [],

        // --- ACTIONS ---

        addDirectory: (directory) => set(state => {
            // Case-insensitive check for duplicates
            const normalizedNewId = normalizePath(directory.id);
            if (state.directories.some(d => normalizePath(d.id) === normalizedNewId)) {
                return state; // Prevent adding duplicates
            }
            const newDirectories = [...state.directories, { ...directory, visible: directory.visible ?? true }];
            const newState = { ...state, directories: newDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),


        updateDirectoryStatus: (directoryId, isConnected) => set(state => {
            const updatedDirectories = state.directories.map(dir =>
                dir.id === directoryId ? { ...dir, isConnected } : dir
            );
            
            // Only trigger re-render if status actually changed
            const changed = state.directories.some(dir => 
                dir.id === directoryId && dir.isConnected !== isConnected
            );
            
            if (!changed) return state;

            const newState = { ...state, directories: updatedDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),

        toggleDirectoryVisibility: (directoryId) => set(state => {
            const updatedDirectories = state.directories.map(dir =>
                dir.id === directoryId ? { ...dir, visible: !(dir.visible ?? true) } : dir
            );
            const newState = { ...state, directories: updatedDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),

        toggleAutoWatch: (directoryId) => {
            set((state) => {
                const directories = state.directories.map((dir) =>
                    dir.id === directoryId
                        ? { ...dir, autoWatch: !dir.autoWatch }
                        : dir
                );

                // Persistir directories no localStorage
                if (typeof window !== 'undefined') {
                    const paths = directories.map(d => d.path);
                    localStorage.setItem('image-metahub-directories', JSON.stringify(paths));

                    // Persistir estado de autoWatch separadamente para manter sincronizado
                    const watchStates = Object.fromEntries(
                        directories.map(d => [d.id, { enabled: !!d.autoWatch, path: d.path }])
                    );
                    localStorage.setItem('image-metahub-directory-watchers', JSON.stringify(watchStates));
                }

                return { directories };
            });
        },

        initializeFolderSelection: async () => {
            Promise.all([
                loadSelectedFolders(),
                loadExcludedFolders(),
                loadFolderPreferences()
            ]).then(([selectedPaths, excludedPaths, preferences]) => {
                set(state => {
                    // Only update if not already loaded to avoid overwriting current selection during re-renders
                    if (state.isFolderSelectionLoaded) {
                        return state;
                    }

                    const prefMap = new Map<string, FolderPreference>();
                    preferences.forEach(p => {
                        const normalizedP = normalizePath(p.path);
                        prefMap.set(normalizedP, { ...p, path: normalizedP });
                    });

                    const newState = {
                        selectedFolders: new Set(selectedPaths.map(p => normalizePath(p))),
                        excludedFolders: new Set(excludedPaths.map(p => normalizePath(p))),
                        folderPreferences: prefMap,
                        isFolderSelectionLoaded: true
                    };
                    
                    return _updateState({ ...state, ...newState }, state.images); // Re-run filtering
                });
            });
        },

        addExcludedFolder: (path: string) => {
            const normalizedPath = normalizePath(path);
            set(state => {
                const newExcluded = new Set(state.excludedFolders);
                newExcluded.add(normalizedPath);
                
                // If the folder was selected, deselect it
                const newSelected = new Set(state.selectedFolders);
                if (newSelected.has(normalizedPath)) {
                    newSelected.delete(normalizedPath);
                }

                saveExcludedFolders(Array.from(newExcluded));
                saveSelectedFolders(Array.from(newSelected));

                return _updateState({ ...state, excludedFolders: newExcluded, selectedFolders: newSelected }, state.images);
            });
        },

        removeExcludedFolder: (path: string) => {
            const normalizedPath = normalizePath(path);
            set(state => {
                const newExcluded = new Set(state.excludedFolders);
                newExcluded.delete(normalizedPath);
                saveExcludedFolders(Array.from(newExcluded));
                return _updateState({ ...state, excludedFolders: newExcluded }, state.images);
            });
        },

        toggleFolderSelection: (path: string, ctrlKey: boolean) => {
            const normalizedPath = normalizePath(path);
            set(state => {
                const selection = new Set(state.selectedFolders);

                if (ctrlKey) {
                    // Multi-select: toggle this folder
                    if (selection.has(normalizedPath)) {
                        selection.delete(normalizedPath);
                    } else {
                        selection.add(normalizedPath);
                    }
                } else {
                    // Single select: replace all with this folder
                    // If clicking the same folder that's already the only selection, clear it
                    if (selection.size === 1 && selection.has(normalizedPath)) {
                        selection.clear();
                    } else {
                        selection.clear();
                        selection.add(normalizedPath);
                    }
                }

                const newState = { ...state, selectedFolders: selection };
                const resultState = { ...newState, ...filterAndSort(newState) };

                // Recalculate available filters based on the new filtered images
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                const finalState = { ...resultState, ...availableFilters };

                // Persist to IndexedDB
                saveSelectedFolders(Array.from(selection)).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return finalState;
            });
        },

        clearFolderSelection: () => {
            set(state => {
                const selection = new Set<string>();

                const newState = { ...state, selectedFolders: selection };
                const resultState = { ...newState, ...filterAndSort(newState) };

                // Recalculate available filters based on the new filtered images
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                const finalState = { ...resultState, ...availableFilters };

                // Persist to IndexedDB
                saveSelectedFolders([]).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return finalState;
            });
        },

        isFolderSelected: (path) => {
            const normalizedPath = normalizePath(path);
            return get().selectedFolders.has(normalizedPath);
        },



        setFolderEmoji: async (path, emoji) => {
            const normalizedPath = normalizePath(path);
            const { folderPreferences } = get();

            const existingPref = folderPreferences.get(normalizedPath) || { path: normalizedPath };
            const pref: FolderPreference = {
                ...existingPref,
                emoji
            };

            set(state => {
                const newPrefs = new Map(state.folderPreferences);
                if (emoji === undefined && pref.scanSubfolders === undefined) {
                    newPrefs.delete(normalizedPath);
                } else {
                    newPrefs.set(normalizedPath, pref);
                }
                return { folderPreferences: newPrefs };
            });

            if (emoji === undefined && pref.scanSubfolders === undefined) {
                await deleteFolderPreference(normalizedPath);
            } else {
                await saveFolderPreference(pref);
            }
        },

        setFolderScanSubfolders: async (path, scanSubfolders) => {
            const normalizedPath = normalizePath(path);
            const { folderPreferences } = get();
            
            const existingPref = folderPreferences.get(normalizedPath) || { path: normalizedPath };
            const pref: FolderPreference = {
                ...existingPref,
                scanSubfolders
            };

            set(state => {
                const newPrefs = new Map(state.folderPreferences);
                newPrefs.set(normalizedPath, pref);
                return { folderPreferences: newPrefs };
            });

            await saveFolderPreference(pref);
        },

        toggleIncludeSubfolders: () => {
            set(state => {
                const newValue = !state.includeSubfolders;
                localStorage.setItem('image-metahub-include-subfolders', String(newValue));
                const newState = { ...state, includeSubfolders: newValue };
                return { ...newState, ...filterAndSort(newState) };
            });
        },

        removeDirectory: (directoryId) => {
            const { directories, images, selectedFolders, folderPreferences } = get();
            const targetDirectory = directories.find(d => d.id === directoryId);
            const newDirectories = directories.filter(d => d.id !== directoryId);
            if (window.electronAPI) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
            }
            const newImages = images.filter(img => img.directoryId !== directoryId);

            // Remove all selected folders belonging to this directory
            const updatedSelection = new Set(selectedFolders);
            const updatedPrefs = new Map(folderPreferences);

            if (targetDirectory) {
                const normalizedPath = normalizePath(targetDirectory.path);
                for (const folderPath of Array.from(updatedSelection)) {
                    const normalizedFolder = normalizePath(folderPath);
                    // Remove if it's the directory itself or starts with the directory path
                    if (normalizedFolder === normalizedPath || normalizedFolder.startsWith(normalizedPath + '/') || normalizedFolder.startsWith(normalizedPath + '\\')) {
                        updatedSelection.delete(folderPath);
                    }
                }

                for (const [folderPath, pref] of Array.from(updatedPrefs.entries())) {
                    const normalizedFolder = normalizePath(folderPath);
                    if (normalizedFolder === normalizedPath || normalizedFolder.startsWith(normalizedPath + '/') || normalizedFolder.startsWith(normalizedPath + '\\')) {
                        updatedPrefs.delete(folderPath);
                        
                        // Delete both the raw key and the normalized key to ensure we catch old stored records
                        // that didn't apply normalizePath before saving.
                        deleteFolderPreference(folderPath).catch(err => {
                            console.error('Failed to delete folder preference for', folderPath, err);
                        });
                        
                        if (folderPath !== normalizedFolder) {
                            deleteFolderPreference(normalizedFolder).catch(err => {
                                console.error('Failed to delete folder preference for', normalizedFolder, err);
                            });
                        }
                    }
                }
            }

            set(state => {
                const baseState = { ...state, directories: newDirectories, selectedFolders: updatedSelection, folderPreferences: updatedPrefs };
                return _updateState(baseState, newImages);
            });

            saveSelectedFolders(Array.from(updatedSelection)).catch((error) => {
                console.error('Failed to persist folder selection state', error);
            });
        },

        reorderDirectories: (orderedIds) => set(state => {
            const orderedDirs = orderedIds
                .map(id => state.directories.find(d => d.id === id))
                .filter((d): d is Directory => d !== undefined);
            const remaining = state.directories.filter(d => !orderedIds.includes(d.id));
            const newDirectories = [...orderedDirs, ...remaining];

            if (window.electronAPI) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
            }

            return { directories: newDirectories };
        }),

        setLoading: (loading) => set({ isLoading: loading }),
        setProgress: (progress) => set({ progress }),
        setEnrichmentProgress: (progress) => set({ enrichmentProgress: progress }),
        setIndexingState: (indexingState) => {
            if (indexingState !== 'indexing') {
                flushPendingMerges(true);
            }
            set({ indexingState });
        },
        setError: (error) => set({ error, success: null }),
        setSuccess: (success) => set({ success, error: null }),

        filterAndSortImages: () => set(state => filterAndSort(state)),

        setImages: (images) => {
            clearPendingQueue();
            set(state => _updateState(state, images));
        },

        addImages: (newImages) => {
            if (!newImages || newImages.length === 0) {
                return;
            }
            pendingImagesQueue.push(...newImages);
            scheduleFlush();
        },

        replaceDirectoryImages: (directoryId, newImages) => {
            clearPendingQueue();
            set(state => {
                // Remove all images from this directory
                const otherImages = state.images.filter(img => img.directoryId !== directoryId);
                // Add new images for this directory
                const allImages = [...otherImages, ...newImages];
                return _updateState(state, allImages);
            });
        },

        mergeImages: (updatedImages) => {
            if (!updatedImages || updatedImages.length === 0) {
                return;
            }

            const isIndexing = get().indexingState === 'indexing';
            if (isIndexing) {
                pendingMergeQueue.push(...updatedImages);
                scheduleMergeFlush();
                return;
            }

            flushPendingImages();
            flushPendingMerges();
            set(state => {
                const updates = new Map(updatedImages.map(img => [img.id, img]));
                const merged = state.images.map(img => updates.get(img.id) ?? img);
                return _updateState(state, merged);
            });
        },

        clearImages: (directoryId?: string) => set(state => {
            clearPendingQueue();
            if (directoryId) {
                const newImages = state.images.filter(img => img.directoryId !== directoryId);
                return _updateState(state, newImages);
            } else {
                return _updateState(state, []);
            }
        }),

        removeImages: (imageIds) => {
            const idsToRemove = new Set(imageIds);
            flushPendingImages();
            set(state => {
                const remainingImages = state.images.filter(img => !idsToRemove.has(img.id));
                return _updateState(state, remainingImages);
            });
        },

        removeImagesByPaths: (paths) => {
            const pathsToRemove = new Set(paths.map(p => normalizePath(p).toLowerCase())); // Normalize and lowercase
            flushPendingImages();

            set(state => {
                const { directories } = state;
                // Create directory map for fast lookup
                const dirMap = new Map<string, string>();
                directories.forEach(dir => dirMap.set(dir.id, normalizePath(dir.path)));

                const remainingImages = state.images.filter(img => {
                    const dirPath = dirMap.get(img.directoryId || '');
                    if (!dirPath) return true; // Keep if we can't determine path
                    
                    const relativePath = getRelativeImagePath(img);
                    const fullPath = joinPath(dirPath, relativePath);
                    const normalizedFullPath = normalizePath(fullPath).toLowerCase();
                    
                    return !pathsToRemove.has(normalizedFullPath);
                });
                
                if (remainingImages.length === state.images.length) return state;
                return _updateState(state, remainingImages);
            });
        },

        removeImage: (imageId) => {
            flushPendingImages();
            set(state => {
                const remainingImages = state.images.filter(img => img.id !== imageId);
                return _updateState(state, remainingImages);
            });
        },

        updateImage: (imageId, newName) => {
            set(state => {
                const updatedImages = state.images.map(img => img.id === imageId ? { ...img, name: newName } : img);
                // No need to recalculate filters for a simple name change
                return { ...state, ...filterAndSort({ ...state, images: updatedImages }), images: updatedImages };
            });
        },

        updateImageDimensions: (imageId, dimensions) => {
            pendingDimensionUpdates.set(imageId, dimensions);
            if (!pendingDimensionTimer) {
                pendingDimensionTimer = setTimeout(() => {
                    flushDimensionUpdates();
                }, 200); // Batch every 200ms
            }
        },

        clearAllThumbnails: () => {
            set(state => {
                const nextImages = state.images.map(img => {
                    if (img.thumbnailStatus === 'ready' || img.thumbnailUrl) {
                        return {
                            ...img,
                            thumbnailStatus: undefined as any,
                            thumbnailUrl: undefined
                        };
                    }
                    return img;
                });
                
                let nextPreviewImage = state.previewImage;
                if (nextPreviewImage && (nextPreviewImage.thumbnailStatus === 'ready' || nextPreviewImage.thumbnailUrl)) {
                    nextPreviewImage = {
                        ...nextPreviewImage,
                        thumbnailStatus: undefined as any,
                        thumbnailUrl: undefined
                    };
                }

                let nextSelectedImage = state.selectedImage;
                if (nextSelectedImage && (nextSelectedImage.thumbnailStatus === 'ready' || nextSelectedImage.thumbnailUrl)) {
                    nextSelectedImage = {
                        ...nextSelectedImage,
                        thumbnailStatus: undefined as any,
                        thumbnailUrl: undefined
                    };
                }

                return {
                    ..._updateState(state, nextImages),
                    previewImage: nextPreviewImage,
                    selectedImage: nextSelectedImage
                };
            });
        },

        setImageThumbnail: (imageId, data) => {
            const preState = get();
            const preImage = getImageById(preState, imageId);

            if (!preImage) {
                return;
            }

            const nextThumbnailUrl = data.thumbnailUrl ?? preImage.thumbnailUrl;
            const nextThumbnailHandle = data.thumbnailHandle ?? preImage.thumbnailHandle;
            const nextThumbnailStatus = data.status;
            const nextThumbnailError = data.error ?? (data.status === 'error'
                ? 'Failed to load thumbnail'
                : preImage.thumbnailError);

            const lastState = lastThumbnailState.get(imageId);
            if (
                lastState &&
                lastState.url === nextThumbnailUrl &&
                lastState.handle === nextThumbnailHandle &&
                lastState.status === nextThumbnailStatus &&
                lastState.error === nextThumbnailError
            ) {
                return; // Identical to last applied payload
            }

            if (
                preImage.thumbnailUrl === nextThumbnailUrl &&
                preImage.thumbnailHandle === nextThumbnailHandle &&
                preImage.thumbnailStatus === nextThumbnailStatus &&
                preImage.thumbnailError === nextThumbnailError
            ) {
                lastThumbnailState.set(imageId, {
                    url: nextThumbnailUrl,
                    handle: nextThumbnailHandle,
                    status: nextThumbnailStatus,
                    error: nextThumbnailError,
                });
                return;
            }

            if (thumbnailUpdateInProgress.has(imageId)) {
                return;
            }

            thumbnailUpdateInProgress.add(imageId);

            try {
                set(state => {
                    // CIRCUIT BREAKER: Prevent excessive updates
                    const now = Date.now();
                    const stats = thumbnailUpdateTimestamps.get(imageId) || { count: 0, lastUpdate: now };

                    if (now - stats.lastUpdate > 1000) {
                        stats.count = 0;
                        stats.lastUpdate = now;
                    }

                    stats.count++;
                    thumbnailUpdateTimestamps.set(imageId, stats);

                    if (stats.count > 10) {
                        console.warn(`⚠️ Circuit breaker activated: ${imageId} received ${stats.count} updates in 1s. Blocking update.`);
                        return state;
                    }

                    const currentImage = getImageById(state, imageId);

                    if (!currentImage) {
                        return state;
                    }

                    const nextThumbnailUrl = data.thumbnailUrl ?? currentImage.thumbnailUrl;
                    const nextThumbnailHandle = data.thumbnailHandle ?? currentImage.thumbnailHandle;
                    const nextThumbnailStatus = data.status;
                    const nextThumbnailError = data.error ?? (data.status === 'error'
                        ? 'Failed to load thumbnail'
                        : currentImage.thumbnailError);

                    if (
                        currentImage.thumbnailUrl === nextThumbnailUrl &&
                        currentImage.thumbnailHandle === nextThumbnailHandle &&
                        currentImage.thumbnailStatus === nextThumbnailStatus &&
                        currentImage.thumbnailError === nextThumbnailError
                    ) {
                        return state;
                    }

                    const updateList = (list: IndexedImage[]) => {
                        const index = list.findIndex(img => img.id === imageId);
                        if (index === -1) {
                            return list;
                        }

                        const current = list[index];

                        if (
                            current.thumbnailUrl === nextThumbnailUrl &&
                            current.thumbnailHandle === nextThumbnailHandle &&
                            current.thumbnailStatus === nextThumbnailStatus &&
                            current.thumbnailError === nextThumbnailError
                        ) {
                            return list;
                        }

                        const newList = [...list];
                        newList[index] = {
                            ...list[index],
                            thumbnailUrl: nextThumbnailUrl,
                            thumbnailHandle: nextThumbnailHandle,
                            thumbnailStatus: nextThumbnailStatus,
                            thumbnailError: nextThumbnailError,
                        };
                        return newList;
                    };

                    const updatedImages = updateList(state.images);
                    const updatedFilteredImages = updateList(state.filteredImages);

                    if (updatedImages === state.images && updatedFilteredImages === state.filteredImages) {
                        return state;
                    }

                    lastThumbnailState.set(imageId, {
                        url: nextThumbnailUrl,
                        handle: nextThumbnailHandle,
                        status: nextThumbnailStatus,
                        error: nextThumbnailError,
                    });

                    return {
                        ...state,
                        images: updatedImages,
                        filteredImages: updatedFilteredImages,
                    };
                });
            } finally {
                thumbnailUpdateInProgress.delete(imageId);
            }
        },

        setSearchQuery: (query) => set(state => ({ ...filterAndSort({ ...state, searchQuery: query }), searchQuery: query })),

        setFilterOptions: (options) => set({
            availableModels: options.models,
            availableLoras: options.loras,
            availableSchedulers: options.schedulers,
            availableDimensions: options.dimensions,
        }),

        setSelectedFilters: (filters) => set(state => ({
            ...filterAndSort({
                ...state,
                selectedModels: filters.models ?? state.selectedModels,
                selectedLoras: filters.loras ?? state.selectedLoras,
                selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
            }),
            selectedModels: filters.models ?? state.selectedModels,
            selectedLoras: filters.loras ?? state.selectedLoras,
            selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
        })),

        setAdvancedFilters: (filters) => set(state => ({
            ...filterAndSort({ ...state, advancedFilters: filters }),
            advancedFilters: filters,
        })),

        setSortOrder: (order) => {
          set(state => ({ ...filterAndSort({ ...state, sortOrder: order }), sortOrder: order }));
          // Persist to settings
          useSettingsStore.getState().setSortOrder(order);
        },
        
        reshuffle: () => set(state => {
            const newSeed = Date.now();
            return {
                ...filterAndSort({ ...state, randomSeed: newSeed }),
                randomSeed: newSeed
            };
        }),

        setPreviewImage: (image) => set({ previewImage: image }),
        setSelectedImage: (image) => {
            set({ selectedImage: image });
        },
        setFocusedImageIndex: (index) => set({ focusedImageIndex: index }),
        setFullscreenMode: (isFullscreen) => set({ isFullscreenMode: isFullscreen }),

        // Clustering Actions (Phase 2)
        startClustering: async (directoryPath: string, scanSubfolders: boolean, threshold: number) => {
            const { images, clusteringWorker: existingWorker } = get();

            // Cancel existing worker if running
            if (existingWorker) {
                existingWorker.terminate();
            }

            const imagesWithPrompts = images.filter(img => img.prompt && img.prompt.trim());
            const limitedImages = imagesWithPrompts;

            // Create new worker
            const worker = new Worker(
                new URL('../services/workers/clusteringWorker.ts', import.meta.url),
                { type: 'module' }
            );

            set({ clusteringWorker: worker, isClustering: true, clusteringProgress: { current: 0, total: limitedImages.length, message: 'Initializing...' } });

            // Handle worker messages
            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                switch (type) {
                    case 'progress':
                        set({ clusteringProgress: payload });
                        break;

                    case 'complete':
                        set({
                            clusters: payload.clusters,
                            clusteringProgress: null,
                            isClustering: false,
                        });
                        worker.terminate();
                        set({ clusteringWorker: null });
                        console.log(`Clustering complete: ${payload.clusters.length} clusters created`);

                        // Save cluster cache to disk for persistence across restarts
                        import('../services/clusterCacheManager')
                            .then(({ saveClusterCache }) => saveClusterCache(directoryPath, scanSubfolders, payload.clusters, threshold))
                            .catch(error => console.warn('Failed to save cluster cache:', error));
                        break;

                    case 'error':
                        console.error('Clustering error:', payload.error);
                        set({
                            clusteringProgress: null,
                            isClustering: false,
                            error: `Clustering failed: ${payload.error}`,
                        });
                        worker.terminate();
                        set({ clusteringWorker: null });
                        break;
                }
            };

            // Prepare lightweight data for worker (90% less data)
            const lightweightImages = limitedImages.map(img => ({
                id: img.id,
                prompt: img.prompt!,
                lastModified: img.lastModified,
            }));

            // Start clustering
            worker.postMessage({
                type: 'start',
                payload: {
                    images: lightweightImages,
                    threshold,
                },
            });
        },

        cancelClustering: () => {
            const { clusteringWorker } = get();
            if (clusteringWorker) {
                clusteringWorker.postMessage({ type: 'cancel' });
                clusteringWorker.terminate();
                set({
                    clusteringWorker: null,
                    clusteringProgress: null,
                    isClustering: false,
                });
            }
        },

        setClusters: (clusters) => set({ clusters }),

        setClusteringProgress: (progress) => set({ clusteringProgress: progress }),

        setClusterNavigationContext: (images) => set({ clusterNavigationContext: images }),

        handleClusterImageDeletion: (deletedImageIds: string[]) => {
            const { clusters } = get();
            if (clusters.length === 0) return;

            // Import removeImagesFromClusters dynamically to avoid circular deps
            import('../services/clusteringEngine').then(({ removeImagesFromClusters }) => {
                const updatedClusters = removeImagesFromClusters(deletedImageIds, clusters);
                set({ clusters: updatedClusters });
            });
        },

        // Auto-Tagging Actions (Phase 3)
        startAutoTagging: async (directoryPath, scanSubfolders, options) => {
            const { filteredImages, annotations, autoTaggingWorker: existingWorker } = get();

            if (filteredImages.length === 0) {
                console.log('No images in current view to auto-tag');
                return;
            }

            // Filter to images that still need auto-tagging BEFORE creating the worker
            const taggingImages = filteredImages.filter(img => {
                const annotation = annotations.get(img.id);
                return !annotation?.isAutoTagged;
            }).map(img => ({
                id: img.id,
                prompt: img.prompt,
                models: img.models,
                loras: img.loras,
            }));

            if (taggingImages.length === 0) {
                console.log('No new images in current view to auto-tag');
                return;
            }

            if (existingWorker) {
                existingWorker.terminate();
            }

            const worker = new Worker(
                new URL('../services/workers/autoTaggingWorker.ts', import.meta.url),
                { type: 'module' }
            );

            set({
                autoTaggingWorker: worker,
                isAutoTagging: true,
                autoTaggingProgress: { current: 0, total: taggingImages.length, message: 'Initializing...' }
            });

            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                switch (type) {
                    case 'progress':
                        set({ autoTaggingProgress: payload });
                        break;
                    case 'complete': {
                        const generatedAt = Date.now();
                        const tagMap = new Map<string, string[]>();
                        Object.entries(payload.autoTags || {}).forEach(([id, tags]: [string, AutoTag[]]) => {
                            const normalizedTags = [...new Set((tags || []).map((tag) => tag.tag).filter(Boolean))];
                            tagMap.set(id, normalizedTags);
                        });

                        // Add generated tags to autoTags (not manual tags)
                        const { annotations } = get();
                        const updatedAnnotations: ImageAnnotations[] = [];

                        for (const [imageId, newTags] of tagMap) {
                            const current = annotations.get(imageId);
                            const existingAutoTags = current?.autoTags ?? [];
                            const mergedAutoTags = [...new Set([...existingAutoTags, ...newTags])];

                            updatedAnnotations.push({
                                imageId,
                                isFavorite: current?.isFavorite ?? false,
                                tags: current?.tags ?? [],
                                autoTags: mergedAutoTags,
                                metadataTags: current?.metadataTags ?? [],
                                addedAt: current?.addedAt ?? generatedAt,
                                updatedAt: generatedAt,
                                isAutoTagged: true,
                            });
                        }

                        // Persist annotations
                        if (updatedAnnotations.length > 0) {
                            import('../services/imageAnnotationsStorage')
                                .then(({ bulkSaveAnnotations }) => bulkSaveAnnotations(updatedAnnotations))
                                .catch(error => console.warn('Failed to persist auto-tags as annotations:', error));
                        }

                        set(state => {
                            const newAnnotations = new Map(state.annotations);
                            for (const annotation of updatedAnnotations) {
                                newAnnotations.set(annotation.imageId, annotation);
                            }

                            const updateList = (list: IndexedImage[]) => list.map(img => {
                                const annotation = newAnnotations.get(img.id);
                                if (annotation) {
                                    const mergedTags = mergeAnnotationTags(annotation);
                                    return { ...img, tags: mergedTags, autoTags: annotation.autoTags, metadataTags: annotation.metadataTags, isAutoTagged: annotation.isAutoTagged };
                                }
                                return img;
                            });

                            return {
                                ...state,
                                annotations: newAnnotations,
                                images: updateList(state.images),
                                filteredImages: updateList(state.filteredImages),
                                autoTaggingProgress: null,
                                isAutoTagging: false,
                            };
                        });

                        worker.terminate();
                        set({ autoTaggingWorker: null });
                        console.log(`Auto-tagging complete: ${tagMap.size} images tagged`);

                        if (payload.autoTags) {
                            import('../services/clusterCacheManager')
                                .then(({ saveAutoTagCache }) => saveAutoTagCache(directoryPath, scanSubfolders, payload.autoTags))
                                .catch(error => {
                                    console.warn('Failed to save auto-tag cache:', error);
                                });
                        }
                        break;
                    }
                    case 'error':
                        console.error('Auto-tagging error:', payload.error);
                        set({
                            autoTaggingProgress: null,
                            isAutoTagging: false,
                            error: `Auto-tagging failed: ${payload.error}`,
                        });
                        worker.terminate();
                        set({ autoTaggingWorker: null });
                        break;
                }
            };

            const disableAiFallback = useSettingsStore.getState().disableAiFallback;

            worker.postMessage({
                type: 'start',
                payload: {
                    images: taggingImages,
                    topN: options?.topN,
                    minScore: options?.minScore,
                    disableFallback: disableAiFallback,
                },
            });
        },

        cancelAutoTagging: () => {
            const { autoTaggingWorker } = get();
            if (autoTaggingWorker) {
                autoTaggingWorker.postMessage({ type: 'cancel' });
                autoTaggingWorker.terminate();
                set({
                    autoTaggingWorker: null,
                    autoTaggingProgress: null,
                    isAutoTagging: false,
                });
            }
        },

        setAutoTaggingProgress: (progress) => set({ autoTaggingProgress: progress }),

        restoreSmartLibraryCache: async (directoryPath, scanSubfolders) => {
            try {
                const { loadClusterCache, loadAutoTagCache } =
                    await import('../services/clusterCacheManager');

                // Restore clusters (only if none exist yet)
                const { clusters } = get();
                if (clusters.length === 0) {
                    const clusterCache = await loadClusterCache(directoryPath, scanSubfolders);
                    if (clusterCache?.clusters?.length) {
                        set({ clusters: clusterCache.clusters });
                        console.log(`Restored ${clusterCache.clusters.length} clusters from cache`);
                    }
                }

                // Restore auto-tags into autoTags field
                const autoTagCache = await loadAutoTagCache(directoryPath, scanSubfolders);
                if (autoTagCache?.autoTags && Object.keys(autoTagCache.autoTags).length > 0) {
                    const tagMap = new Map<string, string[]>();
                    for (const [id, tags] of Object.entries(autoTagCache.autoTags)) {
                        const normalizedTags = [...new Set((tags as any[] || []).map((t: any) => t.tag).filter(Boolean))];
                        tagMap.set(id, normalizedTags);
                    }

                    const cacheAnnotations: ImageAnnotations[] = [];
                    const currentAnnotations = get().annotations;
                    for (const [imageId, newTags] of tagMap) {
                        const current = currentAnnotations.get(imageId);
                        const existingAutoTags = current?.autoTags ?? [];
                        const tagsToAdd = newTags.filter(t => !existingAutoTags.includes(t));
                        if (tagsToAdd.length > 0) {
                            cacheAnnotations.push({
                                imageId,
                                isFavorite: current?.isFavorite ?? false,
                                tags: current?.tags ?? [],
                                autoTags: [...existingAutoTags, ...tagsToAdd],
                                isAutoTagged: true,
                                metadataTags: current?.metadataTags ?? [],
                                addedAt: current?.addedAt ?? autoTagCache.lastGenerated ?? Date.now(),
                                updatedAt: Date.now(),
                            });
                        }
                    }

                    if (cacheAnnotations.length > 0) {
                        const { bulkSaveAnnotations } = await import('../services/imageAnnotationsStorage');
                        await bulkSaveAnnotations(cacheAnnotations);

                        set(state => {
                            const newAnnotations = new Map(state.annotations);
                            for (const annotation of cacheAnnotations) {
                                newAnnotations.set(annotation.imageId, annotation);
                            }
                            const newImages = state.images.map(img => {
                                const annotation = newAnnotations.get(img.id);
                                if (annotation) {
                                    const mergedTags = mergeAnnotationTags(annotation);
                                    return { ...img, tags: mergedTags, autoTags: annotation.autoTags, metadataTags: annotation.metadataTags };
                                }
                                return img;
                            });
                            return _updateState({ ...state, annotations: newAnnotations }, newImages);
                        });
                    }
                    console.log(`Restored auto-tags for ${tagMap.size} images from cache`);
                }
            } catch (error) {
                console.debug('Smart library cache not available:', error);
            }
        },



        // Annotations Actions
        loadAnnotations: async () => {
            const annotationsMap = await loadAllAnnotations();
            const tags = await getAllTags();

            set(state => {
                // Denormalize annotations into images array using helper
                const updatedImages = applyAnnotationsToImages(state.images, annotationsMap);

                const newState = {
                    ...state,
                    annotations: annotationsMap,
                    availableTags: tags,
                    isAnnotationsLoaded: true,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // After loading annotations, compute similarity groups.
            // Runs asynchronously — UI shows exact-match stacks immediately.
            const state = get();
            const annValues = Array.from(state.annotations.values());
            const withStackId = annValues.filter(a => !!a.stackGroupId).length;
            const withSimId = annValues.filter(a => !!a.similarityGroupId).length;
            console.log(`[SimilarityGroups] Annotations loaded: ${annValues.length} total, ${withStackId} with stackGroupId, ${withSimId} with similarityGroupId`);

            if (withStackId > 1) {
                console.log('[SimilarityGroups] Triggering similarity computation...');
                get().computeSimilarityGroups();
            } else {
                console.log('[SimilarityGroups] Skipping — need at least 2 unique prompts to merge');
            }
        },

        toggleFavorite: async (imageId) => {
            const { annotations, images } = get();

            const currentAnnotation = annotations.get(imageId);
            const newIsFavorite = !(currentAnnotation?.isFavorite ?? false);

            const updatedAnnotation: ImageAnnotations = {
                imageId,
                isFavorite: newIsFavorite,
                tags: currentAnnotation?.tags ?? [],
                autoTags: currentAnnotation?.autoTags ?? [],
                isAutoTagged: currentAnnotation?.isAutoTagged ?? false,
                metadataTags: currentAnnotation?.metadataTags ?? [],
                addedAt: currentAnnotation?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
            };

            // Update in-memory state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, isFavorite: newIsFavorite } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist to IndexedDB
            try {
                await saveAnnotation(updatedAnnotation);
            } catch (error) {
                console.error('Failed to save annotation:', error);
            }
        },

        bulkToggleFavorite: async (imageIds, isFavorite) => {
            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                updatedAnnotations.push({
                    imageId,
                    isFavorite,
                    tags: current?.tags ?? [],
                    autoTags: current?.autoTags ?? [],
                    isAutoTagged: current?.isAutoTagged ?? false,
                    metadataTags: current?.metadataTags ?? [],
                    addedAt: current?.addedAt ?? Date.now(),
                    updatedAt: Date.now(),
                });
            }

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        return { ...img, isFavorite: annotation.isFavorite };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist to IndexedDB
            try {
                await bulkSaveAnnotations(updatedAnnotations);
            } catch (error) {
                console.error('Failed to bulk save annotations:', error);
            }
        },

        addTagToImage: async (imageId, tag) => {
            const normalizedTag = tag.trim().toLowerCase();
            if (!normalizedTag) return;

            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);

            // Don't add duplicate across any tag source
            const allExisting = [
                ...(currentAnnotation?.tags ?? []),
                ...(currentAnnotation?.autoTags ?? []),
                ...(currentAnnotation?.metadataTags ?? []),
            ];
            if (allExisting.includes(normalizedTag)) {
                return;
            }

            const updatedAnnotation: ImageAnnotations = {
                imageId,
                isFavorite: currentAnnotation?.isFavorite ?? false,
                tags: [...(currentAnnotation?.tags ?? []), normalizedTag],
                autoTags: currentAnnotation?.autoTags ?? [],
                isAutoTagged: currentAnnotation?.isAutoTagged ?? false,
                metadataTags: currentAnnotation?.metadataTags ?? [],
                addedAt: currentAnnotation?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
            };

            let nextRecentTags = get().recentTags;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const mergedTags = mergeAnnotationTags(updatedAnnotation);
                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, tags: mergedTags, autoTags: updatedAnnotation.autoTags, metadataTags: updatedAnnotation.metadataTags } : img
                );

                nextRecentTags = updateRecentTags(state.recentTags, normalizedTag);
                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            // Persist and refresh tags
            try {
                await saveAnnotation(updatedAnnotation);
                await get().refreshAvailableTags();
            } catch (error) {
                console.error('Failed to save annotation:', error);
            }
        },

        removeTagFromImage: async (imageId, tag) => {
            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);

            if (!currentAnnotation) return;

            // Remove from whichever source contains it
            const inManual = currentAnnotation.tags.includes(tag);
            const inAuto = (currentAnnotation.autoTags || []).includes(tag);
            const inMetadata = (currentAnnotation.metadataTags || []).includes(tag);

            if (!inManual && !inAuto && !inMetadata) return;

            const updatedAnnotation: ImageAnnotations = {
                ...currentAnnotation,
                tags: inManual ? currentAnnotation.tags.filter(t => t !== tag) : currentAnnotation.tags,
                autoTags: inAuto ? (currentAnnotation.autoTags || []).filter(t => t !== tag) : (currentAnnotation.autoTags || []),
                metadataTags: inMetadata ? (currentAnnotation.metadataTags || []).filter(t => t !== tag) : (currentAnnotation.metadataTags || []),
                updatedAt: Date.now(),
            };

            const mergedTags = mergeAnnotationTags(updatedAnnotation);

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, tags: mergedTags, autoTags: updatedAnnotation.autoTags, metadataTags: updatedAnnotation.metadataTags } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist and refresh tags
            try {
                await saveAnnotation(updatedAnnotation);
                await get().refreshAvailableTags();
            } catch (error) {
                console.error('Failed to save annotation:', error);
            }
        },

        bulkAddTag: async (imageIds, tag) => {
            const normalizedTag = tag.trim().toLowerCase();
            if (!normalizedTag || imageIds.length === 0) return;

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                const allExisting = [
                    ...(current?.tags ?? []),
                    ...(current?.autoTags ?? []),
                    ...(current?.metadataTags ?? []),
                ];
                if (allExisting.includes(normalizedTag)) {
                    continue; // Skip if already tagged in any source
                }

                updatedAnnotations.push({
                    imageId,
                    isFavorite: current?.isFavorite ?? false,
                    tags: [...(current?.tags ?? []), normalizedTag],
                    autoTags: current?.autoTags ?? [],
                    isAutoTagged: current?.isAutoTagged ?? false,
                    metadataTags: current?.metadataTags ?? [],
                    addedAt: current?.addedAt ?? Date.now(),
                    updatedAt: Date.now(),
                });
            }

            let nextRecentTags = get().recentTags;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        const mergedTags = mergeAnnotationTags(annotation);
                        return { ...img, tags: mergedTags, autoTags: annotation.autoTags, metadataTags: annotation.metadataTags };
                    }
                    return img;
                });

                nextRecentTags = updateRecentTags(state.recentTags, normalizedTag);
                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            // Persist and refresh tags
            try {
                await bulkSaveAnnotations(updatedAnnotations);
                await get().refreshAvailableTags();
            } catch (error) {
                console.error('Failed to bulk save annotations:', error);
            }
        },

        bulkRemoveTag: async (imageIds, tag) => {
            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                if (!current) continue;

                const inManual = current.tags.includes(tag);
                const inAuto = (current.autoTags || []).includes(tag);
                const inMetadata = (current.metadataTags || []).includes(tag);
                if (!inManual && !inAuto && !inMetadata) continue;

                updatedAnnotations.push({
                    ...current,
                    tags: inManual ? current.tags.filter(t => t !== tag) : current.tags,
                    autoTags: inAuto ? (current.autoTags || []).filter(t => t !== tag) : (current.autoTags || []),
                    metadataTags: inMetadata ? (current.metadataTags || []).filter(t => t !== tag) : (current.metadataTags || []),
                    updatedAt: Date.now(),
                });
            }

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        const mergedTags = mergeAnnotationTags(annotation);
                        return { ...img, tags: mergedTags, autoTags: annotation.autoTags, metadataTags: annotation.metadataTags };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist and refresh tags
            try {
                await bulkSaveAnnotations(updatedAnnotations);
                await get().refreshAvailableTags();
            } catch (error) {
                console.error('Failed to bulk save annotations:', error);
            }
        },

        setSelectedTags: (tags) => set(state => {
            const newState = { ...state, selectedTags: tags };
            return { ...newState, ...filterAndSort(newState) };
        }),

        setShowFavoritesOnly: (show) => set(state => {
            const newState = { ...state, showFavoritesOnly: show };
            return { ...newState, ...filterAndSort(newState) };
        }),

        getImageAnnotations: (imageId) => {
            return get().annotations.get(imageId) || null;
        },

        refreshAvailableTags: async () => {
            // Now handled automatically by filterAndSort
            // We just need to trigger a recompute if somehow the tags changed but no other state did
            set(state => ({ ...filterAndSort(state) }));
        },

        importMetadataTags: async (images) => {
            if (!images || images.length === 0) return;

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            // Collect all tags to import from metadata
            for (const image of images) {
                const rawTags = image.metadata?.normalizedMetadata?.tags;
                if (!rawTags || rawTags.length === 0) continue;

                const currentAnnotation = annotations.get(image.id);
                const existingMetadataTags = currentAnnotation?.metadataTags ?? [];
                const allExisting = [
                    ...(currentAnnotation?.tags ?? []),
                    ...(currentAnnotation?.autoTags ?? []),
                    ...existingMetadataTags,
                ];

                // Normalize and filter out duplicates across all sources
                const newTags = rawTags
                    .map((tag: string) => tag.trim().toLowerCase())
                    .filter((tag: string) => tag && !allExisting.includes(tag));

                if (newTags.length === 0) continue;

                const updatedAnnotation: ImageAnnotations = {
                    imageId: image.id,
                    isFavorite: currentAnnotation?.isFavorite ?? false,
                    tags: currentAnnotation?.tags ?? [],
                    autoTags: currentAnnotation?.autoTags ?? [],
                    isAutoTagged: currentAnnotation?.isAutoTagged ?? false,
                    metadataTags: [...existingMetadataTags, ...newTags],
                    addedAt: currentAnnotation?.addedAt ?? Date.now(),
                    updatedAt: Date.now(),
                };

                updatedAnnotations.push(updatedAnnotation);
            }

            if (updatedAnnotations.length === 0) return;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation) {
                        const mergedTags = mergeAnnotationTags(annotation);
                        return { ...img, tags: mergedTags, autoTags: annotation.autoTags, metadataTags: annotation.metadataTags };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist annotations
            bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to import metadata tags:', error);
            });

            // Refresh available tags
            get().refreshAvailableTags();
        },

        clearAutoTags: async () => {
            const { annotations, directories } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const [, annotation] of annotations) {
                const autoTags = annotation.autoTags || [];
                if (autoTags.length > 0 || annotation.isAutoTagged) {
                    updatedAnnotations.push({
                        imageId: annotation.imageId,
                        isFavorite: annotation.isFavorite,
                        tags: annotation.tags || [],
                        autoTags: [],
                        isAutoTagged: false,
                        metadataTags: annotation.metadataTags || [],
                        addedAt: annotation.addedAt,
                        updatedAt: Date.now(),
                    });
                }
            }

            if (updatedAnnotations.length === 0) {
                // No auto-tags in annotations, but there may still be stale cache
                // files on disk. Fall through to invalidate caches.
            } else {
                // Persist to IndexedDB
                try {
                    await bulkSaveAnnotations(updatedAnnotations);
                } catch (error) {
                    console.error('Failed to clear auto-tags:', error);
                }

                // Update in-memory state — only replace what changed
                set(state => {
                    const newAnnotations = new Map(state.annotations);
                    for (const annotation of updatedAnnotations) {
                        newAnnotations.set(annotation.imageId, annotation);
                    }

                    const changedIds = new Set(updatedAnnotations.map(a => a.imageId));
                    const updatedImages = state.images.map(img => {
                        if (!changedIds.has(img.id)) return img;
                        const annotation = newAnnotations.get(img.id);
                        if (!annotation) return img;
                        const mergedTags = mergeAnnotationTags(annotation);
                        return {
                            ...img,
                            tags: mergedTags,
                            autoTags: [],
                            metadataTags: annotation.metadataTags,
                            isAutoTagged: false,
                        };
                    });

                    return {
                        annotations: newAnnotations,
                        images: updatedImages,
                    };
                });

                // Re-run filter/sort to refresh availableTags etc.
                set(state => filterAndSort(state));

                console.log(`Cleared auto-tags from ${updatedAnnotations.length} images`);
            }

            // Invalidate on-disk auto-tag cache for all directories so
            // restoreSmartLibraryCache doesn't re-apply stale auto-tags.
            try {
                const { invalidateAutoTagCache } = await import('../services/clusterCacheManager');
                for (const dir of directories) {
                    // Invalidate both scanSubfolders variants — the cache key
                    // includes this flag, and a user may have changed the setting
                    // since the cache was written.
                    await invalidateAutoTagCache(dir.path, false, 'user_cleared');
                    await invalidateAutoTagCache(dir.path, true, 'user_cleared');
                }
            } catch (error) {
                console.error('Failed to invalidate auto-tag cache files:', error);
            }
        },

        flushPendingImages: () => {
            flushPendingImages();
        },

        setDirectoryRefreshing: (directoryId, isRefreshing) => {
            set(state => {
                const next = new Set(state.refreshingDirectories);
                if (isRefreshing) {
                    next.add(directoryId);
                } else {
                    next.delete(directoryId);
                }
                return { refreshingDirectories: next };
            });
        },

        toggleImageSelection: (imageId) => {
            set(state => {
                const newSelection = new Set(state.selectedImages);
                if (newSelection.has(imageId)) {
                    newSelection.delete(imageId);
                } else {
                    newSelection.add(imageId);
                }
                return { selectedImages: newSelection };
            });
        },

        selectAllImages: () => set(state => {
            const allImageIds = new Set(state.filteredImages.map(img => img.id));
            return { selectedImages: allImageIds };
        }),

        clearImageSelection: () => set({ selectedImages: new Set() }),

        deleteSelectedImages: async () => {
            get().clearImageSelection();
        },

        setScanSubfolders: (scan) => {
            localStorage.setItem('image-metahub-scan-subfolders', String(scan));
            set({ scanSubfolders: scan });
        },

        handleNavigateNext: () => {
            const state = get();
            if (!state.selectedImage) return;

            // Use cluster context if available, otherwise use filtered images
            const imagesToNavigate = state.clusterNavigationContext || state.filteredImages;
            const currentIndex = imagesToNavigate.findIndex(img => img.id === state.selectedImage!.id);

            if (currentIndex < imagesToNavigate.length - 1) {
                const nextImage = imagesToNavigate[currentIndex + 1];
                set({ selectedImage: nextImage });
            }
        },

        handleNavigatePrevious: () => {
            const state = get();
            if (!state.selectedImage) return;

            // Use cluster context if available, otherwise use filtered images
            const imagesToNavigate = state.clusterNavigationContext || state.filteredImages;
            const currentIndex = imagesToNavigate.findIndex(img => img.id === state.selectedImage!.id);

            if (currentIndex > 0) {
                const prevImage = imagesToNavigate[currentIndex - 1];
                set({ selectedImage: prevImage });
            }
        },

        // Drag and Drop (Internal)
        setDraggedItems: (items) => set({ draggedItems: items }),
        clearDraggedItems: () => set({ draggedItems: [] }),

        folderScrollPositions: {},
        setFolderScrollPosition: (key, position) => set(state => ({
            folderScrollPositions: { ...state.folderScrollPositions, [key]: position }
        })),

        setActiveView: (view) => set({ activeView: view }),

        resetState: () => set({
            images: [],
            filteredImages: [],
            selectionTotalImages: 0,
            selectionDirectoryCount: 0,
            directories: [],
            selectedFolders: new Set(),
            isFolderSelectionLoaded: false,
            isLoading: false,
            progress: { current: 0, total: 0 },
            enrichmentProgress: null,
            error: null,
            success: null,
            selectedImage: null,
            selectedImages: new Set(),
            searchQuery: '',
            availableModels: [],
            availableLoras: [],
            availableSchedulers: [],
            availableDimensions: [],
            availableAspectRatios: [],
            selectedModels: [],
            selectedLoras: [],
            selectedSchedulers: [],
            advancedFilters: {},
            indexingState: 'idle',
            previewImage: null,
            focusedImageIndex: null,
            scanSubfolders: true,
            libraryStackContext: null,
            sortOrder: useSettingsStore.getState().sortOrder || 'date-desc',
            isFullscreenMode: false,
            annotations: new Map(),
            availableTags: [],
            selectionFavoriteCount: 0,
            recentTags: loadRecentTags(),
            selectedTags: [],
            showFavoritesOnly: false,
            isAnnotationsLoaded: false,
            activeWatchers: new Set(),
            refreshingDirectories: new Set(),
            clusters: [],
            clusteringProgress: null,
            clusteringWorker: null,
            isClustering: false,
            clusterNavigationContext: null,

            autoTaggingWorker: null,
            isAutoTagging: false,
            draggedItems: [],
            clearAllThumbnails: () => {},
        }),

        cleanupInvalidImages: () => {
            const state = get();
            const isElectron = typeof window !== 'undefined' && window.electronAPI;
            
            const validImages = state.images.filter(image => {
                const fileHandle = image.thumbnailHandle || image.handle;
                return isElectron || (fileHandle && typeof fileHandle.getFile === 'function');
            });
            
            if (validImages.length !== state.images.length) {
                set(state => ({
                    ...state,
                    images: validImages,
                    ...filterAndSort({ ...state, images: validImages })
                }));

            }
        },

        setStackingEnabled: (enabled: boolean) => {
            set({ isStackingEnabled: enabled });
            // Persist to settings
            useSettingsStore.getState().setStackingEnabled(enabled);
        },

        setLibraryStackContext: (context: LibraryStackContext | null) => {
            set(state => ({ ...filterAndSort({ ...state, libraryStackContext: context }), libraryStackContext: context }));
        },

        syncNewImagesToStacks: async () => {
            const state = get();
            const { images, annotations } = state;

            // Prevent concurrent runs
            if ((state as any).__syncInProgress) return;
            (state as any).__syncInProgress = true;

            try {
                const { normalizePrompt, generatePromptHash } = await import('../utils/similarityMetrics');
                const { bulkSaveAnnotations } = await import('../services/imageAnnotationsStorage');

                const now = Date.now();
                const updatedAnnotations: ImageAnnotations[] = [];
                const newAnnotations = new Map(annotations);

                for (const image of images) {
                    const existing = annotations.get(image.id);

                    // Skip already-analyzed images (same pattern as isAutoTagged)
                    if (existing?.isStackAnalyzed) continue;

                    const prompt = image.prompt
                        || image.metadata?.normalizedMetadata?.prompt
                        || image.metadata?.positive_prompt;

                    const stackGroupId = prompt && prompt.trim()
                        ? generatePromptHash(prompt)
                        : undefined;

                    const updated: ImageAnnotations = {
                        imageId: image.id,
                        isFavorite: existing?.isFavorite ?? false,
                        tags: existing?.tags ?? [],
                        autoTags: existing?.autoTags ?? [],
                        metadataTags: existing?.metadataTags ?? [],
                        isAutoTagged: existing?.isAutoTagged,
                        // New stack fields
                        stackGroupId,
                        isStackAnalyzed: true,
                        addedAt: existing?.addedAt ?? now,
                        updatedAt: now,
                    };

                    updatedAnnotations.push(updated);
                    newAnnotations.set(image.id, updated);
                }

                if (updatedAnnotations.length > 0) {
                    // Persist to IndexedDB (same path as auto-tags)
                    await bulkSaveAnnotations(updatedAnnotations);

                    // Update in-memory state
                    const imagesWithAnnotations = applyAnnotationsToImages(images, newAnnotations);
                    const filteredResult = filterAndSort({ ...state, images: imagesWithAnnotations, annotations: newAnnotations });
                    const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);

                    set({
                        ...filteredResult,
                        ...availableFilters,
                        images: imagesWithAnnotations,
                        annotations: newAnnotations,
                    });

                    console.log(`Stack analysis complete: ${updatedAnnotations.length} images analyzed`);

                    // After assigning exact stackGroupIds, compute similarity groups
                    // so similar prompts are merged into the same similarity stack.
                    // This runs asynchronously to avoid blocking the UI.
                    if (updatedAnnotations.length > 0) {
                        get().computeSimilarityGroups();
                    }
                }
            } catch (error) {
                console.error('Failed to sync new images to stacks:', error);
            } finally {
                (state as any).__syncInProgress = false;
            }
        },

        handleStackImageDeletion: (deletedImageIds: string[]) => {
            const { annotations } = get();
            const deletedSet = new Set(deletedImageIds);

            // Build updated annotations: clear stackGroupId for deleted images
            const updatedList: ImageAnnotations[] = [];
            const newAnnotations = new Map(annotations);

            for (const [imageId, annotation] of annotations) {
                if (deletedSet.has(imageId) && (annotation.stackGroupId || annotation.isStackAnalyzed || annotation.similarityGroupId)) {
                    const updated = {
                        ...annotation,
                        stackGroupId: undefined,
                        isStackAnalyzed: false,
                        similarityGroupId: undefined,
                        updatedAt: Date.now(),
                    };
                    updatedList.push(updated);
                    newAnnotations.set(imageId, updated);
                }
            }

            if (updatedList.length > 0) {
                import('../services/imageAnnotationsStorage').then(({ bulkSaveAnnotations }) => {
                    bulkSaveAnnotations(updatedList);
                }).catch(() => {});

                const state = get();
                const imagesWithAnnotations = applyAnnotationsToImages(state.images, newAnnotations);
                const filteredResult = filterAndSort({ ...state, images: imagesWithAnnotations, annotations: newAnnotations });
                const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);

                set({
                    ...filteredResult,
                    ...availableFilters,
                    images: imagesWithAnnotations,
                    annotations: newAnnotations,
                });
            }
        },

        /**
         * Compute similarity-based groupings from existing exact-match stackGroupIds.
         *
         * Runs the same hybrid similarity algorithm used by Smart Library clusters
         * (token bucketing + Jaccard/Levenshtein + Union-Find) to merge similar
         * exact-match groups into larger similarity groups. Results are persisted
         * as similarityGroupId on each image's annotation in IndexedDB.
         *
         * Called after syncNewImagesToStacks assigns exact stackGroupIds.
         * Runs asynchronously — the UI shows exact-match stacks immediately,
         * then updates when similarity groups are ready.
         */
        computeSimilarityGroups: async () => {
            const state = get();
            const { images, annotations } = state;

            // Prevent concurrent runs
            if ((state as any).__similaritySyncInProgress) return;
            (state as any).__similaritySyncInProgress = true;

            try {
                const { hybridSimilarity, tokenizeForSimilarity, normalizePrompt, generatePromptHash } =
                    await import('../utils/similarityMetrics');
                const { bulkSaveAnnotations } = await import('../services/imageAnnotationsStorage');

                let currentAnnotations = new Map(annotations);

                // ── Step 0: Ensure all images have stackGroupId ──────────
                // Some images may have been indexed before the stackGroupId feature
                // was added. Compute and persist stackGroupId for any image missing it.
                const missingStackIds: ImageAnnotations[] = [];
                for (const img of images) {
                    const ann = currentAnnotations.get(img.id);
                    if (ann?.stackGroupId) continue; // Already has it

                    const prompt = img.prompt
                        || img.metadata?.normalizedMetadata?.prompt
                        || img.metadata?.positive_prompt;
                    const stackGroupId = prompt && prompt.trim()
                        ? generatePromptHash(normalizePrompt(prompt))
                        : undefined;

                    const updated: ImageAnnotations = {
                        imageId: img.id,
                        isFavorite: ann?.isFavorite ?? false,
                        tags: ann?.tags ?? [],
                        autoTags: ann?.autoTags ?? [],
                        metadataTags: ann?.metadataTags ?? [],
                        isAutoTagged: ann?.isAutoTagged,
                        stackGroupId,
                        isStackAnalyzed: true,
                        addedAt: ann?.addedAt ?? Date.now(),
                        updatedAt: Date.now(),
                    };
                    missingStackIds.push(updated);
                    currentAnnotations.set(img.id, updated);
                }

                if (missingStackIds.length > 0) {
                    console.log(`[SimilarityGroups] Assigned stackGroupId to ${missingStackIds.length} images that were missing it`);
                    await bulkSaveAnnotations(missingStackIds);
                }

                // ── Step 1: Collect unique stackGroupIds and their base prompts
                const groupMap = new Map<string, { prompt: string; tokens: Set<string> }>();
                console.log(`[SimilarityGroups] Scanning ${images.length} images for unique prompts...`);
                for (const img of images) {
                    const ann = currentAnnotations.get(img.id);
                    const sgId = ann?.stackGroupId;
                    if (!sgId || groupMap.has(sgId)) continue;

                    const prompt = img.prompt
                        || img.metadata?.normalizedMetadata?.prompt
                        || img.metadata?.positive_prompt;
                    if (prompt && prompt.trim()) {
                        const normalized = normalizePrompt(prompt);
                        groupMap.set(sgId, {
                            prompt: normalized,
                            tokens: tokenizeForSimilarity(normalized),
                        });
                    }
                }

                console.log(`[SimilarityGroups] Found ${groupMap.size} unique prompt groups`);

                if (groupMap.size <= 1) {
                    console.log('[SimilarityGroups] Only 0-1 unique prompts — skipping similarity merge');
                    // Single group or none — every image gets its stackGroupId as similarityGroupId
                    const now = Date.now();
                    const updatedAnnotations: ImageAnnotations[] = [];
                    const newAnnotations = new Map(currentAnnotations);

                    for (const [imageId, annotation] of currentAnnotations) {
                        if (annotation.stackGroupId && annotation.similarityGroupId !== annotation.stackGroupId) {
                            const updated = { ...annotation, similarityGroupId: annotation.stackGroupId, updatedAt: now };
                            updatedAnnotations.push(updated);
                            newAnnotations.set(imageId, updated);
                        }
                    }

                    if (updatedAnnotations.length > 0) {
                        await bulkSaveAnnotations(updatedAnnotations);
                        const imagesWithAnnotations = applyAnnotationsToImages(images, newAnnotations);
                        const filteredResult = filterAndSort({ ...state, images: imagesWithAnnotations, annotations: newAnnotations });
                        const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);
                        set({ ...filteredResult, ...availableFilters, images: imagesWithAnnotations, annotations: newAnnotations });
                    }
                    return;
                }

                // Build entries for similarity comparison
                const entries = Array.from(groupMap.entries()).map(([groupId, info]) => ({
                    groupId,
                    ...info,
                }));

                // ── Phase 1: Token bucketing ──────────────────────────
                // Require only 1 shared keyword — prevents missing comparisons
                // for prompts that share a subject but differ in other details.
                const MIN_SHARED = 1;
                const buckets: number[][] = [];
                for (let i = 0; i < entries.length; i++) {
                    let added = false;
                    for (const bucket of buckets) {
                        const sharesWithBucket = bucket.some(j => {
                            let shared = 0;
                            for (const token of entries[i].tokens) {
                                if (entries[j].tokens.has(token) && ++shared >= MIN_SHARED) return true;
                            }
                            return false;
                        });
                        if (sharesWithBucket) { bucket.push(i); added = true; break; }
                    }
                    if (!added) buckets.push([i]);
                }

                const totalPairs = buckets.reduce((sum, b) => sum + (b.length * (b.length - 1)) / 2, 0);
                console.log(`[SimilarityGroups] ${buckets.length} buckets, ${totalPairs} pairwise comparisons`);

                // ── Phase 2: Union-Find similarity clustering ─────────
                // Use a much lower threshold (0.40) than Smart Library (0.88).
                // Library stacks show sub-group labels for each distinct prompt,
                // so false positives are visible and self-correcting. This catches
                // variations like "cat sitting" vs "cat sleeping" (~0.40 hybrid).
                const THRESHOLD = 0.40;
                const parent = Array.from({ length: entries.length }, (_, i) => i);
                const rank = new Array(entries.length).fill(0);
                const find = (x: number): number => {
                    if (parent[x] !== x) parent[x] = find(parent[x]);
                    return parent[x];
                };
                const union = (x: number, y: number) => {
                    const rx = find(x), ry = find(y);
                    if (rx === ry) return;
                    if (rank[rx] < rank[ry]) parent[rx] = ry;
                    else if (rank[rx] > rank[ry]) parent[ry] = rx;
                    else { parent[ry] = rx; rank[rx]++; }
                };

                for (const bucket of buckets) {
                    for (let a = 0; a < bucket.length; a++) {
                        for (let b = a + 1; b < bucket.length; b++) {
                            const i = bucket[a], j = bucket[b];
                            if (find(i) === find(j)) continue;
                            const score = hybridSimilarity(entries[i].prompt, entries[j].prompt);
                            if (score >= THRESHOLD) union(i, j);
                        }
                    }
                }

                // ── Phase 3: Assign similarityGroupIds ────────────────
                // Each Union-Find root gets the groupId of its first entry
                const rootToSimId = new Map<number, string>();
                for (let i = 0; i < entries.length; i++) {
                    const root = find(i);
                    if (!rootToSimId.has(root)) {
                        rootToSimId.set(root, entries[i].groupId);
                    }
                }

                const groupIdToSimId = new Map<string, string>();
                for (let i = 0; i < entries.length; i++) {
                    groupIdToSimId.set(entries[i].groupId, rootToSimId.get(find(i))!);
                }

                // ── Phase 4: Persist ─────────────────────────────────
                const now = Date.now();
                const updatedAnnotations: ImageAnnotations[] = [];
                const newAnnotations = new Map(currentAnnotations);

                for (const [imageId, annotation] of currentAnnotations) {
                    const sgId = annotation.stackGroupId;
                    const simId = sgId ? groupIdToSimId.get(sgId) : undefined;
                    const targetId = simId || sgId;

                    if (annotation.similarityGroupId !== targetId) {
                        const updated = { ...annotation, similarityGroupId: targetId, updatedAt: now };
                        updatedAnnotations.push(updated);
                        newAnnotations.set(imageId, updated);
                    }
                }

                if (updatedAnnotations.length > 0) {
                    await bulkSaveAnnotations(updatedAnnotations);

                    const imagesWithAnnotations = applyAnnotationsToImages(images, newAnnotations);
                    const filteredResult = filterAndSort({ ...state, images: imagesWithAnnotations, annotations: newAnnotations });
                    const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);

                    set({
                        ...filteredResult,
                        ...availableFilters,
                        images: imagesWithAnnotations,
                        annotations: newAnnotations,
                    });

                    console.log(`Similarity groups computed: ${groupMap.size} prompts → ${rootToSimId.size} similarity groups (${updatedAnnotations.length} annotations updated)`);
                }
            } catch (error) {
                console.error('Failed to compute similarity groups:', error);
            } finally {
                (state as any).__similaritySyncInProgress = false;
            }
        },
    };
});

// Sync sort order from settings changes (e.g. rehydration or settings UI)
useSettingsStore.subscribe((state) => {
    const currentSortOrder = useImageStore.getState().sortOrder;
    if (state.sortOrder && state.sortOrder !== currentSortOrder) {
        useImageStore.getState().setSortOrder(state.sortOrder);
    }
});

// Sync stacking enabled from settings changes (e.g. rehydration on app restart)
let prevStackingEnabled: boolean | undefined = undefined;
useSettingsStore.subscribe((state) => {
    if (typeof state.isStackingEnabled === 'boolean' && state.isStackingEnabled !== prevStackingEnabled) {
        prevStackingEnabled = state.isStackingEnabled;
        const imageState = useImageStore.getState();
        if (state.isStackingEnabled !== imageState.isStackingEnabled) {
            imageState.setStackingEnabled(state.isStackingEnabled);
        }
    }
});

