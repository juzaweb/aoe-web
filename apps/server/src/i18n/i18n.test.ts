import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  localeFromHeader,
  normalizeLocale,
  render,
  translate,
  translateError,
  type LocalizedSpec
} from './index.js';
import { CATALOG, TEMPLATES } from './messages.js';

describe('normalizeLocale', () => {
  it('accepts supported codes with region tags and payload objects', () => {
    expect(normalizeLocale('vi')).toBe('vi');
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('vi-VN')).toBe('vi');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale({ locale: 'en' })).toBe('en');
  });

  it('rejects unsupported or malformed values', () => {
    expect(normalizeLocale('fr')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale(42)).toBeNull();
    expect(normalizeLocale({ locale: 7 })).toBeNull();
  });
});

describe('localeFromHeader', () => {
  it('picks the first supported language from an Accept-Language list', () => {
    expect(localeFromHeader('en-US,vi;q=0.9')).toBe('en');
    expect(localeFromHeader('vi,en;q=0.8')).toBe('vi');
    expect(localeFromHeader('fr-FR')).toBeNull();
    expect(localeFromHeader(undefined)).toBeNull();
  });
});

describe('translate', () => {
  it('returns the English source when no locale is given or the locale is en', () => {
    expect(translate(null, 'Protected')).toBe('Protected');
    expect(translate(undefined, 'Protected')).toBe('Protected');
    expect(translate('en', 'Protected')).toBe('Protected');
  });

  it('renders the Vietnamese catalog for vi and passes unknown text through', () => {
    expect(translate('vi', 'Protected')).toBe('Đang được bảo vệ');
    expect(translate('vi', 'Not a catalog message.')).toBe('Not a catalog message.');
  });
});

describe('render (LocalizedSpec)', () => {
  const spec: LocalizedSpec = {
    key: 'raid.maxUnits',
    params: { n: 5 },
    fallback: 'At most 5 units can be brought per raid.'
  };

  it('uses the English fallback without a locale', () => {
    expect(render(null, spec)).toBe(spec.fallback);
    expect(render('en', spec)).toBe(spec.fallback);
  });

  it('renders the Vietnamese template with interpolated params', () => {
    expect(render('vi', spec)).toBe('Chỉ được mang tối đa 5 đơn vị mỗi trận.');
  });

  it('falls back when the key does not exist', () => {
    expect(render('vi', { ...spec, key: 'no.such.key' })).toBe(spec.fallback);
  });
});

describe('translateError', () => {
  it('renders a spec-bearing error through its key', () => {
    expect(
      translateError('vi', {
        message: 'ignored',
        spec: { key: 'auth.passwordLength', params: { min: 6, max: 128 }, fallback: 'x' }
      })
    ).toBe('Mật khẩu phải có từ 6 đến 128 ký tự.');
  });

  it('translates a plain error message through the catalog', () => {
    expect(translateError('vi', new Error('Wrong username or password.'))).toBe(
      'Sai tên đăng nhập hoặc mật khẩu.'
    );
    expect(translateError('en', new Error('Wrong username or password.'))).toBe(
      'Wrong username or password.'
    );
  });

  it('answers with the English system message when nothing else is known', () => {
    expect(translateError('en', {})).toBe('System error. Please try again.');
    expect(translateError('vi', {})).toBe('Lỗi hệ thống. Vui lòng thử lại.');
  });
});

describe('catalog integrity', () => {
  it('every catalog entry carries a Vietnamese translation', () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      expect(entry.vi, `missing vi for ${JSON.stringify(key)}`).toBeTruthy();
      expect(entry.vi.trim(), `blank vi for ${JSON.stringify(key)}`).not.toBe('');
    }
  });

  it('every Vietnamese template only uses placeholders the English source has', () => {
    // A translation may legitimately drop a word — `command.buildFirst` has no
    // `{{article}}` in Vietnamese because the language has no indefinite
    // article — but it must never introduce a placeholder of its own, which
    // would indicate a typo that interpolation would leave visible as `{{x}}`.
    // The reverse direction is checked against the same known exception.
    const EN_ONLY: Record<string, Set<string>> = {
      'command.buildFirst': new Set(['article'])
    };
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const [key, entry] of Object.entries(TEMPLATES)) {
      const en = placeholders(entry.en);
      const vi = placeholders(entry.vi);
      const allowedEnOnly = EN_ONLY[key] ?? new Set<string>();
      for (const placeholder of vi) {
        expect(en.includes(placeholder), `vi placeholder {{${placeholder}}} missing in en of ${key}`).toBe(true);
      }
      for (const placeholder of en) {
        expect(
          vi.includes(placeholder) || allowedEnOnly.has(placeholder),
          `en placeholder {{${placeholder}}} missing in vi of ${key}`
        ).toBe(true);
      }
    }
  });

  it('the supported list is the single source of truth', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['vi', 'en']);
    expect(normalizeLocale('de')).toBeNull();
  });
});
