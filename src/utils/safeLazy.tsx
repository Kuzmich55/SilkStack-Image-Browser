import React from 'react';

// ── Error Boundary ──────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class LazyErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[SafeLazy] Error boundary caught error in "${this.props.name}":`,
      error.message,
      '\nComponent stack:',
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '12px 16px',
            margin: '8px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            fontSize: '13px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <strong>[SafeLazy] Failed to load "{this.props.name}":</strong>
          {'\n'}
          {this.state.error.message}
          {'\n\n'}
          <span style={{ fontSize: '11px', opacity: 0.7 }}>
            Check the browser console for the full stack trace.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Safe lazy loader ────────────────────────────────────────────────────

/**
 * Creates a safely-lazy-loaded component with diagnostic logging and
 * an error boundary. Similar to React.lazy but:
 *
 * - Logs the module shape on success (for debugging)
 * - Catches import errors and logs them clearly
 * - Wraps in an error boundary with a user-visible error message
 *
 * @param loader  Dynamic import function
 * @param name    Human-readable component name for error messages
 * @param extract How to extract the component from the loaded module
 */
export function safeLazy<T extends React.ComponentType<any>>(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
  extract: (mod: Record<string, unknown>) => T,
): React.FC<React.ComponentProps<T>> {
  const LazyInner = React.lazy(() =>
    loader()
      .then((mod) => {
        const keys = Object.keys(mod);
        console.log(
          `[SafeLazy] ✓ "${name}" loaded successfully.`,
          'Module keys:',
          keys.join(', '),
        );
        const Component = extract(mod);
        if (!Component) {
          throw new Error(
            `[SafeLazy] "${name}" was loaded but the component was not found in the module.\n` +
              `Available exports: ${keys.join(', ')}\n` +
              `Export names are case-sensitive — check the barrel file in ai-intelligence/src/index.ts`,
          );
        }
        if (typeof Component !== 'function' && typeof Component !== 'object') {
          throw new Error(
            `[SafeLazy] "${name}" was found but is not a valid React component.\n` +
              `Type received: ${typeof Component}\n` +
              `Value: ${JSON.stringify(Component)}`,
          );
        }
        return { default: Component };
      })
      .catch((err) => {
        console.error(`[SafeLazy] ✗ "${name}" failed to load:`, err);
        throw err;
      }),
  );

  const SafeComponent: React.FC<React.ComponentProps<T>> = (props) => (
    <LazyErrorBoundary name={name}>
      <React.Suspense
        fallback={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                border: '2px solid #4b5563',
                borderTopColor: '#9ca3af',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite',
              }}
            />
          </div>
        }
      >
        <LazyInner {...(props as any)} />
      </React.Suspense>
    </LazyErrorBoundary>
  );

  SafeComponent.displayName = `SafeLazy(${name})`;
  return SafeComponent;
}
