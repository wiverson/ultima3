import { describe, it, expect } from 'vitest';
import { DUNGEON_STYLES } from '../src/ui/dungeonArt.ts';
import { TILE_SETS } from '../src/ui/help.ts';
import { sheetRegions, DUNGEON_SHEET_WIDTH, DUNGEON_SHEET_HEIGHT } from '../src/ui/dungeonView.ts';

describe('dungeon art styles', () => {
  it('covers every tile set but Lairware, which keeps the photographic sheet', () => {
    for (const set of TILE_SETS) {
      if (set === 'Lairware') expect(DUNGEON_STYLES[set]).toBeUndefined();
      else expect(DUNGEON_STYLES[set], set).toBeDefined();
    }
    expect(DUNGEON_STYLES.Standard).toBe(DUNGEON_STYLES['PC VGA']);
  });

  it('gives wireframe styles a visible doorway, since a black door would vanish on a black wall', () => {
    for (const [name, style] of Object.entries(DUNGEON_STYLES)) {
      if (style.kind === 'wire' && style.bg === '#000') expect(style.doorLine, name).toBeDefined();
      if (style.kind === 'brick') expect(style.face, name).toBeDefined();
    }
  });

  it('describes a sheet whose pieces all lie inside it', () => {
    for (const r of sheetRegions()) {
      expect(r.sx, r.name).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.w, r.name).toBeLessThanOrEqual(DUNGEON_SHEET_WIDTH);
      expect(r.sy + r.h, r.name).toBeLessThanOrEqual(DUNGEON_SHEET_HEIGHT);
    }
  });
});
