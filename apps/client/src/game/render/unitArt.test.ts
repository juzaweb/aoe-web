import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_ART,
  UNIT_ART,
  actionFrameCount,
  hasDirectionalArt,
  resolveActionFrames,
  unitArt,
  unitClips,
  unitSheets
} from './unitArt.js';

describe('unitArt', () => {
  it('falls back to the legacy geometry for an unknown unit type', () => {
    expect(unitArt('NOT_A_UNIT')).toBe(DEFAULT_UNIT_ART);
  });

  it('gives every configured unit a non-empty sheet size', () => {
    for (const [type, art] of Object.entries(UNIT_ART)) {
      expect(art.frameWidth, type).toBeGreaterThan(0);
      expect(art.frameHeight, type).toBeGreaterThan(0);
      expect(art.scale, type).toBeGreaterThan(0);
    }
  });

  it('gives every unit that ships a directional walk more than one frame', () => {
    const walkers = Object.keys(UNIT_ART).filter((type) => hasDirectionalArt(type));
    expect(walkers.length).toBeGreaterThan(0);
    for (const type of walkers) {
      expect(actionFrameCount(type, 'walk'), type).toBeGreaterThan(1);
    }
  });
});

describe('unitSheets', () => {
  it('lists one file per distinct sheet, not one per action', () => {
    // The villager aliases gather and build onto the attack sheet, so its six
    // actions must ask the client for four files.
    const sheets = unitSheets('VILLAGER');
    const actions = sheets.map((sheet) => sheet.sheetAction);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toEqual(['idle', 'walk', 'attack', 'death']);
  });

  it('reports the frame count of the sheet a file holds', () => {
    const byAction = new Map(unitSheets('VILLAGER').map((sheet) => [sheet.sheetAction, sheet.frames]));
    expect(byAction.get('walk')).toBe(11);
    expect(byAction.get('idle')).toBe(4);
  });

  it('asks for nothing when a unit ships no directional art', () => {
    expect(unitSheets('CAVALRY')).toEqual([]);
  });

  it('asks for one file per action on a soldier, none of them aliased', () => {
    for (const type of ['SPEARMAN', 'ARCHER']) {
      expect(unitSheets(type).map((sheet) => sheet.sheetAction), type).toEqual([
        'idle',
        'walk',
        'attack',
        'death'
      ]);
    }
  });
});

describe('unitClips', () => {
  it('registers a clip per action, including aliased ones', () => {
    const actions = unitClips('VILLAGER').map((clip) => clip.action);
    expect(actions).toEqual(['idle', 'walk', 'attack', 'death', 'gather', 'build']);
  });

  it('points an aliased action at the sheet it borrows', () => {
    const clips = new Map(unitClips('VILLAGER').map((clip) => [clip.action, clip]));
    expect(clips.get('gather')?.sheetAction).toBe('attack');
    expect(clips.get('build')?.sheetAction).toBe('attack');
    expect(clips.get('walk')?.sheetAction).toBe('walk');
  });

  it('takes the frame rate override when a unit sets one', () => {
    const clips = new Map(unitClips('VILLAGER').map((clip) => [clip.action, clip]));
    expect(clips.get('walk')?.frameRate).toBe(16);
    expect(clips.get('idle')?.frameRate).toBe(4);
  });

  it('plays death once and loops the rest', () => {
    const clips = new Map(unitClips('VILLAGER').map((clip) => [clip.action, clip]));
    expect(clips.get('death')?.repeat).toBe(0);
    for (const action of ['idle', 'walk', 'attack', 'gather', 'build'] as const) {
      expect(clips.get(action)?.repeat, action).toBe(-1);
    }
  });

  it('gives every clip a positive frame count', () => {
    for (const type of Object.keys(UNIT_ART)) {
      for (const clip of unitClips(type)) {
        expect(clip.frames, `${type}.${clip.action}`).toBeGreaterThan(1);
      }
    }
  });

  it('reads an aliased clip length from the action it replays', () => {
    // gather/build restate no frame count, so they must report attack's.
    const clips = new Map(unitClips('VILLAGER').map((clip) => [clip.action, clip]));
    expect(clips.get('gather')?.frames).toBe(clips.get('attack')?.frames);
    expect(clips.get('build')?.frames).toBe(clips.get('attack')?.frames);
  });
});

describe('actionFrameCount', () => {
  it('resolves an alias to the replayed action', () => {
    expect(actionFrameCount('VILLAGER', 'gather')).toBe(actionFrameCount('VILLAGER', 'attack'));
    expect(actionFrameCount('VILLAGER', 'walk')).toBe(11);
  });

  it('throws when the unit ships no such action', () => {
    expect(() => actionFrameCount('VILLAGER', 'idle')).not.toThrow();
    expect(() => actionFrameCount('CAVALRY', 'walk')).toThrow(/no art for action/);
  });

  it('throws instead of looping on an alias cycle', () => {
    // A literal table, so the failure mode is tested without touching UNIT_ART.
    const cyclic = { attack: { alias: 'gather' as const }, gather: { alias: 'attack' as const } };
    expect(() => resolveActionFrames(cyclic, 'attack')).toThrow(/alias cycle/);
  });
});

describe('hasDirectionalArt', () => {
  it('is true for every unit drawn from the pack, false for the legacy sheet', () => {
    expect(hasDirectionalArt('VILLAGER')).toBe(true);
    expect(hasDirectionalArt('SPEARMAN')).toBe(true);
    expect(hasDirectionalArt('ARCHER')).toBe(true);
    expect(hasDirectionalArt('CAVALRY')).toBe(false);
  });
});
