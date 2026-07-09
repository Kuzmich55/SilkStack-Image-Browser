# Unified Post-Indexing Pipeline

## Overview

The **Unified Post-Indexing Pipeline** (`processPostIndexingPipeline`) is the single entry point for all automatic image processing that occurs after file indexing completes. It replaces the previous fragmented architecture where each processing phase independently scheduled the next via `setTimeout`, creating race conditions and permanently skipped work.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Image Lifecycle                     │
├──────────┬──────────┬──────────┬────────────────────┤
│ 1. Index │ 2. Enrich│ 3. Stack │ 4. Similarity      │
│ (Phase A)│ (Phase B)│ (Pipeline│ (Pipeline          │
│          │          │  Phase 1)│  Phase 2)           │
├──────────┼──────────┼──────────┼────────────────────┤
│ Catalog  │ Metadata │ Prompt   │ Semantic            │
│ stub     │ parsing  │ hashing  │ clustering          │
│          │          │          │                     │
│ File     │ file-    │ useImage │ useImage            │
│ Indexer  │ Indexer  │ Store    │ Store               │
└──────────┴──────────┴──────────┴────────────────────┘
                        │              │
                        └──────┬───────┘
                               │
                    processPostIndexingPipeline()
                    (Sequential — Phase 1 → Phase 2)
```

### What it replaces

| Old Pattern | New Pattern |
|-------------|-------------|
| `loadAnnotations()` scheduled `computeSimilarityGroups` via `setTimeout(300)` | Pipeline runs from unified startup check in App.tsx |
| `syncNewImagesToStacks()` scheduled `computeSimilarityGroups` via `setTimeout(200)` | Pipeline calls Phase 1 → Phase 2 sequentially |
| `indexingState` transition triggered `syncNewImagesToStacks` (one-shot — could skip) | Startup check waits for `isAnnotationsLoaded && indexingState === 'idle'` |
| File watcher called `syncNewImagesToStacks` directly (skipping similarity) | File watcher calls `processPostIndexingPipeline` (all phases) |

## Pipeline Phases

### Phase 1: Prompt Stacking (Exact-Match Hashing)

- **Function**: `syncNewImagesToStacks()`
- **State flag**: `isStackAnalyzed` (on `ImageAnnotations`)
- **Output**: `stackGroupId` — FNV-1a hash of the normalized prompt text
- **Footer**: Shows amber "Phase 1/2: Stacking…"

**What it does**:
1. Iterates all images in the store
2. Skips images where `isStackAnalyzed === true` (already processed)
3. For unprocessed images, generates a `stackGroupId` from the prompt text:
   - Extracts prompt from `image.prompt`, `metadata.normalizedMetadata.prompt`, or `metadata.positive_prompt`
   - Computes an FNV-1a hash via the StackingEngine
4. Persists `{ stackGroupId, isStackAnalyzed: true }` to IndexedDB via `bulkSaveAnnotations`
5. Updates in-memory store with new annotations

**Idempotency**: Safe to call multiple times — only unprocessed images are modified.

### Phase 2: Similarity Grouping (Semantic Clustering)

- **Function**: `computeSimilarityGroups()`
- **State flag**: `isSimilarityAnalyzed` (on `ImageAnnotations`)
- **Output**: `similarityGroupId` — shared ID grouping semantically similar prompts
- **Footer**: Shows amber "Phase 2/2: Similarity…"

**What it does**:
1. Ensures all images have `stackGroupId` (Step 0 — catch-up for images that bypassed Phase 1)
2. **Full mode** (first run): Delegates to StackingEngine for token-bucketed Union-Find clustering of all prompt groups
3. **Incremental mode** (subsequent runs): Compares only new `stackGroupId` entries against representatives from existing similarity groups
4. Persists `{ similarityGroupId, isSimilarityAnalyzed: true }` to IndexedDB
5. Updates in-memory store

**Similarity threshold**: 0.85 (configurable via StackingEngine)

**Idempotency**: Only processes images where `isSimilarityAnalyzed` is false or `similarityGroupId` is absent.

## When the Pipeline Runs

### 1. App Startup (primary trigger)

**Location**: [App.tsx:277-288](src/App.tsx)

```typescript
// Unified startup check — waits for BOTH conditions:
//   1. isAnnotationsLoaded === true (IndexedDB data available)
//   2. indexingState === 'idle' (file indexing complete or not needed)
// Fires ONCE per session via pipelineStartedRef.
useEffect(() => {
  if (isAnnotationsLoaded && indexingState === 'idle' && !pipelineStartedRef.current) {
    pipelineStartedRef.current = true;
    processPostIndexingPipeline();
  }
}, [isAnnotationsLoaded, indexingState, processPostIndexingPipeline]);
```

**Key property**: This check is **persistent** — it waits for both conditions to be true, regardless of which resolves first. Unlike the old one-shot `indexingState` transition, this cannot permanently skip processing.

### 2. File Watcher (new images detected while app is running)

**Location**: [useImageLoader.ts:638](src/hooks/useImageLoader.ts) and [useImageLoader.ts:1582](src/hooks/useImageLoader.ts)

```typescript
// After indexing new watched files completes:
useImageStore.getState().processPostIndexingPipeline();
```

### 3. Manual Reset (debug helper)

**Location**: [App.tsx:249](src/App.tsx)

```typescript
// Debug: window.resetStacking() — clears all stack data and re-runs pipeline
await useImageStore.getState().processPostIndexingPipeline();
```

## Concurrency Guards

The pipeline uses two layers of protection:

### Layer 1: Pipeline-level (`__pipelineInProgress` / `__pipelineQueued`)

```typescript
if (__pipelineInProgress) {
    __pipelineQueued = true;  // Will auto-retry after current run
    return;
}
__pipelineInProgress = true;
// ... phases execute ...
finally {
    __pipelineInProgress = false;
    if (__pipelineQueued) {
        __pipelineQueued = false;
        setTimeout(() => get().processPostIndexingPipeline(), 500);
    }
}
```

### Layer 2: Phase-level (individual guards)

- `__syncInProgress` — prevents concurrent stacking runs
- `__similaritySyncInProgress` / `__similaritySyncQueued` — prevents concurrent similarity runs

These are retained as safety nets for direct calls to individual phases (e.g., from tests or debug tools).

## Per-Image Processing State Flags

Each image's processing state is tracked by persistent flags in `ImageAnnotations` (stored in IndexedDB):

| Flag | Set by | Meaning |
|------|--------|---------|
| `enrichmentState` | `fileIndexer.ts` (Phase B) | `'catalog'` = stub only; `'enriched'` = metadata parsed |
| `isStackAnalyzed` | `syncNewImagesToStacks` (Pipeline Phase 1) | Exact-prompt hash has been computed |
| `stackGroupId` | `syncNewImagesToStacks` (Pipeline Phase 1) | FNV-1a hash of normalized prompt; groups identical prompts |
| `isSimilarityAnalyzed` | `computeSimilarityGroups` (Pipeline Phase 2) | Semantic similarity has been computed |
| `similarityGroupId` | `computeSimilarityGroups` (Pipeline Phase 2) | Shared ID for semantically similar prompts |
| `isAutoTagged` | `startAutoTagging` (user-initiated) | LLM auto-tagging has run |

### Flag lifecycle during manual operations

| Operation | `isStackAnalyzed` | `stackGroupId` | `isSimilarityAnalyzed` | `similarityGroupId` |
|-----------|-------------------|----------------|------------------------|---------------------|
| **Merge** (user merges stacks) | preserved | preserved | set to `true` | set to target group ID |
| **Unmerge** (user removes from stack) | preserved (`true`) | cleared (`undefined`) | cleared (`false`) | cleared (`undefined`) |
| **Delete** (image deleted) | cleared (`false`) | cleared (`undefined`) | cleared (`false`) | cleared (`undefined`) |
| **Undo** | restored from snapshot | restored from snapshot | restored from snapshot | restored from snapshot |

### Migration on startup

When annotations are loaded from IndexedDB, a migration step detects existing images with `similarityGroupId` but no `isSimilarityAnalyzed` flag (from prior app versions) and sets `isSimilarityAnalyzed: true` so they are not re-processed.

## State Diagram

```
Image added to library
        │
        ▼
