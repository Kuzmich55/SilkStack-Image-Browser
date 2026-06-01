# Image Stacking in SilkStack

SilkStack provides two complementary systems for grouping similar images: **Library Stacks** (instant, exact-match) and **Smart Library Clusters** (AI-powered, similarity-based). This document covers their architecture, behavior, and extension points.

---

## Table of Contents

- [Overview](#overview)
- [Library Stacks](#library-stacks)
  - [Grouping Algorithm](#grouping-algorithm)
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
  - [Persistent Stacks](#persistent-stacks)

---

## Overview

| Feature | Library Stacks | Smart Library Clusters |
|---|---|---|
| **Where** | Main library grid | Smart Library view |
| **Grouping method** | Exact prompt match (hash) | 4-phase similarity algorithm |
| **Performance** | O(n) — `useMemo` per render | O(n²) within buckets — Web Worker |
| **Persistence** | None (computed each render) | Cached to disk via `clusterCacheManager` |
| **Drill-down** | In-grid via `LibraryStackContext` | Overlay via `StackExpandedView` |
| **Membership model** | Implicit (same normalized prompt) | Explicit (`imageIds: string[]`) |
| **Threshold** | Exact match only | Configurable (default 0.88) |
| **Minimum size** | 2 images | 3 images |

---

## Library Stacks

Library stacks are the default grouping behavior in the main grid. When stacking is enabled, images sharing the same **positive prompt** (normalized) are visually grouped into a stacked card with a `+N` badge.

### Grouping Algorithm

**File:** [`src/hooks/useImageStacking.ts`](../src/hooks/useImageStacking.ts)

```
images → normalize prompt → group by key → sort groups → output (images + stacks)
```

1. **Normalization** (line 23–29): Each image's positive prompt is lowercased, whitespace-collapsed, and trimmed. Negative prompts are ignored to prevent splits.
2. **Grouping** (line 40–53): A `Map<string, IndexedImage[]>` buckets images by normalized prompt key. Images without a prompt go into a separate `noPromptImages` array.
3. **Stack creation** (line 59–76): Groups with 2+ images become `ImageStack` objects. Singletons remain as bare `IndexedImage` entries.
4. **Sorting** (line 87–131): The combined list (stacks + singles) is sorted by the current sort order (`date-desc`, `name-asc`, etc.), with optional starred-first priority.

**Key types** ([`src/types.ts`](../src/types.ts)):
```typescript
interface ImageStack {
  id: string;              // "stack-" + coverImage.id
  coverImage: IndexedImage; // Most recent image
  images: IndexedImage[];   // All images in the stack, sorted by date desc
  count: number;            // Total images
}
```

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

**File:** [`src/types.ts`](../src/types.ts#L1136-L1142)

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

**File:** [`src/store/useImageStore.ts`](../src/store/useImageStore.ts), function `filterAndSort` (line ~737)

The filter pipeline applies these stages in order:

```
selectionFiltered → favorites → sensitive tags → ID-BASED OR TEXT SEARCH → models → loras → schedulers → advanced filters → sort
```

**ID-based filtering** (line ~834):
```typescript
if (libraryStackContext) {
    const contextImageIds = new Set(libraryStackContext.imageIds);
    results = results.filter(image => contextImageIds.has(image.id));
} else if (searchQuery) {
    // Normal text search (unchanged)
}
```

The `if/else if` structure means **ID-based filtering takes priority over text search.** When a stack is open, the grid shows exactly the images in `imageIds`. When the context is cleared, any active `searchQuery` resumes filtering normally.

The `isFilteringActive` helper also checks `libraryStackContext` so that filter-active UI indicators show correctly while in stack view.

### Scroll Position Preservation

When drilling into a stack and returning, the grid scroll position is saved and restored:

1. **On enter** ([`ImageGrid.tsx:1296`](../src/components/ImageGrid.tsx#L1296)): `mainLibraryScrollPositionRef.current` captures the grid's `scrollTop`
2. **On exit detection** ([`ImageGrid.tsx:623`](../src/components/ImageGrid.tsx#L623)): A `useLayoutEffect` watches for `libraryStackContext` transitioning from non-null → null and sets a pending restore flag
3. **On restore** ([`ImageGrid.tsx:630`](../src/components/ImageGrid.tsx#L630)): A second `useLayoutEffect` resets the virtualized list cache and scrolls to the saved position

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
- `normalizePrompt(text)` — whitespace collapse, lowercase, trim
- `generatePromptHash(text)` — deterministic hash for exact-match grouping
- `hybridSimilarity(a, b)` — Jaccard × 0.6 + Levenshtein × 0.4
- `tokenizeForSimilarity(text)` — splits into word tokens
- `extractKeywords(text, maxCount)` — top N keywords by frequency
- `shareKeywords(a, b, minShared)` — boolean check for bucketing
- `normalizedLevenshtein(a, b)` — edit distance normalized to [0,1]

**Persistence** ([`src/services/clusterCacheManager.ts`](../src/services/clusterCacheManager.ts)):
Clusters are cached to disk with atomic writes for crash safety. The cache is keyed by directory path + subfolder setting. On app start, `restoreSmartLibraryCache()` loads cached clusters while the user navigates.

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
| **Speed** | Instant (no computation) | 4-phase worker, ~30s for 35k images |
| **Grouping** | Exact normalized prompt | Similarity threshold 0.88 |
| **Drill-down mechanism** | `LibraryStackContext` in store | `expandedClusterId` local state |
| **Filtering** | ID-based Set lookup | Explicit image array prop |
| **Search bar** | Preserved | N/A (separate view) |
| **Scroll restore** | `useLayoutEffect` watching context | `setTimeout` 30ms + ref |
| **Navigation context** | Not supported | `clusterNavigationContext` for prev/next |
| **Manual editing** | Possible via `imageIds` mutation | Not yet supported |
| **Persistence** | None (recomputed) | Disk cache via `clusterCacheManager` |
| **Min group size** | 2 | 3 (configurable in `SmartLibrary.tsx`) |

---

## Key Files

| File | Role |
|---|---|
| [`src/types.ts`](../src/types.ts) | `ImageStack`, `LibraryStackContext`, `ImageCluster` interfaces |
| [`src/hooks/useImageStacking.ts`](../src/hooks/useImageStacking.ts) | Library stack grouping logic |
| [`src/store/useImageStore.ts`](../src/store/useImageStore.ts) | `libraryStackContext` state, `filterAndSort` pipeline, `setLibraryStackContext` action |
| [`src/components/ImageGrid.tsx`](../src/components/ImageGrid.tsx) | `handleStackClick`, scroll restore, stack card rendering |
| [`src/components/App.tsx`](../src/App.tsx) | "Back to all stacks" bar rendering |
| [`src/services/clusteringEngine.ts`](../src/services/clusteringEngine.ts) | 4-phase clustering algorithm |
| [`src/services/workers/clusteringWorker.ts`](../src/services/workers/clusteringWorker.ts) | Web Worker wrapper for clustering |
| [`src/services/clusterCacheManager.ts`](../src/services/clusterCacheManager.ts) | Disk persistence for clusters |
| [`src/utils/similarityMetrics.ts`](../src/utils/similarityMetrics.ts) | Jaccard, Levenshtein, tokenization utilities |
| [`src/components/SmartLibrary.tsx`](../src/components/SmartLibrary.tsx) | Smart Library view with cluster cards |
| [`src/components/StackExpandedView.tsx`](../src/components/StackExpandedView.tsx) | Cluster drill-down overlay |
| [`src/components/StackCard.tsx`](../src/components/StackCard.tsx) | Cluster card rendering in Smart Library |

---

## Future Extension Points

### Manual Image Addition to Stacks

The current `LibraryStackContext.imageIds` array is the membership list. To add an image:

```typescript
const ctx = useImageStore.getState().libraryStackContext;
if (ctx) {
  const updated = { ...ctx, imageIds: [...ctx.imageIds, newImageId] };
  setLibraryStackContext(updated);
}
```

This instantly updates the filtered grid. Future work:
- Drag-and-drop images onto stack cards
- Multi-select → "Add to Stack" context menu action
- Remove individual images from stack view

### Similarity-Based Stacking in Library

The library currently uses exact prompt matching ([`useImageStacking.ts`](../src/hooks/useImageStacking.ts)). To add similarity-based grouping:
- Integrate `hybridSimilarity` from [`similarityMetrics.ts`](../src/utils/similarityMetrics.ts) into the grouping hook
- Add a similarity threshold slider to the stacking toolbar
- Consider performance: Phase 1 (exact) + Phase 3 (similarity within buckets) from the clustering engine could be extracted into a lighter worker

### Persistent Stacks

Library stacks are ephemeral (recomputed each render). To persist them across sessions:
- Adopt the `clusterCacheManager` pattern for library stacks
- Store `{ promptHash, basePrompt, imageIds }` per stack in IndexedDB
- Reconcile on file deletion via `removeImagesFromClusters`-style cleanup
- This also enables user-defined stacks that survive folder refreshes

---

*Documentation last updated: 2026-06-01*
