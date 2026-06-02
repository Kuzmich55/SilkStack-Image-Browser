import { useMemo } from 'react';
import { IndexedImage, ImageStack, StackSubGroup } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  hybridSimilarity,
  shareKeywords,
  tokenizeForSimilarity,
  generatePromptHash,
  normalizePrompt,
} from '../utils/similarityMetrics';

interface UseImageStackingResult {
  stackedItems: (IndexedImage | ImageStack)[];
  isStackingEnabled: boolean;
}

// ── Similarity threshold ───────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.85;
const MIN_SHARED_KEYWORDS = 2;

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

// ── Prompt resolution ──────────────────────────────────────────────────

/** Resolve the display prompt from an image, matching syncNewImagesToStacks. */
function resolvePrompt(image: IndexedImage): string {
  return image.prompt
    || image.metadata?.normalizedMetadata?.prompt
    || image.metadata?.positive_prompt
    || '';
}

/** Normalize a prompt for exact sub-group keying (lowercase, whitespace collapse only). */
function getExactPromptKey(prompt: string): string {
  if (!prompt) return '';
  return prompt.toLowerCase().replace(/[\s\r\n]+/g, ' ').trim();
}

// ── Union-Find for similarity merging ──────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // path compression
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    // Union by rank
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }
}

// ── Module-level similarity cache ──────────────────────────────────────
// Avoids recomputing similarity merges on every render.

let similarityCacheKey = '';
let similarityMergeCache: Map<string, StackSubGroup[]> | null = null;

function getCacheKey(groups: Map<string, IndexedImage[]>): string {
  return Array.from(groups.keys()).sort().join('|');
}

// ── Sub-group construction ─────────────────────────────────────────────

/** Build sub-groups within a set of images by exact prompt. */
function buildSubGroups(images: IndexedImage[]): StackSubGroup[] {
  const byPrompt = new Map<string, IndexedImage[]>();

  for (const img of images) {
    const promptKey = getExactPromptKey(resolvePrompt(img));
    if (promptKey) {
      const group = byPrompt.get(promptKey);
      if (group) {
        group.push(img);
      } else {
        byPrompt.set(promptKey, [img]);
      }
    } else {
      // Images without a prompt get placed in an empty-key group
      const group = byPrompt.get('');
      if (group) {
        group.push(img);
      } else {
        byPrompt.set('', [img]);
      }
    }
  }

  const subGroups: StackSubGroup[] = [];
  for (const [, sgImages] of byPrompt) {
    const sorted = [...sgImages].sort(
      (a, b) => (b.lastModified || 0) - (a.lastModified || 0)
    );
    const prompt = resolvePrompt(sorted[0]);
    subGroups.push({
      promptHash: generatePromptHash(prompt),
      prompt,
      imageIds: sorted.map(img => img.id),
      coverImageId: sorted[0].id,
      size: sorted.length,
    });
  }

  // Sort sub-groups by size (largest first), then alphabetically by prompt
  subGroups.sort((a, b) => b.size - a.size || a.prompt.localeCompare(b.prompt));
  return subGroups;
}

// ── Similarity merge ───────────────────────────────────────────────────

/**
 * Merge exact-match groups into similarity-based stacks using the same
 * hybrid algorithm as Smart Library clusters (token bucketing + Union-Find).
 *
 * Returns a Map from original groupId → subGroups for the merged stack.
 * Groups that aren't similar to any other get a single-element subGroups array.
 */
