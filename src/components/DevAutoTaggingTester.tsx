import { useState, useRef, useCallback, useEffect } from 'react';
import { LLMTagGenerator, TAG_GENERATION_MODEL_ID } from '@ai-images-browser/ai-intelligence';

type LoadState = 'loading' | 'ready' | 'error';

const PRESETS = [
  { label: 'SD prompt', value: 'masterpiece, best quality, 1girl, solo, (cyberpunk city:1.2), neon lights, <lora:detailer:0.8>, 8k, high resolution' },
  { label: 'Dragon fantasy', value: 'a beautiful dragon flying over a medieval castle at sunset, fantasy art style, trending on ArtStation' },
  { label: 'Portrait', value: 'close-up portrait of an old fisherman with weathered skin, dramatic lighting, black and white, 85mm lens' },
  { label: 'Cozy cottage', value: 'a cozy cottage in a magical forest, soft ambient lighting, fairycore aesthetic' },
  { label: 'Lion', value: 'a majestic lion with a flowing mane, african savanna, golden hour, national geographic style' },
];

export default function DevAutoTaggingTester() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadText, setLoadText] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(PRESETS[0].value);
  const [tags, setTags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lastTime, setLastTime] = useState<number | null>(null);
  const [topN, setTopN] = useState(5);
  const [rawResponse, setRawResponse] = useState('');

  const llmRef = useRef<LLMTagGenerator | null>(null);

  // Initialize the LLM on mount
  useEffect(() => {
    const llm = new LLMTagGenerator(TAG_GENERATION_MODEL_ID, (report) => {
      setLoadProgress(Math.round(report.progress * 100));
      setLoadText(report.text);
    });
    llmRef.current = llm;

    llm.initialize()
      .then(() => {
        setLoadState('ready');
        setLoadText('Model ready');
      })
      .catch((err) => {
        setLoadState('error');
        setError(`Model initialization failed: ${err.message || err}`);
        setLoadText('Model failed to load');
      });

    return () => {
      llm.dispose();
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    const llm = llmRef.current;
    if (!llm || loadState !== 'ready' || !prompt.trim()) return;

    setGenerating(true);
    setError(null);

    const start = performance.now();
    try {
      const result = await llm.generateTagsFromPrompt(prompt);
      setTags(result.slice(0, topN));
      setRawResponse(llm.lastRawResponse || '(empty response)');
      setLastTime(Math.round(performance.now() - start));
    } catch (err: any) {
      setError(`Tag generation failed: ${err.message || err}`);
      setTags([]);
      setRawResponse('');
      setLastTime(null);
    } finally {
      setGenerating(false);
    }
  }, [llmRef, loadState, prompt, topN]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleGenerate();
    }
  }, [handleGenerate]);

  // Ctrl+Shift+D closes this window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        window.close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-900 text-gray-100 font-sans">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800/40 flex items-center gap-4 shrink-0">
        <button
          onClick={handleClose}
          className="px-3 py-1.5 text-xs bg-gray-700/50 border border-gray-600/50 rounded-lg text-gray-400 hover:bg-gray-600/50 hover:text-gray-200 transition-colors shrink-0"
          title="Ctrl+Shift+D"
        >
          &#8592; Close
        </button>
        <div>
          <h1 className="text-lg font-semibold">Auto-Tagging Test</h1>
          <p className="text-sm text-gray-400">Gemma 3 1B via WebLLM — local inference</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${
            loadState === 'loading' ? 'bg-yellow-500' :
            loadState === 'ready' ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-400">
            {loadState === 'loading' && loadProgress > 0
              ? `Loading: ${loadProgress}% — ${loadText}`
              : loadText}
          </span>
          {loadState === 'loading' && (
            <div className="w-32 h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${loadProgress}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Input card */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5">
            <label className="block text-sm font-medium text-gray-200 mb-2">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 resize-y"
              placeholder="Enter an image generation prompt..."
            />

            {/* Presets */}
            <div className="flex flex-wrap gap-2 mt-3">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPrompt(p.value)}
                  className="px-3 py-1 text-xs bg-gray-700/50 border border-gray-600/50 rounded-full text-gray-400 hover:bg-gray-600/50 hover:text-gray-200 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mt-4">
              <button
                onClick={handleGenerate}
                disabled={loadState !== 'ready' || generating || !prompt.trim()}
                className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? 'Generating...' : 'Generate Tags'}
              </button>
              <label className="flex items-center gap-2 text-sm text-gray-400">
                Max tags:
                <select
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  {[5, 8, 10, 15].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-gray-500 ml-auto">Ctrl+Enter to generate</span>
            </div>
          </div>

          {/* Results card */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-200">Generated Tags</h3>
              {lastTime !== null && (
                <span className="text-xs text-gray-500">{tags.length} tag(s) in {lastTime}ms</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 min-h-[40px] items-center">
              {tags.length === 0 ? (
                <span className="text-sm text-gray-600">
                  {generating ? 'Generating...' : 'Click "Generate Tags" or press Ctrl+Enter'}
                </span>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1.5 bg-gray-700/60 border border-gray-600/30 rounded-full text-sm text-gray-200"
                  >
                    {tag}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Raw LLM response (debug) */}
          {rawResponse && (
            <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Raw model response</h3>
              <pre className="text-xs text-gray-400 bg-gray-900/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                {rawResponse}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
