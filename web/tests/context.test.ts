import { describe, it, expect } from 'vitest';
import { newWorld } from './helpers.ts';
import { suggestedCommands, prioritise } from '../src/game/context.ts';
import { MapValue } from '../src/game/tiles.ts';
import { Location } from '../src/game/party.ts';
import { MapId } from '../src/data/resources.ts';
import { PartyShape } from '../src/game/commands.ts';
import { COMMAND_MENUS } from '../src/ui/menus.ts';
import { loadArena } from '../src/game/combat.ts';
import { BASERES } from '../src/data/resources.ts';
import { DungeonCell } from '../src/game/world.ts';

describe('contextual commands', () => {
  it('suggests Enter on a town and Board on a horse', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    expect(suggestedCommands(world, 'field')).toEqual([]);
    world.putXYVal(MapValue.Town, world.x, world.y);
    expect(suggestedCommands(world, 'field')).toEqual(['E']);
    world.putXYVal(MapValue.Horse, world.x, world.y);
    expect(suggestedCommands(world, 'field')).toEqual(['B']);
    world.party.shape = PartyShape.Horse;
    expect(suggestedCommands(world, 'field')).toEqual(['X']);
  });

  it('suggests Get first on a chest, whatever terrain it was left on', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    world.putXYVal(MapValue.Chest + 2, world.x, world.y); // a chest dropped on forest
    expect(suggestedCommands(world, 'field')).toEqual(['G']);
  });

  it('suggests Attack beside a monster, and Fire too from a frigate', () => {
    const world = newWorld();
    world.current.tiles.fill(MapValue.Grass);
    world.monsters.bytes.fill(0);
    const m = world.monsters;
    m.setType(0, MapValue.Orc);
    m.setPosition(0, world.x + 1, world.y);
    m.setHp(0, 0x80);
    expect(suggestedCommands(world, 'field')).toEqual(['A']);
    world.party.shape = PartyShape.Frigate;
    expect(suggestedCommands(world, 'field')).toEqual(['X', 'A', 'F']);
  });

  it('suggests Transact and Unlock in town', () => {
    const world = newWorld();
    world.enterMap(MapId.FirstTown);
    world.party.location = Location.Town;
    world.current.tiles.fill(MapValue.Floor);
    world.monsters.bytes.fill(0);
    world.x = 20;
    world.y = 20;
    world.putXYVal(MapValue.LetterA, 21, 20);
    world.putXYVal(MapValue.Merchant, 22, 20);
    world.putXYVal(MapValue.LetterI, 19, 20);
    expect(suggestedCommands(world, 'field')).toEqual(['T', 'U']);
  });

  it('suggests ladders, chests and a torch in a dungeon', () => {
    const world = newWorld();
    world.dungeon.tiles.fill(DungeonCell.Open);
    world.x = 3;
    world.y = 3;
    world.dungeon.level = 0;
    world.dungeon.torch = 5;
    world.putXYDng(DungeonCell.LadderDown | DungeonCell.Chest, 3, 3);
    expect(suggestedCommands(world, 'dungeon')).toEqual(['D', 'G']);
    world.dungeon.torch = 0;
    world.member(0).torches = 2;
    expect(suggestedCommands(world, 'dungeon')).toEqual(['D', 'G', 'I']);
  });

  it('suggests Attack in combat only when a monster is adjacent', () => {
    const world = newWorld();
    const c = loadArena(world, BASERES + 4);
    world.combat = c;
    c.activeMember = 0;
    c.members[0].x = 5;
    c.members[0].y = 5;
    for (const m of c.monsters) m.hp = 0;
    expect(suggestedCommands(world, 'combat')).toEqual([]);
    c.monsters[0].x = 6;
    c.monsters[0].y = 4;
    c.monsters[0].hp = 10;
    expect(suggestedCommands(world, 'combat')).toEqual([]); // diagonal: not in classic mode
    world.setClassicMoves(false);
    expect(suggestedCommands(world, 'combat')).toEqual(['A']);
  });

  it('moves suggested commands to the top of the menu without losing any', () => {
    const menu = prioritise(COMMAND_MENUS.field, ['B', 'E']);
    expect(menu.map((o) => o.key).slice(0, 2)).toEqual(['B', 'E']);
    expect(menu).toHaveLength(COMMAND_MENUS.field.length);
    expect(new Set(menu.map((o) => o.key)).size).toBe(COMMAND_MENUS.field.length);
  });
});
