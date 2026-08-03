import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── License gating tests ─────────────────────────────────────────────
// These tests verify that every premium AI feature is locked behind a
// valid license. The ai-intelligence module is mocked as AVAILABLE, so
// any null return below is caused by the license gate, NOT by a missing
// module — proving the closed-source implementations are unreachable
// without premium.
//
// Constructor spies (vi.hoisted — required because vi.mock factories are
// hoisted above top-level const declarations) let us assert exactly which
// closed-source classes were instantiated.

const mocks = vi.hoisted(() => ({
  LLMTagGenerator: vi.fn(),
  TagGenerator: vi.fn(),
  WebLLMEmbeddingProvider: vi.fn(),
  StackingEngine: vi.fn(),
}));

// Vitest 4's file-backed localStorage can be inert on some machines (see the
// `--localstorage-file` warning) — it exposes an object with no Storage
// methods, which crashes zustand's persist middleware on setState. Install a
// working in-memory implementation BEFORE the store module is imported.
vi.hoisted(() => {
  const data: Record<string, string> = {};
  const storage: Storage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    clear: () => {
      for (const k in data) delete data[k];
    },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
});

vi.mock('@ai-images-browser/ai-intelligence', () => {
  class LLMTagGenerator {
    constructor(modelId: string, onProgress?: unknown) {
      mocks.LLMTagGenerator(modelId, onProgress);
    }
    async initialize(): Promise<void> {}
    async generateTagsFromPrompt(prompt: string): Promise<string[]> {
      return [prompt, 'llm-tag'];
    }
    dispose(): void {}
    get lastRawResponse(): string | null {
      return null;
    }
  }

  class TagGenerator {
    constructor() {
      mocks.TagGenerator();
    }
    async generateTagsFromPrompt(prompt: string): Promise<string[]> {
      return [prompt, 'module-tag'];
    }
  }

  class WebLLMEmbeddingProvider {
    readonly dimension = 768;
    readonly modelId = 'mock-embed-model';
    constructor(modelId: string, dimension: number, onProgress?: unknown) {
      mocks.WebLLMEmbeddingProvider(modelId, dimension, onProgress);
    }
    async initialize(): Promise<void> {}
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => new Float32Array(768));
    }
    dispose(): void {}
  }

  class StackingEngine {
    constructor() {
      mocks.StackingEngine();
    }
    generatePromptHash(prompt: string): string {
      return prompt.length.toString(16).padStart(8, '0');
    }
    normalizePrompt(prompt: string): string {
      return prompt.trim();
    }
    computePromptSimilarity(_a: string, _b: string): number {
      return 1;
    }
    async computeSimilarityGroupIds(): Promise<{ groupIdToSimId: Map<string, string> }> {
      return { groupIdToSimId: new Map() };
    }
  }

  return { LLMTagGenerator, TagGenerator, WebLLMEmbeddingProvider, StackingEngine };
});

// Imported statically so we can control license state; aiBridge's internal
// checkPremiumLicense() dynamic-imports the same module instance.
import { useSettingsStore } from '../store/useSettingsStore';
import type { LicenseStatus } from '../services/licenseService';

const NON_PREMIUM_STATUSES: LicenseStatus[] = ['unchecked', 'invalid', 'expired', 'revoked'];
const PREMIUM_STATUSES: LicenseStatus[] = ['valid', 'offline-valid'];

const setLicenseStatus = (status: LicenseStatus) => {
  useSettingsStore.setState({
    licenseKey: status === 'valid' || status === 'offline-valid' ? 'TEST-KEY-1234' : '',
    licenseStatus: status,
    licenseEmail: '',
    licensePurchaseDate: null,
    licenseLastValidated: status === 'valid' || status === 'offline-valid' ? Date.now() : 0,
  });
};

describe('aiBridge — premium gating without a license', () => {
  beforeEach(() => {
    for (const spy of Object.values(mocks)) spy.mockClear();
  });

  for (const status of NON_PREMIUM_STATUSES) {
    describe(`license status "${status}"`, () => {
      beforeEach(() => setLicenseStatus(status));

      it('createLLMTagGenerator returns null and never touches the closed-source module', async () => {
        const { createLLMTagGenerator } = await import('../services/aiBridge');
        const llm = await createLLMTagGenerator();
        expect(llm).toBeNull();
        expect(mocks.LLMTagGenerator).not.toHaveBeenCalled();
      });

      it('createEmbeddingProvider returns null and never touches the closed-source module', async () => {
        const { createEmbeddingProvider } = await import('../services/aiBridge');
        const provider = await createEmbeddingProvider();
        expect(provider).toBeNull();
        expect(mocks.WebLLMEmbeddingProvider).not.toHaveBeenCalled();
      });

      it('createStackingEngine returns null and never touches the closed-source module', async () => {
        const { createStackingEngine } = await import('../services/aiBridge');
        const engine = await createStackingEngine();
        expect(engine).toBeNull();
        expect(mocks.StackingEngine).not.toHaveBeenCalled();
      });

      it('createTagGenerator skips the closed-source TagGenerator', async () => {
        const { createTagGenerator } = await import('../services/aiBridge');
        const tagger = await createTagGenerator();
        expect(tagger).not.toBeNull();
        expect(mocks.TagGenerator).not.toHaveBeenCalled();
      });
    });
  }
});

