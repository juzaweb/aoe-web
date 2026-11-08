import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TC_PLATFORM_ORIGIN_X,
  TC_PLATFORM_ORIGIN_Y,
  TC_PLATFORM_RISE,
  TC_PLATFORM_TEXTURE,
  townCenterLift
} from './townCenterPlatform.js';

const hasTexture = (key: string) => key === TC_PLATFORM_TEXTURE;
const platformPng = fs.readFileSync(
  fileURLToPath(new URL('../../../public/assets/citadel/tc_platform.png', import.meta.url))
);

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
  it('keeps the rise in step with scripts/process_citadel_assets.py', () => {
    // Literal on purpose: reading the constant back would hide exactly the
    // drift this guard exists to catch (the client once shipped 48 against a
    // 112 px terrace).
    expect(TC_PLATFORM_RISE).toBe(112);
  });

  it('anchors on the top-face centre of the shipped canvas', () => {
    // Read the real PNG instead of trusting a literal: if the generator changes
    // its canvas, this catches the client origin drifting out of step.
    expect(platformPng.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = platformPng.readUInt32BE(16);
    const height = platformPng.readUInt32BE(20);
    expect(width).toBe(784);
    expect(height).toBe(555);
    expect(TC_PLATFORM_ORIGIN_X * width).toBeCloseTo(392);
    expect(TC_PLATFORM_ORIGIN_Y * height).toBeCloseTo(200);
  });
});
