import React, { Suspense, lazy, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HomePage } from './components/HomePage.js';
import { HOME_PATH, PLAY_PATH, navigate, normalizePath, useRoute } from './router.js';

/**
 * The game (Phaser + Colyseus) is the expensive half of the client. Loading it
 * lazily keeps the landing page's first paint small; the chunk is fetched only
 * when the visitor actually enters `/play`.
 */
const GameApp = lazy(async () => {
  const module = await import('./GameApp.js');
  return { default: module.GameApp };
});

const RouteLoading: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="aoe-backdrop flex h-[100dvh] w-full items-center justify-center p-4">
      <div className="aoe-modal flex flex-col items-center gap-3 px-8 py-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <span className="text-sm text-slate-300">{t('app.loadingGame')}</span>
      </div>
    </div>
  );
};

/**
 * Route shell: `/` is the public landing page, `/play` is the game. Everything
 * that belongs to a running session (auth gate, Colyseus room, Phaser canvas)
 * lives in `GameApp`, so the landing page never pays for it.
 */
export const App: React.FC = () => {
  const route = useRoute();
  const { t, i18n } = useTranslation();

  // Deep links to an unknown path land on the homepage with a clean URL rather
  // than rendering the landing page under a URL the router would not reproduce.
  useEffect(() => {
    const path = normalizePath(window.location.pathname);
    if (path !== HOME_PATH && path !== PLAY_PATH) navigate(HOME_PATH, { replace: true });
  }, [route]);

  useEffect(() => {
    document.title = t(route === 'play' ? 'app.documentTitle' : 'landing.meta.title');

    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = t(
        route === 'play' ? 'app.metaDescription' : 'landing.meta.description'
      );
    }
  }, [route, t, i18n.language]);

  if (route === 'play') {
    return (
      <Suspense fallback={<RouteLoading />}>
        <GameApp />
      </Suspense>
    );
  }

  return <HomePage />;
};