describe('aiBridge — free built-in tag generator without a license', () => {
  beforeEach(() => {
    setLicenseStatus('unchecked');
    for (const spy of Object.values(mocks)) spy.mockClear();
  });

  it('still returns a working generator (open-source fallback)', async () => {
    const { createTagGenerator } = await import('../services/aiBridge');
    const tagger = await createTagGenerator();

    expect(tagger).not.toBeNull();
    const tags = await tagger!.generateTagsFromPrompt(
      'a red fox sitting in a snowy forest, digital painting',
    );
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => typeof t === 'string')).toBe(true);
    // The free fallback must NOT be the closed-source implementation
    expect(mocks.TagGenerator).not.toHaveBeenCalled();
  });
});

describe('aiBridge — premium features with a license', () => {
  for (const status of PREMIUM_STATUSES) {
    describe(`license status "${status}"`, () => {
      beforeEach(() => {
        setLicenseStatus(status);
        for (const spy of Object.values(mocks)) spy.mockClear();
      });

      it('createLLMTagGenerator constructs the closed-source LLM generator', async () => {
        const { createLLMTagGenerator } = await import('../services/aiBridge');
        const llm = await createLLMTagGenerator('model-x');

        expect(llm).not.toBeNull();
        expect(mocks.LLMTagGenerator).toHaveBeenCalledTimes(1);
        expect(mocks.LLMTagGenerator).toHaveBeenCalledWith('model-x', undefined);
      });

      it('createEmbeddingProvider constructs the closed-source embedding provider', async () => {
        const { createEmbeddingProvider } = await import('../services/aiBridge');
        const provider = await createEmbeddingProvider('embed-model', 384);

        expect(provider).not.toBeNull();
        expect(mocks.WebLLMEmbeddingProvider).toHaveBeenCalledTimes(1);
        expect(mocks.WebLLMEmbeddingProvider).toHaveBeenCalledWith('embed-model', 384, undefined);
      });

      it('createStackingEngine constructs the closed-source stacking engine', async () => {
        const { createStackingEngine } = await import('../services/aiBridge');
        const engine = await createStackingEngine();

        expect(engine).not.toBeNull();
        expect(mocks.StackingEngine).toHaveBeenCalledTimes(1);
      });

      it('createTagGenerator uses the closed-source TagGenerator', async () => {
        const { createTagGenerator } = await import('../services/aiBridge');
        const tagger = await createTagGenerator();

        expect(tagger).not.toBeNull();
        expect(mocks.TagGenerator).toHaveBeenCalledTimes(1);
      });
    });
  }
});

describe('aiFeatureAccess — UI gate helper', () => {
  beforeEach(() => {
    setLicenseStatus('unchecked');
  });

  it('isAiFeaturesEnabled() is false without a license', async () => {
    const { isAiFeaturesEnabled } = await import('../services/aiFeatureAccess');
    for (const status of NON_PREMIUM_STATUSES) {
      setLicenseStatus(status);
      expect(isAiFeaturesEnabled(), `status=${status}`).toBe(false);
    }
  });

  it('isAiFeaturesEnabled() is true with a premium license', async () => {
    const { isAiFeaturesEnabled } = await import('../services/aiFeatureAccess');
    for (const status of PREMIUM_STATUSES) {
      setLicenseStatus(status);
      expect(isAiFeaturesEnabled(), `status=${status}`).toBe(true);
    }
  });

  it('useAiFeaturesEnabled() reacts to license changes', async () => {
    const { useAiFeaturesEnabled } = await import('../services/aiFeatureAccess');
    const { result } = renderHook(() => useAiFeaturesEnabled());

    act(() => setLicenseStatus('unchecked'));
    expect(result.current).toBe(false);

    act(() => setLicenseStatus('valid'));
    expect(result.current).toBe(true);

    act(() => setLicenseStatus('revoked'));
    expect(result.current).toBe(false);

    act(() => setLicenseStatus('offline-valid'));
    expect(result.current).toBe(true);
  });
});

describe('aiBridge — license revocation mid-session', () => {
  beforeEach(() => {
    for (const spy of Object.values(mocks)) spy.mockClear();
  });

  it('locks premium features as soon as the license is no longer valid', async () => {
    // Activate first — module gets loaded and cached inside aiBridge.
    setLicenseStatus('valid');
    const { createLLMTagGenerator } = await import('../services/aiBridge');
    const llm = await createLLMTagGenerator();
    expect(llm).not.toBeNull();
    expect(mocks.LLMTagGenerator).toHaveBeenCalledTimes(1);

    // Revoke the license (e.g. refund or expiry) — the module cache must
    // NOT bypass the gate on the next call.
    setLicenseStatus('revoked');
    const llm2 = await createLLMTagGenerator();
    expect(llm2).toBeNull();
    expect(mocks.LLMTagGenerator).toHaveBeenCalledTimes(1); // no new construction
  });
});
