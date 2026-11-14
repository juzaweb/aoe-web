import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HomePage } from './components/HomePage.js';
import { asLanguage, LANGUAGE_CHANGED_EVENT, type Language } from './i18n/index.js';
import {
  DEFAULT_LOCALE,
  HOME_PATH,
  homePath,
  homeRedirectFor,
  localizedPath,
  playPath,
  withLocale,
  type AppRoute
} from './routing.js';

/**
 * The game (Phaser + Colyseus) is the expensive half of the client. Loading it
 * lazily keeps the landing page's first paint small; the chunk is fetched only
 * when the visitor actually enters `/{locale}/play`.
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

const GameRoute: React.FC = () => (
  <Suspense fallback={<RouteLoading />}>
    <GameApp />
  </Suspense>
);

/**
 * `useTranslation()` hands back a refreshed wrapper after a language change, so
 * an effect that reads the instance cannot depend on it without re-running on
 * every switch. Reading it through a ref keeps the instance live and stable.
 */
function useI18nInstance() {
  const { i18n } = useTranslation();
  const ref = useRef(i18n);
  ref.current = i18n;
  return ref;
}

/**
 * Keeps the language in step with the URL prefix. The prefix is the source of
 * truth: a shared `/en/play` link has to win over an older stored preference.
 */
function useLocaleFromRoute(locale: Language) {
  const i18nRef = useI18nInstance();

  useEffect(() => {
    const current = i18nRef.current;
    if (asLanguage(current.language) !== locale) void current.changeLanguage(locale);
  }, [locale, i18nRef]);
}

/**
 * Picking a language only changes i18next; the URL prefix has to follow it, so
 * the address never disagrees with the visible copy.
 */
const LocaleUrlSync: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const i18nRef = useI18nInstance();

  useEffect(() => {
    const syncUrl = () => {
      const target = withLocale(pathname, asLanguage(i18nRef.current.language));
      if (target !== pathname) navigate(target);
    };
    window.addEventListener(LANGUAGE_CHANGED_EVENT, syncUrl);
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, syncUrl);
  }, [navigate, pathname, i18nRef]);

  return null;
};

interface ScreenLayoutProps {
  locale: Language;
  route: AppRoute;
  children: React.ReactNode;
}

/**
 * Per-route wrapper: aligns the language with the URL and owns the document
 * title and description for the screen being shown.
 */
const ScreenLayout: React.FC<ScreenLayoutProps> = ({ locale, route, children }) => {
  const { t } = useTranslation();
  useLocaleFromRoute(locale);

  useEffect(() => {
    document.title = t(route === 'play' ? 'app.documentTitle' : 'landing.meta.title');

    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = t(
        route === 'play' ? 'app.metaDescription' : 'landing.meta.description'
      );
    }
  }, [route, locale, t]);

  return (
    <>
      <LocaleUrlSync />
      {children}
    </>
  );
};

/**
 * The bare root is the English homepage, but a visitor whose language is not
 * English is sent to their own homepage instead of silently switching them.
 * This runs before `ScreenLayout`, so the language is still the detected one.
 */
const DefaultHomeRoute: React.FC = () => {
  const { i18n } = useTranslation();
  const redirect = homeRedirectFor(asLanguage(i18n.language));
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <ScreenLayout locale={DEFAULT_LOCALE} route="home">
      <HomePage />
    </ScreenLayout>
  );
};

/** `/play` predates the locale prefix: send it to the visitor's own locale. */
const LegacyPlayRedirect: React.FC = () => {
  const { i18n } = useTranslation();
  return <Navigate to={playPath(asLanguage(i18n.language))} replace />;
};

/** Unknown paths land on the homepage of the active language. */
const FallbackRedirect: React.FC = () => {
  const { i18n } = useTranslation();
  return <Navigate to={homePath(asLanguage(i18n.language))} replace />;
};

/**
 * One screen in one locale. Both locales are built by this factory so the
 * element trees stay identical: switching the language on `/vi/play` only
 * updates props, and React reuses the mounted `GameApp` instead of remounting
 * it — a remount would drop the Colyseus room and the player's session.
 */
function screenRoute(locale: Language, route: AppRoute, screen: React.ReactNode) {
  return {
    id: `${route}:${locale}`,
    path: localizedPath(locale, route),
    element: (
      <ScreenLayout locale={locale} route={route}>
        {screen}
      </ScreenLayout>
    )
  };
}

/**
 * `/` is the English homepage, `/vi` its Vietnamese counterpart; the game is
 * always prefixed (`/en/play`, `/vi/play`). `/en` is not a valid address and is
 * replaced by `/`, and a legacy `/play` link keeps working.
 */
export const routes = [
  { id: 'home:default', path: HOME_PATH, element: <DefaultHomeRoute /> },
  screenRoute('vi', 'home', <HomePage />),
  screenRoute('en', 'play', <GameRoute />),
  screenRoute('vi', 'play', <GameRoute />),
  { id: 'en-home-alias', path: '/en', element: <Navigate to={HOME_PATH} replace /> },
  { id: 'legacy-play', path: '/play', element: <LegacyPlayRedirect /> },
  { id: 'fallback', path: '*', element: <FallbackRedirect /> }
];
