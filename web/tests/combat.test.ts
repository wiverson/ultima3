import { describe, it, expect } from 'vitest';
import { newWorld, FakeIO } from './helpers.ts';
import { combat, chooseArena, loadArena, planMonster, handleMove, memberShape, monsterName, attackMonster } from '../src/game/combat.ts';
import { MapValue, Shape } from '../src/game/tiles.ts';
import { Location } from '../src/game/party.ts';
import { Key } from '../src/game/io.ts';
import { BASERES } from '../src/data/resources.ts';
import { World } from '../src/game/world.ts';

function flatWorld(): { world: World; io: FakeIO } {
  const world = newWorld(42);
  world.current.tiles.fill(MapValue.Grass);
  world.monsters.bytes.fill(0);
  world.x = 32;
  world.y = 32;
  return { world, io: new FakeIO(world.resources) };
}

describe('arenas', () => {
  it('picks the arena from the terrain and the monster type', () => {
    const { world } = flatWorld();
    expect(chooseArena(world, MapValue.Orc >> 1).id).toBe(BASERES + 4); // grass
    world.putXYVal(MapValue.Forest, 32, 32);
    expect(chooseArena(world, MapValue.Orc >> 1).id).toBe(BASERES + 3);
    // Boarding a pirate frigate means fighting thieves.
    expect(chooseArena(world, 0x1e)).toEqual({ id: BASERES, monsterShape: 0x2e });
  });

  it('loads an arena with eight monster slots and four member slots', () => {
    const { world } = flatWorld();
    const c = loadArena(world, BASERES + 4);
    expect(c.tiles).toHaveLength(121);
    expect(c.monsters).toHaveLength(8);
    expect(c.members).toHaveLength(4);
    for (const m of c.members) expect(c.tiles[m.y * 11 + m.x]).toBe(Shape.Grass);
  });

  it('gives each class its arena figure', () => {
    const { world } = flatWorld();
    expect(memberShape(world, 'F')).toBe(0x80);
    expect(memberShape(world, 'C')).toBe(0x82);
    expect(memberShape(world, 'W')).toBe(0x84);
    expect(memberShape(world, 'T')).toBe(0x86);
    expect(memberShape(world, 'R')).toBe(0x7e);
  });

  it('names monsters and their variants', () => {
    const { world } = flatWorld();
    expect(monsterName(world, MapValue.Orc >> 1, 0, false)).toBe('Orc');
    expect(monsterName(world, MapValue.Orc >> 1, 1, true)).toBe('Goblins');
    expect(monsterName(world, MapValue.Orc >> 1, 2, false)).toBe('Troll');
  });
});

describe('monster planning', () => {
  it('steps toward the nearest member and reports adjacency', () => {
    const { world } = flatWorld();
    const c = loadArena(world, BASERES + 4);
    c.tiles.fill(Shape.Grass);
    world.combat = c;
    world.party.location = Location.Combat;
    c.members.forEach((m) => (m.x = m.y = 255));
    c.members[0].x = 5;
    c.members[0].y = 8;
    c.monsters[0].hp = 10;
    c.monsters[0].x = 5;
    c.monsters[0].y = 2;
    c.monsterShape = MapValue.Orc >> 1;
    const plan = planMonster(world, 0);
    expect(plan.target).toBe(0);
    expect(plan.newX).toBe(5);
    expect(plan.newY).toBe(3);
    expect(plan.distance).toBe(6);

    c.monsters[0].y = 7;
    expect(planMonster(world, 0).distance).toBe(0);
  });

  it('a member cannot walk into walls or other creatures', () => {
    const { world, io } = flatWorld();
    const c = loadArena(world, BASERES + 4);
    c.tiles.fill(Shape.Grass);
    world.combat = c;
    c.members[0].x = 5;
    c.members[0].y = 5;
    c.tiles[4 * 11 + 5] = Shape.Wall;
    handleMove(world, io, 0, 0, -1);
    expect(c.members[0].y).toBe(5);
    expect(io.output).toContain('INVALID MOVE!');
    handleMove(world, io, 0, 1, 0);
    expect(c.members[0].x).toBe(6);
    expect(io.sounds).toContain('Step');
  });
});

describe('a whole fight', () => {
  it('is won by attacking until the monsters die, and awards experience', async () => {
    const { world, io } = flatWorld();
    // Make the party strong so the fight is short.
    for (let m = 0; m < 4; m++) {
      const p = world.member(m);
      p.bytes[18] = 99; // strength
      p.bytes[19] = 99; // dexterity
      p.bytes[48] = 6; // sword
      p.bytes[54] = 1;
    }
    world.party.location = Location.Town; // one monster only
    world.current.tiles.fill(MapValue.Floor);
    const expBefore = world.member(0).bytes[31];

    // Each member's turn: attack toward the nearest living monster if adjacent, otherwise step toward it.
    io.keyProvider = () => {
      const c = world.combat;
      if (!c) return ' ';
      const me = c.members[c.activeMember];
      const alive = c.monsters.filter((m) => m.hp > 0);
      if (alive.length === 0) return ' ';
      const target = alive[0];
      const dx = Math.sign(target.x - me.x);
      const dy = Math.sign(target.y - me.y);
      const dirKey = dx === 0 ? (dy < 0 ? Key.Up : Key.Down) : dx < 0 ? Key.Left : Key.Right;
      if (Math.abs(target.x - me.x) <= 1 && Math.abs(target.y - me.y) <= 1 && (dx === 0 || dy === 0)) {
        io.keys.push(dirKey);
        return 'A';
      }
      return dirKey;
    };

    await combat(world, io, MapValue.Orc >> 1, 0);
    expect(world.combat).toBeNull();
    expect(world.party.location).toBe(Location.Town);
    expect(io.output).toContain('CONFLICT');
    expect(io.output).toContain('VICTORY');
    expect(io.output).toContain('KILLED! Exp.+');
    const totalExp = [0, 1, 2, 3].reduce((sum, m) => sum + world.member(m).bytes[31], 0);
    expect(totalExp).toBeGreaterThan(expBefore);
  });

  it('a monster on the map becomes a chest on the terrain it stood on', async () => {
    const { world, io } = flatWorld();
    const m = world.monsters;
    m.setType(0, MapValue.Orc);
    m.setTileUnder(0, MapValue.Brush);
    m.setPosition(0, 33, 32);
    m.setHp(0, 0xc0);
    world.putXYVal(MapValue.Orc, 33, 32);
    io.keyProvider = () => ' '; // everyone passes; the fight ends when the party dies or... we stop early
    // Kill the monsters as soon as the arena exists so the fight ends at once.
    const origRedraw = io.redrawMap.bind(io);
    io.redrawMap = () => {
      if (world.combat) world.combat.monsters.forEach((mon) => (mon.hp = 0));
      origRedraw();
    };
    await attackMonster(world, io, 0);
    expect(m.type(0)).toBe(0);
    expect(world.getXYVal(33, 32)).toBe(MapValue.Chest + 2); // chest on brush
    expect(io.output).toContain('VICTORY');
  });
});
