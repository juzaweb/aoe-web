import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Castle,
  Check,
  Crown,
  Globe2,
  Pickaxe,
  Play,
  Shield,
  Smartphone,
  Swords,
  Trees
} from 'lucide-react';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.js';
import { hasStoredToken } from '../auth/token.js';
import { PLAY_PATH, RouteLink } from '../router.js';

/** Feature cards. The copy lives in the `landing.features` i18n branch. */
const FEATURES = [
  { key: 'kingdom', Icon: Castle },
  { key: 'economy', Icon: Pickaxe },
  { key: 'army', Icon: Swords },
  { key: 'raids', Icon: Globe2 },
  { key: 'defense', Icon: Shield },
  { key: 'mobile', Icon: Smartphone }
] as const;

/** Buildings shown in the art strip; keys match `buildings.*` in the catalog. */
const SHOWCASE = [
  { file: 'town_center', key: 'TOWN_CENTER' },
  { file: 'barracks', key: 'BARRACKS' },
  { file: 'stable', key: 'STABLE' },
  { file: 'archery_range', key: 'ARCHERY_RANGE' },
  { file: 'tower', key: 'TOWER' },
  { file: 'house', key: 'HOUSE' }
] as const;

/** Units standing on the hero ground line. Keys match `units.*`. */
const HERO_UNITS = [
  { file: 'villager_idle', key: 'VILLAGER' },
  { file: 'spearman_idle', key: 'SPEARMAN' },
  { file: 'archer_idle', key: 'ARCHER' },
  { file: 'cavalry_idle', key: 'CAVALRY' }
] as const;

const RAID_POINTS = ['target', 'loot', 'shield'] as const;
const STEPS = ['one', 'two', 'three'] as const;

const EYEBROW = 'text-[11px] font-bold uppercase tracking-[0.28em] text-amber-500';
const CARD =
  'border border-amber-900/40 bg-slate-900/60 transition-colors duration-200 hover:border-amber-600/60 hover:bg-slate-900/80';