┌──────────────────┐
│  Indexing        │  fileIndexer.ts Phase A
│  (Catalog stub)  │  enrichmentState: 'catalog'
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Enrichment      │  fileIndexer.ts Phase B
│  (Metadata parse)│  enrichmentState: 'enriched'
└────────┬─────────┘
         │
         ▼  (pipeline triggers: startup OR watcher)
┌──────────────────┐
│  Phase 1: Stack  │  processPostIndexingPipeline()
│  (Prompt hash)   │  → syncNewImagesToStacks()
│                  │  isStackAnalyzed: true
│                  │  stackGroupId: hash(prompt)
└────────┬─────────┘
         │
         ▼  (sequential — only after Phase 1 completes)
┌──────────────────┐
│  Phase 2: Sim    │  processPostIndexingPipeline()
│  (Clustering)    │  → computeSimilarityGroups()
│                  │  isSimilarityAnalyzed: true
│                  │  similarityGroupId: cluster ID
└────────┬─────────┘
         │
         ▼
    ┌─────────┐
    │  IDLE   │  pipelinePhase: null
    └─────────┘
```

## Adding a New Phase

To add a new automatic processing phase to the pipeline:

1. **Add state flags** to `ImageAnnotations` and `IndexedImage` in [types.ts](src/types.ts)
2. **Implement the phase function** in [useImageStore.ts](src/store/useImageStore.ts) (follow the `isXxxAnalyzed` pattern for idempotency)
3. **Add to the pipeline coordinator** in `processPostIndexingPipeline()`:
   ```typescript
   // Phase 3: Your new phase
   get().setPipelinePhase('your-phase-name');
   await get().yourNewPhaseFunction();
   ```
4. **Add the phase label** to the `pipelinePhase` type and Footer display
5. **Add migration logic** to `loadAnnotations()` for existing data

## Debugging

### Window helpers
- `window.resetStacking()` — Clears all stack/similarity data and re-runs the full pipeline
- Check console for `[Pipeline]` prefixed log messages

### Key console messages
- `[Pipeline] Annotations not yet loaded — deferring` — Pipeline called too early; will retry on next trigger
- `[Pipeline] Phase 1/2: Prompt stacking...` — Phase 1 started
- `[Pipeline] Phase 2/2: Similarity grouping...` — Phase 2 started
- `[Pipeline] All phases complete.` — Pipeline finished successfully
- `[Pipeline] Running queued pipeline invocation` — A follow-up run was queued (normal under high churn)

### Footer indicators
- **Amber "Phase 1/2: Stacking…"** — Exact-prompt hashing in progress
- **Amber "Phase 2/2: Similarity…"** — Semantic clustering in progress
- **Green "Files X/Y"** — File indexing (precedes pipeline)
- **Blue "X/Y"** — Metadata enrichment (precedes pipeline)
