import { useMemo } from 'react';
import { IndexedImage, ImageStack } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

interface UseImageStackingResult {
  stackedItems: (IndexedImage | ImageStack)[];
  isStackingEnabled: boolean;
}

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

    const normalizeText = (text: any): string => {
      if (typeof text !== 'string') return '';
      return text
        .toLowerCase()
        .replace(/[\s\r\n]+/g, ' ') // Normalize spaces, tabs, and newlines to a single space
        .trim();
    };

    const getPromptKey = (image: IndexedImage) => {
      // Group strictly by normalized positive prompt to avoid splits due to negative prompt differences
      return normalizeText(image.prompt || image.metadata?.normalizedMetadata?.prompt || image.metadata?.positive_prompt);
    };

    // Group images globally by prompt key
    const groups = new Map<string, IndexedImage[]>();
    const noPromptImages: IndexedImage[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const key = getPromptKey(img);

      if (key === '') {
        noPromptImages.push(img);
      } else {
        const group = groups.get(key);
        if (group) {
          group.push(img);
        } else {
          groups.set(key, [img]);
        }
      }
    }

    const result: (IndexedImage | ImageStack)[] = [];

    // Process groups into stacks or single images
    for (const groupImages of groups.values()) {
      // Sort images inside the stack by date descending (latest first)
      const sortedGroupImages = [...groupImages].sort(
        (a, b) => (b.lastModified || 0) - (a.lastModified || 0)
      );

      if (sortedGroupImages.length === 1) {
        result.push(sortedGroupImages[0]);
      } else {
        const coverImage = sortedGroupImages[0];
        result.push({
          id: `stack-${coverImage.id}`,
          coverImage,
          images: sortedGroupImages,
          count: sortedGroupImages.length,
        });
      }
    }

    // Add images without prompt
    result.push(...noPromptImages);

    // Helper to get representative image for sorting
    const getRepImage = (item: IndexedImage | ImageStack): IndexedImage => {
      return 'coverImage' in item ? item.coverImage : item;
    };

    // Sort the final list of items (single images and stacks)
    result.sort((a, b) => {
      const imgA = getRepImage(a);
      const imgB = getRepImage(b);

      const compareById = (x: IndexedImage, y: IndexedImage) => x.id.localeCompare(y.id);
      
      const compareByNameAsc = (x: IndexedImage, y: IndexedImage) => {
        const nameComparison = (x.name || '').localeCompare(y.name || '');
        if (nameComparison !== 0) return nameComparison;
        return compareById(x, y);
      };

      const compareByNameDesc = (x: IndexedImage, y: IndexedImage) => {
        const nameComparison = (y.name || '').localeCompare(x.name || '');
        if (nameComparison !== 0) return nameComparison;
        return compareById(x, y);
      };

      const compareByDateAsc = (x: IndexedImage, y: IndexedImage) => {
        const dateComparison = (x.lastModified || 0) - (y.lastModified || 0);
        if (dateComparison !== 0) return dateComparison;
        return compareByNameAsc(x, y);
      };

      const compareByDateDesc = (x: IndexedImage, y: IndexedImage) => {
        const dateComparison = (y.lastModified || 0) - (x.lastModified || 0);
        if (dateComparison !== 0) return dateComparison;
        return compareByNameAsc(x, y);
      };

      // Apply starred first logic if enabled, mirroring useImageStore's sort exactly
      if (displayStarredFirst) {
        const isFavA = imgA.isFavorite || false;
        const isFavB = imgB.isFavorite || false;
        if (isFavA && !isFavB) return -1;
        if (!isFavA && isFavB) return 1;
      }

      if (sortOrder === 'asc') return compareByNameAsc(imgA, imgB);
      if (sortOrder === 'desc') return compareByNameDesc(imgA, imgB);
      if (sortOrder === 'date-asc') return compareByDateAsc(imgA, imgB);
      
      // Default to date-desc (ordered by latest image date)
      return compareByDateDesc(imgA, imgB);
    });

    return result;
  }, [images, isEnabled, sortOrder, displayStarredFirst]);

  return {
    stackedItems,
    isStackingEnabled: isEnabled,
  };
};
