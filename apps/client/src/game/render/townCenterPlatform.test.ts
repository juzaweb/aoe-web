import { describe, expect, it } from 'vitest';
import {
  TC_PLATFORM_ORIGIN_X,
  TC_PLATFORM_ORIGIN_Y,
  TC_PLATFORM_RISE,
  TC_PLATFORM_TEXTURE,
  townCenterLift
} from './townCenterPlatform.js';

const hasTexture = (key: string) => key === TC_PLATFORM_TEXTURE;

describe('townCenterLift', () => {
  it('lifts only a Town Center that has a terrace to stand on', () => {
    expect(townCenterLift('TOWN_CENTER', hasTexture, true)).toBe(TC_PLATFORM_RISE);
  });

  it('leaves other buildings on the ground', () => {
    expect(townCenterLift('BARRACKS', hasTexture, true)).toBe(0);
    expect(townCenterLift('HOUSE', hasTexture, true)).toBe(0);
  });

  it('never lifts on the battlefield or when the terrace failed to load', () => {
    expect(townCenterLift('TOWN_CENTER', hasTexture, false)).toBe(0);
    expect(townCenterLift('TOWN_CENTER', () => false, true)).toBe(0);
  });
});

describe('terrace anchor', () => {
  it('anchors on the top-face centre of the shipped 784x555 canvas', () => {
    // `scripts/process_citadel_assets.py` must keep TC_ANCHOR in step; the
    // origin is the only number the client reads from that canvas.
    expect(TC_PLATFORM_ORIGIN_X * 784).toBeCloseTo(392);
    expect(TC_PLATFORM_ORIGIN_Y * 555).toBeCloseTo(200);
  });
});
