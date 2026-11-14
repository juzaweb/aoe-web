import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  HOME_PATH,
  homePath,
  homeRedirectFor,
  localizedPath,
  playPath,
  withLocale
} from './routing.js';

describe('localized paths', () => {
  it('leaves the default locale homepage unprefixed', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(homePath('en')).toBe('/');
    expect(HOME_PATH).toBe('/');
  });

  it('prefixes every other homepage', () => {
    expect(homePath('vi')).toBe('/vi');
  });

  it('always prefixes the game, including the default locale', () => {
    expect(playPath('en')).toBe('/en/play');
    expect(playPath('vi')).toBe('/vi/play');
  });

  it('builds the address for a route in a locale', () => {
    expect(localizedPath('en', 'home')).toBe('/');
    expect(localizedPath('en', 'play')).toBe('/en/play');
    expect(localizedPath('vi', 'home')).toBe('/vi');
    expect(localizedPath('vi', 'play')).toBe('/vi/play');
  });
});

describe('homeRedirectFor', () => {
  it('leaves an English visitor on the bare root', () => {
    expect(homeRedirectFor('en')).toBeNull();
  });

  it('sends every other locale to its own homepage', () => {
    expect(homeRedirectFor('vi')).toBe('/vi');
  });
});

describe('withLocale', () => {
  it('drops the prefix when switching home to the default locale', () => {
    expect(withLocale('/', 'en')).toBe('/');
    expect(withLocale('/vi', 'en')).toBe('/');
    expect(withLocale('/vi/', 'en')).toBe('/');
  });

  it('adds the prefix when switching home to another locale', () => {
    expect(withLocale('/', 'vi')).toBe('/vi');
    expect(withLocale('/en', 'vi')).toBe('/vi');
  });

  it('keeps the game screen and swaps only the prefix', () => {
    expect(withLocale('/vi/play', 'en')).toBe('/en/play');
    expect(withLocale('/en/play', 'vi')).toBe('/vi/play');
    expect(withLocale('/play', 'vi')).toBe('/vi/play');
    expect(withLocale('/en/play/', 'vi')).toBe('/vi/play');
  });

  it('treats an unknown path as the homepage', () => {
    expect(withLocale('/en/unknown', 'vi')).toBe('/vi');
  });
});
