import { useMemo } from 'react';
import { IndexedImage, ImageStack } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

interface UseImageStackingResult {
  stackedItems: (IndexedImage | ImageStack)[];
  isStackingEnabled: boolean;
}

// ── Sorting helpers ────────────────────────────────────────────────────

type StackItem = IndexedImage | ImageStack;

const getRepImage = (item: StackItem): IndexedImage =>
  'coverImage' in item ? item.coverImage : item;

const compareById = (x: IndexedImage, y: IndexedImage) => x.id.localeCompare(y.id);

const compareByNameAsc = (x: IndexedImage, y: IndexedImage) => {
  const c = (x.name || '').localeCompare(y.name || '');
  return c !== 0 ? c : compareById(x, y);
};

const sortItems = (
  items: StackItem[],
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random',
  displayStarredFirst: boolean
): StackItem[] => {
  return [...items].sort((a, b) => {
    const imgA = getRepImage(a);
    const imgB = getRepImage(b);

    if (displayStarredFirst) {
      const favA = imgA.isFavorite || false;
      const favB = imgB.isFavorite || false;
      if (favA && !favB) return -1;
      if (!favA && favB) return 1;
    }

    if (sortOrder === 'asc') return compareByNameAsc(imgA, imgB);
    if (sortOrder === 'desc') {
      const c = (imgB.name || '').localeCompare(imgA.name || '');
      return c !== 0 ? c : compareById(imgA, imgB);
    }
    if (sortOrder === 'date-asc') {
      const c = (imgA.lastModified || 0) - (imgB.lastModified || 0);
      return c !== 0 ? c : compareByNameAsc(imgA, imgB);
    }
    // Default: date-desc
    const c = (imgB.lastModified || 0) - (imgA.lastModified || 0);
    return c !== 0 ? c : compareByNameAsc(imgA, imgB);
  });
};

// ── Grouping strategies ────────────────────────────────────────────────

/**
 * Convert grouped images into a sorted list of ImageStacks and singletons.
 */
function buildResult(groups: Map<string, IndexedImage[]>, ungrouped: IndexedImage[]): StackItem[] {
  const result: StackItem[] = [];

  for (const groupImages of groups.values()) {
    const sorted = [...groupImages].sort(
      (a, b) => (b.lastModified || 0) - (a.lastModified || 0)
    );

    if (sorted.length === 1) {
      result.push(sorted[0]);
    } else {
      result.push({
        id: `stack-${sorted[0].id}`,
        coverImage: sorted[0],
        images: sorted,
        count: sorted.length,
      });
    }
  }

  result.push(...ungrouped);
  return result;
}

/**
 * Group by stackGroupId annotation (persisted, set by syncNewImagesToStacks).
 * Images without a stackGroupId appear as singletons.
 */
function groupByStackAnnotation(images: IndexedImage[]): StackItem[] {
  const groups = new Map<string, IndexedImage[]>();
  const ungrouped: IndexedImage[] = [];

  for (const img of images) {
    const key = img.stackGroupId;
    if (key) {
      const group = groups.get(key);
      if (group) {
        group.push(img);
      } else {
        groups.set(key, [img]);
      }
    } else {
      ungrouped.push(img);
    }
  }

  return buildResult(groups, ungrouped);
}

/**
 * Group by exact normalized prompt match (fallback when no annotations exist yet).
 */
function groupByExactPrompt(images: IndexedImage[]): StackItem[] {
  const normalizeText = (text: any): string => {
    if (typeof text !== 'string') return '';
    return text.toLowerCase().replace(/[\s\r\n]+/g, ' ').trim();
  };

  const getPromptKey = (image: IndexedImage) =>
    normalizeText(image.prompt || image.metadata?.normalizedMetadata?.prompt || image.metadata?.positive_prompt);

  const groups = new Map<string, IndexedImage[]>();
  const ungrouped: IndexedImage[] = [];

  for (const img of images) {
    const key = getPromptKey(img);
    if (key) {
      const group = groups.get(key);
      if (group) {
        group.push(img);
      } else {
        groups.set(key, [img]);
      }
    } else {
      ungrouped.push(img);
    }
  }

  return buildResult(groups, ungrouped);
}

// ── Hook ───────────────────────────────────────────────────────────────

export const useImageStacking = (
  images: IndexedImage[],
  isEnabled: boolean
): UseImageStackingResult => {
  const sortOrder = useImageStore((state) => state.sortOrder);
  const displayStarredFirst = useSettingsStore((state) => state.displayStarredFirst);

  const stackedItems = useMemo(() => {
    if (!isEnabled || images.length === 0) {
      return images;
    }

    // If any image has a stackGroupId (set by syncNewImagesToStacks), use the
    // persisted annotation-based grouping. Otherwise fall back to on-the-fly
    // exact prompt matching so stacking works before the first sync runs.
    const hasAnnotations = images.some(img => img.stackGroupId !== undefined);

    const items = hasAnnotations
      ? groupByStackAnnotation(images)
      : groupByExactPrompt(images);

    return sortItems(items, sortOrder, displayStarredFirst);
  }, [images, isEnabled, sortOrder, displayStarredFirst]);

  return {
    stackedItems,
    isStackingEnabled: isEnabled,
  };
};
