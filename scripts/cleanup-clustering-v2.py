"""
Remove clustering references from the codebase after deleting:
- src/services/clusteringEngine.ts
- src/services/workers/clusteringWorker.ts
- src/services/clusterCacheManager.ts
- src/components/StackExpandedView.tsx

Strategy: Read each file, remove lines containing clustering references,
preserving structural integrity by tracking brace depth.
"""
import re, os

def remove_cluster_refs(filepath, patterns_to_remove, whole_blocks=None):
    """Remove lines from a TypeScript file that match cluster patterns.
    For whole_blocks (functions/action blocks), removes from the start
    pattern through the matching closing brace."""

    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    if whole_blocks is None:
        whole_blocks = []

    # Find all block ranges to remove
    ranges_to_remove = set()

    for start_pattern in whole_blocks:
        start_idx = None
        for i, line in enumerate(lines):
            if start_pattern in line and 'interface' not in line:
                # Make sure it's an implementation/declaration, not just a comment
                if ':' in line or '=>' in line or 'function' in line or 'async' in line or '(' in line:
                    start_idx = i
                    break

        if start_idx is None:
            continue

        # Count braces to find the end of the block
        brace_depth = 0
        started = False
        end_idx = start_idx

        for i in range(start_idx, len(lines)):
            line = lines[i]

            # Skip comment-only lines for brace counting
            stripped = line.strip()
            if stripped.startswith('//'):
                continue

            # Count braces
            for ch in line:
                if ch == '{':
                    brace_depth += 1
                    started = True
                elif ch == '}':
                    brace_depth -= 1

            if started and brace_depth == 0:
                # Consume trailing comma if present
                if i + 1 < len(lines) and lines[i + 1].strip() == ',':
                    end_idx = i + 1
                else:
                    end_idx = i
                break

        # Add range (inclusive start, inclusive end)
        for j in range(start_idx, end_idx + 1):
            ranges_to_remove.add(j)

    # Also remove lines matching simple patterns
    for i, line in enumerate(lines):
        for pattern in patterns_to_remove:
            if pattern in line:
                # Don't remove if it's part of a larger declaration we already handled
                if i not in ranges_to_remove:
                    ranges_to_remove.add(i)

    # Build new lines, skipping removed ranges
    # But handle the case where removal leaves orphaned commas
    new_lines = []
    for i, line in enumerate(lines):
        if i in ranges_to_remove:
            continue
        new_lines.append(line)

    # Clean up: remove blank lines where blocks were removed (optional)
    result = ''.join(new_lines)

    # Remove double blank lines
    while '\n\n\n' in result:
        result = result.replace('\n\n\n', '\n\n')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(result)

    removed_count = len(ranges_to_remove)
    print(f'  {filepath}: removed {removed_count} lines')
    return removed_count

# ── File-by-file cleanup ──────────────────────────────────────────────

base = 'src'

# 1. useImageStore.ts
store_patterns = [
    'ImageCluster',
    'clusterNavigationContext',
    'restoreSmartLibraryCache',
    'setClusterNavigationContext',
    'handleClusterImageDeletion',
    'setClusters',
    'setClusteringProgress',
    'clusters:',
    'clusteringWorker',
    'isClustering:',
    'clusters: [],',
]
store_blocks = [
    'startClustering: async',
    'cancelClustering:',
    'restoreSmartLibraryCache: async',
]
remove_cluster_refs(
    os.path.join(base, 'store/useImageStore.ts'),
    store_patterns,
    store_blocks
)

# 2. App.tsx
app_patterns = [
    'clustersCount',
    'clusterNavigationContext',
    'setClusterNavigationContext',
    'cancelClustering',
    'clusteringProgress',
    'restoreSmartLibraryCache',
    'onCancelClustering',
    'clusteringProgress={clusteringProgress}',
]
remove_cluster_refs(
    os.path.join(base, 'App.tsx'),
    app_patterns
)

# 3. Footer.tsx
footer_patterns = [
    'clusteringProgress',
    'isClustering',
    'onCancelClustering',
    'onCluster',
    'hasClusteringJob',
    'Generate Clusters',
    'title="Generate Clusters"',
]
remove_cluster_refs(
    os.path.join(base, 'components/Footer.tsx'),
    footer_patterns
)

# 4. cacheManager.ts
with open(os.path.join(base, 'services/cacheManager.ts'), 'r', encoding='utf-8') as f:
    content = f.read()
content = re.sub(r'\s*clusterId\?: string;\s*\n', '\n', content)
content = re.sub(r'\s*clusterPosition\?: number;\s*\n', '\n', content)
content = re.sub(r'\s*clusterId:\s*img\.clusterId,\s*\n', '', content)
content = re.sub(r'\s*clusterPosition:\s*img\.clusterPosition,\s*\n', '', content)
with open(os.path.join(base, 'services/cacheManager.ts'), 'w', encoding='utf-8') as f:
    f.write(content)
print('  cacheManager.ts: removed cluster fields')

# 5. fileIndexer.ts
with open(os.path.join(base, 'services/fileIndexer.ts'), 'r', encoding='utf-8') as f:
    content = f.read()
content = re.sub(r'\s*clusterId:\s*image\.clusterId,\s*\n', '', content)
content = re.sub(r'\s*clusterPosition:\s*image\.clusterPosition,\s*\n', '', content)
with open(os.path.join(base, 'services/fileIndexer.ts'), 'w', encoding='utf-8') as f:
    f.write(content)
print('  fileIndexer.ts: removed cluster fields')

# 6. imageAnnotationsStorage.ts
with open(os.path.join(base, 'services/imageAnnotationsStorage.ts'), 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace(', ClusterPreference', '')
# Remove cluster preference functions
# Find the start of getClusterPreference and remove through getAllClusterPreferences
start_marker = '// ── Cluster Preferences ──'
end_marker = '// ── Smart Collections'
if start_marker in content and end_marker in content:
    before = content.split(start_marker)[0]
    after_parts = content.split(start_marker)[1].split(end_marker)
    if len(after_parts) > 1:
        content = before + '// ── Smart Collections' + after_parts[1]
with open(os.path.join(base, 'services/imageAnnotationsStorage.ts'), 'w', encoding='utf-8') as f:
    f.write(content)
print('  imageAnnotationsStorage.ts: removed ClusterPreference')

print('\nDone! Run npx tsc --noEmit to check for remaining errors.')
