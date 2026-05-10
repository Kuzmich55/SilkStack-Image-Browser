// Clear all manual tags only (keeps auto-tags, metadata-tags, and favorites)
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
    if (ann.tags && ann.tags.length > 0) {
      ann.tags = [];
      store.put(ann);
      count++;
    }
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  console.log(`Cleared manual tags from ${count} images. Reloading...`);
  location.reload();
})();