function computeSimilarityMerge(
  groups: Map<string, IndexedImage[]>
): Map<string, StackSubGroup[]> {
  const cacheKey = getCacheKey(groups);
  if (cacheKey === similarityCacheKey && similarityMergeCache) {
    return similarityMergeCache;
  }

  const entries = Array.from(groups.entries()).map(([groupId, images]) => {
    const prompt = resolvePrompt(images[0]);
    const normalized = normalizePrompt(prompt);
    return { groupId, prompt: normalized, tokens: tokenizeForSimilarity(normalized), images };
  });

  // Fast path: single group — no merging needed
  if (entries.length <= 1) {
    const result = new Map<string, StackSubGroup[]>();
    for (const entry of entries) {
      result.set(entry.groupId, buildSubGroups(entry.images));
    }
    similarityCacheKey = cacheKey;
    similarityMergeCache = result;
    return result;
  }

  // Phase 1: Token bucketing — group entries by shared keywords
  const buckets: number[][] = [];
  for (let i = 0; i < entries.length; i++) {
    let added = false;
    for (const bucket of buckets) {
      const sharesWithBucket = bucket.some(j =>
        shareKeywords(entries[i].prompt, entries[j].prompt, MIN_SHARED_KEYWORDS)
      );
      if (sharesWithBucket) {
        bucket.push(i);
        added = true;
        break;
      }
    }
    if (!added) {
      buckets.push([i]);
    }
  }

  // Phase 2: Similarity clustering within each bucket
  const uf = new UnionFind(entries.length);
  for (const bucket of buckets) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a];
        const j = bucket[b];
        if (uf.find(i) === uf.find(j)) continue; // already merged
        const score = hybridSimilarity(entries[i].prompt, entries[j].prompt);
        if (score >= SIMILARITY_THRESHOLD) {
          uf.union(i, j);
        }
      }
    }
  }

  // Phase 3: Build merged groups
  const merged = new Map<number, IndexedImage[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = uf.find(i);
    if (!merged.has(root)) merged.set(root, []);
    merged.get(root)!.push(...entries[i].images);
  }

  // Phase 4: Build sub-groups for each merged group
  const result = new Map<string, StackSubGroup[]>();
  for (const [, mergedImages] of merged) {
    const subGroups = buildSubGroups(mergedImages);
    // Map every original groupId that contributed to this merged group
    for (let i = 0; i < entries.length; i++) {
      if (uf.find(i) === uf.find(0)) {
        // This only maps the first merged group — need to fix
      }
    }
  }

  // Rebuild: for each original entry, find which merged group it belongs to
  // and assign the subGroups for that merged group
  const rootToSubGroups = new Map<number, StackSubGroup[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = uf.find(i);
    if (!rootToSubGroups.has(root)) {
      // Collect all images for this root
      const allImages: IndexedImage[] = [];
      for (let j = 0; j < entries.length; j++) {
        if (uf.find(j) === root) {
          allImages.push(...entries[j].images);
        }
      }
      rootToSubGroups.set(root, buildSubGroups(allImages));
    }
    result.set(entries[i].groupId, rootToSubGroups.get(root)!);
  }

  similarityCacheKey = cacheKey;
  similarityMergeCache = result;
  return result;
}

// ── Grouping strategies ────────────────────────────────────────────────

/**
 * Convert grouped images into a sorted list of ImageStacks and singletons,
 * with similarity merging to group similar prompts into stacks with subGroups.
 */
function buildStackResult(
  groups: Map<string, IndexedImage[]>,
  ungrouped: IndexedImage[]
): StackItem[] {
  const mergeMap = computeSimilarityMerge(groups);

  // Collect groups by their merged identity (first subGroup's promptHash acts as the merged ID)
  // We need to group original groups that share the same subGroups array reference
  const mergedGroups = new Map<string, { allImages: IndexedImage[]; subGroups: StackSubGroup[] }>();

  for (const [groupId, images] of groups) {
    const subGroups = mergeMap.get(groupId);
    if (!subGroups || subGroups.length === 0) continue;

    // Use the first subGroup's promptHash as the merged group identity
    const mergedId = subGroups[0].promptHash;

    if (!mergedGroups.has(mergedId)) {
      mergedGroups.set(mergedId, { allImages: [], subGroups });
    }

    mergedGroups.get(mergedId)!.allImages.push(...images);
  }

  const result: StackItem[] = [];

  for (const [, mg] of mergedGroups) {
    const sorted = [...mg.allImages].sort(
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
        subGroups: mg.subGroups,
        basePrompt: mg.subGroups[0]?.prompt || '',
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

  return buildStackResult(groups, ungrouped);
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

  return buildStackResult(groups, ungrouped);
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
