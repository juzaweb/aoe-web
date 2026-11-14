import { describe, expect, it } from 'vitest';
import React from 'react';
import { AuthScreen } from './AuthScreen.js';
import { renderWithRouter } from '../test/renderWithRouter.js';
import i18n from '../i18n/index.js';

describe('AuthScreen UX improvements', () => {
  it('renders password input with visibility toggle button and accessibility attributes', async () => {
    // Test in English
    await i18n.changeLanguage('en');
    const htmlEn = renderWithRouter(<AuthScreen onAuthenticated={() => {}} />);

    expect(htmlEn).toContain('type="password"');
    expect(htmlEn).toContain('id="auth-password"');
    expect(htmlEn).toMatch(/<button[^>]*type="button"[^>]*aria-label="Show password"/);

    // Test in Vietnamese
    await i18n.changeLanguage('vi');
    const htmlVi = renderWithRouter(<AuthScreen onAuthenticated={() => {}} />);
    expect(htmlVi).toMatch(/<button[^>]*type="button"[^>]*aria-label="Hiện mật khẩu"/);
  });
});
