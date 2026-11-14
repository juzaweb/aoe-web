import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_STORAGE_KEY, detectLanguage, localeFromPath } from './index.js';

describe('localeFromPath', () => {
  it('reads the first path segment when it is a supported locale', () => {
    expect(localeFromPath('/en')).toBe('en');
    expect(localeFromPath('/vi/play')).toBe('vi');
    expect(localeFromPath('/EN/play')).toBe('en');
  });

  it('ignores an unprefixed or unsupported path', () => {
    expect(localeFromPath('/')).toBeNull();
    expect(localeFromPath('/play')).toBeNull();
    expect(localeFromPath('/fr/play')).toBeNull();
    expect(localeFromPath('/player/1')).toBeNull();
  });

  it('ignores query strings and hashes', () => {
    expect(localeFromPath('/en?x=1')).toBe('en');
    expect(localeFromPath('/vi/play#top')).toBe('vi');
  });
});

describe('detectLanguage', () => {
  function stubEnv(options: {
    pathname?: string;
    stored?: string | null;
    languages?: string[];
  }) {
    const storage = new Map<string, string>();
    if (options.stored) storage.set(LANGUAGE_STORAGE_KEY, options.stored);

    vi.stubGlobal('window', {
      location: { pathname: options.pathname ?? '/' }
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
    vi.stubGlobal('navigator', {
      language: options.languages?.[0] ?? 'fr-FR',
      languages: options.languages ?? []
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the URL prefix over the stored preference', () => {
    stubEnv({ pathname: '/en/play', stored: 'vi' });

    expect(detectLanguage()).toBe('en');
  });

  it('falls back to the stored preference on an unprefixed path', () => {
    stubEnv({ pathname: '/', stored: 'en', languages: ['vi-VN'] });

    expect(detectLanguage()).toBe('en');
  });

  it('uses the browser language when nothing is stored', () => {
    stubEnv({ pathname: '/', stored: null, languages: ['vi-VN', 'en-US'] });

    expect(detectLanguage()).toBe('vi');
  });

  it('defaults to Vietnamese for an unsupported browser', () => {
    stubEnv({ pathname: '/', stored: null, languages: ['fr-FR'] });

    expect(detectLanguage()).toBe('vi');
  });

  it('redacts nothing when storage throws', () => {
    vi.stubGlobal('window', { location: { pathname: '/' } });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      }
    });
    vi.stubGlobal('navigator', { language: 'en-GB', languages: ['en-GB'] });

    expect(detectLanguage()).toBe('en');
  });
});
