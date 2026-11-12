import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { TopOverlayStack } from './TopOverlayStack.js';

describe('TopOverlayStack', () => {
  it('renders one non-interactive column so clicks fall through to the map', () => {
    const html = renderToString(
      <TopOverlayStack>
        <div>first</div>
        <div>second</div>
      </TopOverlayStack>
    );

    expect(html).toContain('data-top-overlay-stack');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('flex-col');
    expect(html).toContain('gap-1.5');
    expect(html).toContain('z-50');
    // The stack must not reorder anything: priority is the caller's contract.
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('second'));
  });

  it('anchors under the compact citadel row on touch and at the HUD edge on desktop', () => {
    const compact = renderToString(
      <TopOverlayStack compact>
        <div />
      </TopOverlayStack>
    );
    const desktop = renderToString(
      <TopOverlayStack>
        <div />
      </TopOverlayStack>
    );

    expect(compact).toContain('top-[calc(env(safe-area-inset-top)+4.75rem)]');
    expect(desktop).toContain('top-16');
    expect(desktop).not.toContain('env(safe-area-inset-top)');
  });
});

/**
 * `App` owns the three banners but has no render harness in this suite (it
 * mounts a Phaser game and a Colyseus room), so the wiring is guarded by a
 * source scan — the same thing a reviewer would check, run on every commit.
 */
describe('App top-centre wiring (UIX-08 / UIX-10)', () => {
  const appSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx'),
    'utf8'
  );

  it('mounts every banner inside the one stack', () => {
    expect(appSource).toContain('<TopOverlayStack');
    // One stack, one mount point: a second standalone banner is exactly the
    // regression this slice removed.
    expect(appSource.match(/<TopOverlayStack/g)).toHaveLength(1);
    expect(appSource.match(/<PlacementBanner/g)).toHaveLength(1);
    expect(appSource.match(/<RejectNotification/g)).toHaveLength(1);
  });

  it('announces the under-attack banner assertively and hides its icon', () => {
    expect(appSource).toContain('role="alert"');
    expect(appSource).toContain('aria-live="assertive"');
    expect(appSource).toContain('aria-hidden="true"');
  });

  it('stamps every notification with a new sequence so repeats are re-read', () => {
    expect(appSource).toMatch(/seq:\s*\+\+notificationSeqRef\.current/);
    expect(appSource).toContain('seq={notification.seq}');
  });

  it('leaves no banner with its own centred absolute offset', () => {
    // `absolute ... left-1/2 -translate-x-1/2` on a banner is the collision this
    // slice fixed: the stack is the only element allowed to centre itself.
    expect(appSource).not.toMatch(/absolute[^`\n]*\$\{notification \? 'top-24' : 'top-16'\}/);
    const selfCentred = appSource
      .split('\n')
      .filter((line) => line.includes('className=') && line.includes('absolute') && line.includes('left-1/2'));
    expect(selfCentred).toHaveLength(0);
  });
});
