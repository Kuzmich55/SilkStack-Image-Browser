# Image Stacking in SilkStack

SilkStack provides two complementary systems for grouping similar images: **Library Stacks** (exact prompt match, per-image annotation persistence) and **Smart Library Clusters** (AI-powered similarity, separate file cache). This document covers their architecture, behavior, and extension points.

---

## Table of Contents

- [Overview](#overview)
- [Library Stacks](#library-stacks)
  - [Grouping Strategy (Two-Path)](#grouping-strategy-two-path)
  - [Per-Image Annotation Fields](#per-image-annotation-fields)
  - [Stack Analysis Flow](#stack-analysis-flow)
  - [Store Actions](#store-actions)
  - [Stack Drill-Down](#stack-drill-down)
  - [LibraryStackContext](#librarystackcontext)
  - [Filter Pipeline Integration](#filter-pipeline-integration)
  - [Scroll Position Preservation](#scroll-position-preservation)
- [Smart Library Clusters](#smart-library-clusters)
  - [Clustering Algorithm](#clustering-algorithm)
  - [Cluster Drill-Down](#cluster-drill-down)
- [Comparison](#comparison)
- [Key Files](#key-files)
- [Future Extension Points](#future-extension-points)
  - [Manual Image Addition to Stacks](#manual-image-addition-to-stacks)
  - [Similarity-Based Stacking in Library](#similarity-based-stacking-in-library)

---

## Overview

| Feature | Library Stacks | Smart Library Clusters |
|---|---|---|
| **Where** | Main library grid | Smart Library view |
| **Grouping method** | Exact prompt hash (FNV-1a) | 4-phase similarity algorithm |
| **Performance** | O(n) — `useMemo` per render | O(n²) within buckets — Web Worker |
| **Persistence** | IndexedDB per-image annotations | JSON file cache via `clusterCacheManager` |
| **Persistence pattern** | Same as auto-tags (`ImageAnnotations`) | Separate `{hash}-clusters.json` file |
| **Drill-down** | In-grid via `LibraryStackContext` | Overlay via `StackExpandedView` |
| **Membership model** | `stackGroupId` per image (prompt hash) | Explicit `imageIds: string[]` per cluster |
| **Threshold** | Exact match only | Configurable (default 0.88) |
| **Minimum size** | 2 images | 3 images |

---

## Library Stacks

Library stacks are the default grouping behavior in the main grid. When stacking is enabled, images with the same prompt hash are visually grouped into a stacked card with a `+N` badge.

Unlike the previous ephemeral design, stack membership now follows the **same per-image annotation pattern as auto-tags**: each image's `ImageAnnotations` record in IndexedDB stores a `stackGroupId` (prompt hash) and an `isStackAnalyzed` flag. This means stack data survives app restarts without a separate cache file.

### Grouping Strategy (Two-Path)

**File:** [`src/hooks/useImageStacking.ts`](../src/hooks/useImageStacking.ts)

The hook uses an automatic two-strategy approach:

```
images → any image have stackGroupId?
  ├─ YES → groupByStackAnnotation()  → group by img.stackGroupId (persisted, fast)
  └─ NO  → groupByExactPrompt()      → group by normalized prompt text (fallback)
                │
                ▼
            sortItems() → output (images + stacks)
```

**Path 1 — Annotation-based** (`groupByStackAnnotation`): Groups images by their `stackGroupId` field. This field is set by `syncNewImagesToStacks` and persisted in IndexedDB. Images sharing the same `stackGroupId` form a stack. Images without a `stackGroupId` appear as singletons.

**Path 2 — Exact prompt fallback** (`groupByExactPrompt`): Normalizes each image's positive prompt (lowercase, whitespace collapse, trim) and groups by normalized text. This is the original algorithm, now used only when no images have `stackGroupId` set (fresh install, or before first indexing cycle runs `syncNewImagesToStacks`).

Both paths produce the same grouping for exact prompt matches. The annotation path is preferred once available because:
- It avoids re-computing prompt hashes on every render
- Group membership is consistent across sessions
- Only new (unanalyzed) images are processed incrementally

### Per-Image Annotation Fields

**File:** [`src/types.ts`](../src/types.ts)

```typescript
// On ImageAnnotations (persisted in IndexedDB):
interface ImageAnnotations {
  // ... existing fields (isFavorite, tags, autoTags, isAutoTagged, metadataTags) ...
  stackGroupId?: string;    // Prompt hash — groups images with identical prompts
  isStackAnalyzed?: boolean; // Whether the image has been checked for stack membership
}

// Denormalized onto IndexedImage by applyAnnotationsToImages():
interface IndexedImage {
  // ... existing fields ...
  stackGroupId?: string;
  isStackAnalyzed?: boolean;
}
```

These fields follow the exact same pattern as `isAutoTagged` / `autoTags`:
- Stored in the `imageAnnotations` IndexedDB store (one record per `imageId`)
- Loaded on app start by `loadAnnotations()`
- Denormalized onto `IndexedImage` objects by `applyAnnotationsToImages()` in the store
- Written via `bulkSaveAnnotations()` for batch persistence

### Stack Analysis Flow

**Triggered by:** indexing completion, file watcher new-image events.

```
syncNewImagesToStacks()
  │
  ├─ 1. Iterate state.images, skip where annotations.isStackAnalyzed === true
  │
  ├─ 2. For each unanalyzed image:
  │     prompt = image.prompt || metadata.positive_prompt
  │     stackGroupId = generatePromptHash(normalizePrompt(prompt))
  │
  ├─ 3. Build ImageAnnotations[] with:
  │     { imageId, stackGroupId, isStackAnalyzed: true, ...existingFields }
  │
  ├─ 4. bulkSaveAnnotations(updatedAnnotations) → IndexedDB
  │
  └─ 5. Update in-memory annotations Map, re-apply to images, re-run filterAndSort
```

**Key design point:** `isStackAnalyzed` is set to `true` even for images without a prompt (their `stackGroupId` stays `undefined`). This prevents them from being re-checked on every indexing cycle — same as `isAutoTagged` prevents re-tagging.

**Deletion cleanup** (`handleStackImageDeletion`):
- Clears `stackGroupId` and sets `isStackAnalyzed: false` for deleted images
- Saved via `bulkSaveAnnotations`
- This means re-added files will be re-analyzed

### Store Actions

**File:** [`src/store/useImageStore.ts`](../src/store/useImageStore.ts)

| Action | Trigger | Behavior |
|---|---|---|
| `syncNewImagesToStacks()` | Indexing completes, file watcher (new files) | Finds unanalyzed images, assigns `stackGroupId`, persists via `bulkSaveAnnotations` |
| `handleStackImageDeletion(ids)` | File watcher (deleted files) | Clears `stackGroupId` + `isStackAnalyzed` from annotations, saves |

There is no separate `libraryStacks` array or `stackAnalyzedImageIds` Set in the store. Stack membership is derived from the `annotations` Map (same source as favorites, tags, and auto-tags).

### Stack Drill-Down

When a user clicks a stack in the library grid, the app drills down to show individual images. This is handled by `handleStackClick` in [`ImageGrid.tsx`](../src/components/ImageGrid.tsx).

**Flow:**

```
User clicks stack card
  │
  ├─ 1. Save scroll position (mainLibraryScrollPositionRef)
  ├─ 2. Build LibraryStackContext { stackId, imageIds, basePrompt }
  ├─ 3. setLibraryStackContext(context) → triggers filterAndSort
  └─ 4. setStackingEnabled(false) → grid shows raw images
```

The key design decision: **drill-down uses ID-based filtering, not text-based filtering.** This means:
- The search bar is NOT modified — any prior search is preserved
- Filtering is O(1) per image (Set lookup vs. text matching)
- Manual image addition is possible (push an ID into `imageIds`)

### LibraryStackContext

**File:** [`src/types.ts`](../src/types.ts)

```typescript
interface LibraryStackContext {
  stackId: string;       // Matches ImageStack.id
  imageIds: string[];    // Explicit membership — the source of truth for filtering
  basePrompt: string;    // Display text for the "Back to all stacks" bar
}
```

**Store integration** ([`src/store/useImageStore.ts`](../src/store/useImageStore.ts)):
- **State:** `libraryStackContext: LibraryStackContext | null` (initially `null`)
- **Setter:** `setLibraryStackContext(context)` — calls `filterAndSort` on every change
- **Clear on reset:** All store resets set `libraryStackContext: null`

**UI:**
- When `libraryStackContext` is non-null and `activeView === 'library'`, a bar appears above the grid with:
  - A "Back to all stacks" button
  - The stack's `basePrompt` displayed in monospace
- Clicking "Back" calls `setStackingEnabled(true)` and `setLibraryStackContext(null)`

### Filter Pipeline Integration

**File:** [`src/store/useImageStore.ts`](../src/store/useImageStore.ts), function `filterAndSort`

The filter pipeline applies these stages in order:

```
selectionFiltered → favorites → sensitive tags → ID-BASED OR TEXT SEARCH → models → loras → schedulers → advanced filters → sort
```

**ID-based filtering:**
```typescript
if (libraryStackContext) {
    const contextImageIds = new Set(libraryStackContext.imageIds);
    results = results.filter(image => contextImageIds.has(image.id));
} else if (searchQuery) {
    // Normal text search (unchanged)
}
```

The `if/else if` structure means **ID-based filtering takes priority over text search.** When a stack is open, the grid shows exactly the images in `imageIds`. When the context is cleared, any active `searchQuery` resumes filtering normally.

### Scroll Position Preservation

When drilling into a stack and returning, the grid scroll position is saved and restored:

1. **On enter** ([`ImageGrid.tsx`](../src/components/ImageGrid.tsx)): `mainLibraryScrollPositionRef.current` captures the grid's `scrollTop`
2. **On exit detection**: A `useLayoutEffect` watches for `libraryStackContext` transitioning from non-null → null and sets a pending restore flag
3. **On restore**: A second `useLayoutEffect` resets the virtualized list cache and scrolls to the saved position

---

## Smart Library Clusters

Smart Library clusters are AI-generated groups of semantically similar prompts, accessible via the Smart Library view.

### Clustering Algorithm

**File:** [`src/services/clusteringEngine.ts`](../src/services/clusteringEngine.ts)

The engine uses a **4-phase hybrid algorithm** designed to process 35k images in under 30 seconds. It runs in a Web Worker ([`src/services/workers/clusteringWorker.ts`](../src/services/workers/clusteringWorker.ts)) to avoid blocking the UI.

**Phase 1 — Exact Matching (O(n)):**
Images with identical normalized prompts are grouped by hash. This is the same logic as library stacks but uses `generatePromptHash()` for constant-time lookups.

**Phase 2 — Token Bucketing:**
Keywords are extracted from each cluster's base prompt. Clusters sharing ≥2 keywords are placed into the same bucket. This reduces the pairwise comparison space by ~90% — comparisons only happen within buckets, not across the entire dataset.

**Phase 3 — Similarity Clustering:**
Within each bucket, all cluster pairs are compared using a **hybrid similarity score:**
- **Jaccard similarity** (60% weight): Token overlap between prompt token sets
- **Normalized Levenshtein** (40% weight): Edit distance, catches typos and minor phrasing differences

Merging uses a **union-find** data structure for transitive closure (if A≈B and B≈C, then A,B,C are one cluster).

**Phase 4 — Refinement:**
Clusters are sorted chronologically, oversized clusters are logged (splitting logic is TODO), and the final `ImageCluster` objects are produced.

**Key types** ([`src/types.ts`](../src/types.ts)):
```typescript
interface ImageCluster {
  id: string;                  // Hash-based cluster ID
  promptHash: string;          // Hash of the base prompt
  basePrompt: string;          // Representative prompt text
  imageIds: string[];          // Array of image IDs in this cluster
  coverImageId: string;        // First image chronologically
  size: number;                // Number of images in cluster
  similarityThreshold: number; // Threshold used for clustering (0.85-0.90)
  createdAt: number;           // Timestamp of cluster creation
  updatedAt: number;           // Timestamp of last update
}
```

**Utilities** ([`src/utils/similarityMetrics.ts`](../src/utils/similarityMetrics.ts)):
- `normalizePrompt(text)` — whitespace collapse, lowercase, trim, strip LoRA tags and metadata
- `generatePromptHash(text)` — FNV-1a hash for exact-match grouping
- `hybridSimilarity(a, b)` — Jaccard × 0.6 + Levenshtein × 0.4
- `tokenizeForSimilarity(text)` — splits into word tokens
- `extractKeywords(text, maxCount)` — top N keywords by frequency
- `shareKeywords(a, b, minShared)` — boolean check for bucketing
- `normalizedLevenshtein(a, b)` — edit distance normalized to [0,1]

**Persistence** ([`src/services/clusterCacheManager.ts`](../src/services/clusterCacheManager.ts)):
Clusters are cached to disk as JSON files at `{userData}/smart-library-cache/{hash}-clusters.json` with atomic writes (temp file + rename) for crash safety. The cache is keyed by directory path + subfolder setting. On app start, `restoreSmartLibraryCache()` loads cached clusters.

**Incremental updates:**
- `addImageToClusters(image, existingClusters, threshold)` — classifies a new image into an existing cluster or creates a new one
- `removeImagesFromClusters(deletedIds, existingClusters)` — removes deleted images, drops empty clusters

### Cluster Drill-Down

Unlike library stacks, cluster drill-down uses **local component state** and an overlay pattern:

1. [`SmartLibrary.tsx`](../src/components/SmartLibrary.tsx) manages `expandedClusterId` (local `useState`)
2. When a `StackCard` is clicked, `handleOpenStack` saves scroll position and sets `expandedClusterId`
3. [`StackExpandedView`](../src/components/StackExpandedView.tsx) renders as an absolute-positioned overlay
4. It receives an explicit `images: IndexedImage[]` array (from mapping `cluster.imageIds` through the image map)
5. The view contains its own `ImageGrid` with `disableStacking` prop so no recursive stacking occurs
6. `clusterNavigationContext` is set before opening the image viewer, enabling prev/next navigation within the cluster
7. On "Back", scroll positions are restored via a 30ms `setTimeout` (lets DOM settle)

---

## Comparison

| Aspect | Library Stacks | Smart Library Clusters |
|---|---|---|
| **Trigger** | Toggle in grid toolbar | "Generate Clusters" button |
| **Speed** | Instant (annotation lookup or exact match) | 4-phase worker, ~30s for 35k images |
| **Grouping** | Exact prompt hash | Similarity threshold 0.88 |
| **Drill-down mechanism** | `LibraryStackContext` in store | `expandedClusterId` local state |
| **Filtering** | ID-based Set lookup | Explicit image array prop |
| **Search bar** | Preserved | N/A (separate view) |
| **Scroll restore** | `useLayoutEffect` watching context | `setTimeout` 30ms + ref |
| **Navigation context** | Not supported | `clusterNavigationContext` for prev/next |
| **Manual editing** | Possible via annotation mutation | Not yet supported |
| **Persistence** | IndexedDB per-image (`ImageAnnotations`) | JSON file cache (`clusterCacheManager`) |
| **Processing flag** | `isStackAnalyzed` per annotation | N/A (full re-run on each generation) |
| **Min group size** | 2 | 3 (configurable in `SmartLibrary.tsx`) |

---

## Key Files

| File | Role |
|---|---|
| [`src/types.ts`](../src/types.ts) | `ImageStack`, `LibraryStackContext`, `ImageCluster`, `ImageAnnotations` (with `stackGroupId`/`isStackAnalyzed`) |
| [`src/hooks/useImageStacking.ts`](../src/hooks/useImageStacking.ts) | Two-path grouping: annotation-based + exact prompt fallback, `sortItems` shared sort |
| [`src/store/useImageStore.ts`](../src/store/useImageStore.ts) | `libraryStackContext` state, `syncNewImagesToStacks`, `handleStackImageDeletion`, `applyAnnotationsToImages` (denormalizes `stackGroupId`), `filterAndSort` pipeline |
| [`src/components/ImageGrid.tsx`](../src/components/ImageGrid.tsx) | `handleStackClick`, scroll restore, stack card rendering |
| [`src/App.tsx`](../src/App.tsx) | "Back to all stacks" bar, indexing-completion trigger, file watcher triggers |
| [`src/services/imageAnnotationsStorage.ts`](../src/services/imageAnnotationsStorage.ts) | `bulkSaveAnnotations`, `loadAllAnnotations` — canonical persistence for stack fields |
| [`src/services/clusteringEngine.ts`](../src/services/clusteringEngine.ts) | 4-phase clustering algorithm, `addImageToClusters`, `removeImagesFromClusters` |
| [`src/services/workers/clusteringWorker.ts`](../src/services/workers/clusteringWorker.ts) | Web Worker wrapper for clustering |
| [`src/services/clusterCacheManager.ts`](../src/services/clusterCacheManager.ts) | Disk persistence for Smart Library clusters |
| [`src/utils/similarityMetrics.ts`](../src/utils/similarityMetrics.ts) | `normalizePrompt`, `generatePromptHash`, Jaccard, Levenshtein, tokenization |
| [`src/components/SmartLibrary.tsx`](../src/components/SmartLibrary.tsx) | Smart Library view with cluster cards |
| [`src/components/StackExpandedView.tsx`](../src/components/StackExpandedView.tsx) | Cluster drill-down overlay |
| [`src/components/StackCard.tsx`](../src/components/StackCard.tsx) | Cluster card rendering in Smart Library |

---

## Future Extension Points

### Manual Image Addition to Stacks

Stack membership is stored as `stackGroupId` on each image's annotation. To manually move an image to a different stack:

```typescript
const annotation = annotations.get(imageId);
if (annotation) {
  const updated = { ...annotation, stackGroupId: 'target-hash', updatedAt: Date.now() };
  await saveAnnotation(updated);
  // applyAnnotationsToImages will denormalize on next state update
}
```

Future work:
- Drag-and-drop images between stacks
- Multi-select → "Move to Stack" context menu action
- Remove individual images from a stack (clear `stackGroupId`)

### Similarity-Based Stacking in Library

The library currently uses exact prompt hash matching via `generatePromptHash`. The data model supports similarity: `stackGroupId` is just a string, and `getPromptKey` in the fallback path normalizes text. To add similarity grouping:
- Integrate `hybridSimilarity` from [`similarityMetrics.ts`](../src/utils/similarityMetrics.ts) into `syncNewImagesToStacks`
- Instead of exact hash match, check each new image against existing stack `basePrompt` values using the similarity threshold
- This would make library stacks use the same similarity logic as Smart Library clusters, but incrementally

---

*Documentation last updated: 2026-06-01*
