// Clear all stacking-related fields from image annotations.
// This resets stackGroupId, similarityGroupId, and isStackAnalyzed,
// forcing a full re-analysis on the next app launch.
//
// Usage:
//   In the DevTools console, simply type: resetStacking()
//   Or copy-paste this entire script into the console and press Enter
//   (standalone version reloads the page since it can't access the store).

(async () => {
  const openReq = indexedDB.open('image-metahub-preferences', 7);
  const db = await new Promise((resolve, reject) => {
    openReq.onsuccess = () => resolve(openReq.result);
    openReq.onerror = () => reject(openReq.error);
  });

  const tx = db.transaction('imageAnnotations', 'readwrite');
  const store = tx.objectStore('imageAnnotations');
  const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let count = 0;
  for (const ann of all) {
    if (ann.stackGroupId || ann.similarityGroupId || ann.isStackAnalyzed) {
      ann.stackGroupId = undefined;
      ann.similarityGroupId = undefined;
      ann.isStackAnalyzed = false;
      store.put(ann);
      count++;
    }
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();

  // Clear the similarity version so the next computation uses current threshold
  localStorage.removeItem('similarityGroupVersion');

  console.log(`%cCleared stacking tags from ${count} images.%c Reloading in 2s...`,
    'color: #4ade80; font-weight: bold', 'color: inherit');

  // Note: this standalone script requires a reload because it runs outside the
  // app's store context. Prefer clearStackingTags() in the console instead —
  // it reloads annotations in-place without refreshing the page.
  setTimeout(() => location.reload(), 2000);
})();