/**
 * Public landing page at `/`. It is deliberately static: no Colyseus client and
 * no Phaser canvas, so a visitor gets a fast first paint and the game bundle is
 * only loaded once they press Play.
 */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  // A stored token is enough to offer the shorter "continue" label; `/play`
  // still verifies it with the server and falls back to the auth screen.
  const [hasSession] = useState<boolean>(hasStoredToken);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={scrollRef}
      className="relative h-[100dvh] w-full select-text overflow-x-hidden overflow-y-auto bg-slate-950 text-slate-100"
    >
      <header className="sticky top-0 z-30 border-b border-amber-900/40 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <RouteLink
            to="/"
            // The logo is already the current route on this page, so navigate()
            // is a no-op; scroll the landing container back to the hero instead.
            onClick={() => scrollRef.current?.scrollTo({ top: 0 })}
            className="flex shrink-0 items-center gap-2 text-amber-300 transition-colors hover:text-amber-200"
            aria-label={t('landing.brandHome')}
          >
            <Swords size={22} aria-hidden />
            <span className="font-medieval text-base font-bold tracking-[0.18em] sm:text-lg">
              CHIẾN QUỐC
            </span>
          </RouteLink>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex" aria-label={t('landing.nav.label')}>
            <a href="#features" className="transition-colors hover:text-amber-300">
              {t('landing.nav.features')}
            </a>
            <a href="#world" className="transition-colors hover:text-amber-300">
              {t('landing.nav.world')}
            </a>
            <a href="#how-to-play" className="transition-colors hover:text-amber-300">
              {t('landing.nav.howToPlay')}
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <div className="sm:hidden">
              <LanguageSwitcher compact />
            </div>
            <RouteLink
              to={PLAY_PATH}
              className="aoe-button aoe-button-primary inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs font-bold uppercase tracking-wider text-slate-950"
            >
              <Play size={14} aria-hidden />
              {hasSession ? t('landing.hero.continueShort') : t('landing.hero.playNow')}
            </RouteLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-[url('/assets/ui/backdrop.png')] bg-[length:256px_256px] bg-repeat opacity-70"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_28%,rgba(180,120,40,0.16),transparent_58%)]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/40 to-slate-950"
          />

          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-24 lg:pt-20">
            <div>
              <p className={`${EYEBROW} mb-4 inline-flex border border-amber-700/50 bg-amber-950/30 px-3 py-1.5`}>
                {t('landing.hero.badge')}
              </p>
              <h1 className="font-medieval text-4xl font-bold leading-[1.08] tracking-wide text-slate-50 sm:text-5xl lg:text-6xl">
                {t('landing.hero.titleLine1')}
                <br />
                <span className="text-amber-300">{t('landing.hero.titleLine2')}</span>
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
                {t('landing.hero.subtitle')}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <RouteLink
                  to={PLAY_PATH}
                  className="aoe-button aoe-button-primary inline-flex min-h-[48px] items-center gap-2 px-6 text-sm font-bold uppercase tracking-wider text-slate-950"
                >
                  <Play size={17} aria-hidden />
                  {hasSession ? t('landing.hero.continue') : t('landing.hero.playNow')}
                </RouteLink>
                <a
                  href="#features"
                  className="aoe-button inline-flex min-h-[48px] items-center gap-2 px-5 text-sm font-semibold text-amber-100"
                >
                  {t('landing.hero.explore')}
                  <ArrowRight size={16} aria-hidden />
                </a>
              </div>

              <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                {['free', 'browser', 'persistent'].map((key) => (
                  <li key={key} className="inline-flex items-center gap-1.5">
                    <Check size={14} className="text-emerald-400" aria-hidden />
                    {t(`landing.hero.bullets.${key}`)}
                  </li>
                ))}
              </ul>
            </div>

            {/* Hero art: the castle asset is the game's own town centre, with the
                four trainable unit portraits on the ground line below it. */}
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div
                aria-hidden
                className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/15 blur-3xl"
              />
              <img
                src="/assets/buildings/town_center.png"
                alt={t('landing.hero.artAlt')}
                width={576}
                height={440}
                className="relative z-10 mx-auto w-full max-w-[520px] drop-shadow-[0_28px_42px_rgba(0,0,0,0.75)]"
              />
              <div className="relative z-10 mt-1 flex items-end justify-center gap-2 sm:gap-4">
                {HERO_UNITS.map((unit) => (
                  <img
                    key={unit.key}
                    src={`/assets/units/${unit.file}.png`}
                    alt={t(`units.${unit.key}.name`)}
                    width={128}
                    height={128}
                    className="h-16 w-16 object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.7)] sm:h-20 sm:w-20"
                  />
                ))}
              </div>
              <div
                aria-hidden
                className="mx-auto mt-1 h-px w-4/5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"
              />
              <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-500/80">
                {t('landing.hero.artCaption')}
              </p>
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className={EYEBROW}>{t('landing.features.eyebrow')}</p>
            <h2 className="mt-3 font-medieval text-3xl font-bold tracking-wide text-slate-50 sm:text-4xl">
              {t('landing.features.title')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
              {t('landing.features.subtitle')}
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, Icon }) => (
              <article key={key} className={`${CARD} p-5`}>
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center border border-amber-700/50 bg-amber-950/40 text-amber-300">
                  <Icon size={20} aria-hidden />
                </div>
                <h3 className="font-medieval text-base font-bold tracking-wide text-amber-100">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {t(`landing.features.${key}.body`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* World map / raids */}
        <section id="world" className="scroll-mt-20 border-y border-amber-900/30 bg-slate-900/30 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className={EYEBROW}>{t('landing.world.eyebrow')}</p>
              <h2 className="mt-3 font-medieval text-3xl font-bold tracking-wide text-slate-50 sm:text-4xl">
                {t('landing.world.title')}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
                {t('landing.world.subtitle')}
              </p>

              <ul className="mt-8 space-y-5">
                {RAID_POINTS.map((key, index) => (
                  <li key={key} className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border border-amber-700/60 bg-amber-950/40 font-medieval text-xs font-bold text-amber-300">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-amber-100">
                        {t(`landing.world.points.${key}.title`)}
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-400">
                        {t(`landing.world.points.${key}.body`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <figure className="relative">
              <div className="aoe-frame relative overflow-hidden bg-slate-950 p-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
                <img
                  src="/assets/worldmap/world_map.png"
                  alt={t('landing.world.mapAlt')}
                  width={1024}
                  height={572}
                  loading="lazy"
                  className="w-full opacity-90"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/20"
                />
                <figcaption className="absolute left-3 top-3 inline-flex items-center gap-1.5 border border-amber-700/50 bg-slate-950/80 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
                  <Globe2 size={12} aria-hidden />
                  {t('landing.world.mapCaption')}
                </figcaption>
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Trees size={12} aria-hidden className="text-emerald-500" />
                  {t('resources.wood')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Pickaxe size={12} aria-hidden className="text-amber-500" />
                  {t('resources.stone')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Swords size={12} aria-hidden className="text-red-400" />
                  {t('landing.world.mapFooter')}
                </span>
              </div>
            </figure>
          </div>
        </section>

        {/* Building art strip */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className={EYEBROW}>{t('landing.showcase.eyebrow')}</p>
              <h2 className="mt-3 font-medieval text-3xl font-bold tracking-wide text-slate-50 sm:text-4xl">
                {t('landing.showcase.title')}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              {t('landing.showcase.subtitle')}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {SHOWCASE.map((building) => (
              <figure
                key={building.key}
                className="group flex flex-col items-center border border-amber-900/30 bg-slate-900/40 p-3 transition-colors hover:border-amber-600/50"
              >
                <img
                  src={`/assets/buildings/${building.file}.png`}
                  alt={t(`buildings.${building.key}.name`)}
                  loading="lazy"
                  className="h-20 w-full object-contain transition-transform duration-200 group-hover:-translate-y-1"
                />
                <figcaption className="mt-2 text-center font-medieval text-[11px] tracking-wide text-amber-200/90">
                  {t(`buildings.${building.key}.name`)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Three steps */}
        <section
          id="how-to-play"
          className="scroll-mt-20 border-y border-amber-900/30 bg-slate-900/30 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <p className={EYEBROW}>{t('landing.steps.eyebrow')}</p>
              <h2 className="mt-3 font-medieval text-3xl font-bold tracking-wide text-slate-50 sm:text-4xl">
                {t('landing.steps.title')}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
                {t('landing.steps.subtitle')}
              </p>
            </div>

            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {STEPS.map((key, index) => (
                <li key={key} className={`${CARD} relative p-6`}>
                  <span className="font-medieval text-4xl font-bold text-amber-600/30" aria-hidden>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-2 font-medieval text-lg font-bold tracking-wide text-amber-100">
                    {t(`landing.steps.${key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {t(`landing.steps.${key}.body`)}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex justify-center">
              <RouteLink
                to={PLAY_PATH}
                className="aoe-button aoe-button-primary inline-flex min-h-[48px] items-center gap-2 px-7 text-sm font-bold uppercase tracking-wider text-slate-950"
              >
                {hasSession ? t('landing.hero.continue') : t('landing.steps.cta')}
                <ArrowRight size={16} aria-hidden />
              </RouteLink>
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="relative overflow-hidden py-20">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(180,120,40,0.18),transparent_65%)]"
          />
          <img
            aria-hidden
            src="/assets/buildings/town_center.png"
            alt=""
            loading="lazy"
            className="pointer-events-none absolute -bottom-16 right-[-40px] hidden w-[420px] opacity-15 lg:block"
          />
          <div className="relative mx-auto max-w-3xl px-4 text-center">
            <Crown size={30} className="mx-auto text-amber-400" aria-hidden />
            <h2 className="mt-4 font-medieval text-3xl font-bold tracking-wide text-slate-50 sm:text-4xl">
              {t('landing.final.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              {t('landing.final.subtitle')}
            </p>
            <RouteLink
              to={PLAY_PATH}
              className="aoe-button aoe-button-primary mt-8 inline-flex min-h-[52px] items-center gap-2 px-8 text-sm font-bold uppercase tracking-wider text-slate-950"
            >
              <Play size={17} aria-hidden />
              {hasSession ? t('landing.hero.continue') : t('landing.final.cta')}
            </RouteLink>
            <p className="mt-4 text-xs text-slate-500">{t('landing.final.note')}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-amber-900/30 bg-slate-950 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-amber-300/90">
            <Swords size={16} aria-hidden />
            <span className="font-medieval text-sm font-bold tracking-[0.18em]">CHIẾN QUỐC</span>
            <span className="text-xs text-slate-500">{t('landing.footer.tagline')}</span>
          </div>
          <div className="space-y-1 text-xs text-slate-500 sm:text-right">
            <p>{t('landing.footer.credits')}</p>
            <p>{t('landing.footer.rights')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
