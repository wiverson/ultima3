import { describe, it, expect } from 'vitest';
import { newWorld } from './helpers.ts';
import { serialize, restore } from '../src/game/save.ts';
import { MapValue } from '../src/game/tiles.ts';
import { Location } from '../src/game/party.ts';
import { World } from '../src/game/world.ts';

describe('save and restore', () => {
  it('round-trips the party, roster, surface map and position', () => {
    const a = newWorld();
    a.x = 10;
    a.y = 11;
    a.member(0).gold = 999;
    a.putXYVal(MapValue.Frigate, 3, 4);
    a.moonPhase = [2, 6];
    a.windDirection = 3;

    const data = JSON.parse(JSON.stringify(serialize(a)));
    const b = new World(a.resources);
    expect(restore(b, data)).toBe(true);

    expect(b.x).toBe(10);
    expect(b.y).toBe(11);
    expect(b.member(0).gold).toBe(999);
    expect(b.member(0).name).toBe(a.member(0).name);
    expect(b.getXYVal(3, 4)).toBe(MapValue.Frigate);
    expect(b.moonPhase).toEqual([2, 6]);
    expect(b.windDirection).toBe(3);
    expect(b.party.location).toBe(Location.Sosaria);
  });

  it('saves a game in a town as the surface square it was entered from', () => {
    const a = newWorld();
    a.returnX = 46;
    a.returnY = 19;
    a.party.location = Location.Town;
    a.enterMap(402);
    a.x = 5;
    a.y = 32;
    const b = new World(a.resources);
    expect(restore(b, serialize(a))).toBe(true);
    expect(b.party.location).toBe(Location.Sosaria);
    expect(b.x).toBe(46);
    expect(b.y).toBe(19);
    expect(b.current).toBe(b.surface);
  });

  it('rejects data from another version', () => {
    const a = newWorld();
    const data = serialize(a);
    data.version = 99;
    expect(restore(new World(a.resources), data)).toBe(false);
  });
});
