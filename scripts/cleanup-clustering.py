"""Remove clustering references from the codebase."""
import re, sys

def fix_app_tsx():
    with open('src/App.tsx', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    for line in lines:
        # Skip lines importing/using removed cluster state
        if any(x in line for x in [
            'clustersCount',
            'clusterNavigationContext',
            'setClusterNavigationContext',
            'cancelClustering',
            'clusteringProgress',
            'restoreSmartLibraryCache',
            'onCancelClustering',
            'clusteringProgress={clusteringProgress}',
        ]):
            # But keep lines that also have other content
            if 'clusterNavigationContext' in line and '||' in line:
                # Replace clusterNavigationContext usage with filteredImages
                line = line.replace('state.clusterNavigationContext || ', '')
                line = line.replace(
                    'clusterNavigationContext && clusterNavigationContext.length > 0 ? clusterNavigationContext',
                    'state.filteredImages')
                line = line.replace(
                    'updatedState.clusterNavigationContext || updatedState.filteredImages',
                    'updatedState.filteredImages')
                new_lines.append(line)
            continue
        new_lines.append(line)

    with open('src/App.tsx', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print('Fixed App.tsx')

def fix_footer_tsx():
    with open('src/components/Footer.tsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove clusteringProgress, isClustering, onCancelClustering from interface
    content = re.sub(r'\s*clusteringProgress\?.*\n', '', content)
    content = re.sub(r'\s*isClustering\?.*\n', '', content)
    content = re.sub(r'\s*onCancelClustering\?.*\n', '', content)

    # Remove destructured props
    content = re.sub(r'\s*clusteringProgress,\n', '', content)
    content = re.sub(r'\s*isClustering = false,\n', '', content)
    content = re.sub(r'\s*onCancelClustering,\n', '', content)

    # Remove hasClusteringJob
    content = content.replace('const hasClusteringJob = clusteringProgress && clusteringProgress.total > 0;', '')
    content = content.replace(' || hasClusteringJob', '')

    # Remove clustering progress bar block
    content = re.sub(
        r'\s*\{hasClusteringJob && \(\s*\n.*?\{/\* Stacks Actions \*/\}',
        '\n              {/* Stacks Actions */}',
        content,
        flags=re.DOTALL
    )

    with open('src/components/Footer.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed Footer.tsx')

def fix_cache_manager():
    with open('src/services/cacheManager.ts', 'r', encoding='utf-8') as f:
        content = f.read()
    content = re.sub(r'\s*clusterId\?: string;\n', '', content)
    content = re.sub(r'\s*clusterPosition\?: number;\n', '', content)
    content = re.sub(r'\s*clusterId: img\.clusterId,\n', '', content)
    content = re.sub(r'\s*clusterPosition: img\.clusterPosition,\n', '', content)
    with open('src/services/cacheManager.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed cacheManager.ts')

def fix_file_indexer():
    with open('src/services/fileIndexer.ts', 'r', encoding='utf-8') as f:
        content = f.read()
    content = re.sub(r'\s*clusterId: image\.clusterId,\n', '', content)
    content = re.sub(r'\s*clusterPosition: image\.clusterPosition,\n', '', content)
    with open('src/services/fileIndexer.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed fileIndexer.ts')

def fix_image_annotations():
    with open('src/services/imageAnnotationsStorage.ts', 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace(', ClusterPreference', '')

    # Remove cluster preference functions
    lines = content.split('\n')
    new_lines = []
    skip = False
    for line in lines:
        if 'getClusterPreference' in line or 'saveClusterPreference' in line or \
           'deleteClusterPreference' in line or 'getAllClusterPreferences' in line:
            if 'export' in line:
                skip = True
                continue
        if skip:
            if line.strip().startswith('export') and 'ClusterPreference' not in line:
                skip = False
                new_lines.append(line)
            continue
        new_lines.append(line)

    content = '\n'.join(new_lines)
    with open('src/services/imageAnnotationsStorage.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed imageAnnotationsStorage.ts')

if __name__ == '__main__':
    fix_app_tsx()
    fix_footer_tsx()
    fix_cache_manager()
    fix_file_indexer()
    fix_image_annotations()
