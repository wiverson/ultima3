import { describe, it, expect } from 'vitest';
import { newWorld, FakeIO } from './helpers.ts';
import { healPlan, quickHeal, HEAL, GREAT_HEAL } from '../src/game/spells.ts';
import { commandMenu, QUICK_CAST_KEY } from '../src/game/context.ts';
import { COMMAND_MENUS } from '../src/ui/menus.ts';
import { MapValue } from '../src/game/tiles.ts';
import { World } from '../src/game/world.ts';

/**
 * The default party: 0 Tatiana (thief), 1 Roderic (ranger: cleric and
 * wizard spells), 2 Norric (cleric), 3 Ghiselle (wizard). Everyone starts
 * at 100 of 100 hit points.
 */
function party(): { world: World; io: FakeIO } {
  const world = newWorld();
  world.current.tiles.fill(MapValue.Grass);
  world.monsters.bytes.fill(0);
  for (let m = 0; m < 4; m++) world.member(m).mana = 0;
  return { world, io: new FakeIO(world.resources) };
}
const hurt = (world: World, m: number, gap: number) => (world.member(m).hitPoints = world.member(m).maxHitPoints - gap);

describe('the heal plan', () => {
  it('is nothing when nobody is hurt', () => {
    const { world } = party();
    world.member(2).mana = 60;
    expect(healPlan(world)).toBeNull();
  });

  it('is nothing when nobody with cleric spells can pay for a Heal', () => {
    const { world } = party();
    hurt(world, 0, 50);
    world.member(3).mana = 99; // the wizard has mana, but no cleric spells
    world.member(2).mana = 9; // the cleric is one short
    expect(healPlan(world)).toBeNull();
  });

  it('picks the member missing the most hit points, Great heal for a large wound, Heal for a small one', () => {
    const { world } = party();
    world.member(2).mana = 60;
    hurt(world, 0, 80);
    hurt(world, 1, 15);
    hurt(world, 3, 5);
    expect(healPlan(world)).toEqual({ caster: 2, spell: GREAT_HEAL, target: 0 });
    hurt(world, 0, 0);
    expect(healPlan(world)).toEqual({ caster: 2, spell: HEAL, target: 1 });
  });

  it('falls back to the other spell when only it can be afforded', () => {
    const { world } = party();
    hurt(world, 0, 80);
    world.member(2).mana = 12; // Great heal costs 50, Heal 10
    expect(healPlan(world)).toEqual({ caster: 2, spell: HEAL, target: 0 });
    hurt(world, 0, 5);
    world.member(2).mana = 55;
    world.member(2).hitPoints = 100;
    // A small wound with Heal affordable is a Heal, never a Great heal.
    expect(healPlan(world)?.spell).toBe(HEAL);
  });

  it('never targets the dead, and counts a poisoned member at full health as unhurt', () => {
    const { world } = party();
    world.member(2).mana = 60;
    world.member(0).status = 'D';
    world.member(0).hitPoints = 0;
    world.member(1).status = 'P';
    expect(healPlan(world)).toBeNull();
    hurt(world, 3, 30);
    expect(healPlan(world)?.target).toBe(3);
  });

  it('lets a ranger or druid cast the cleric spells, and prefers the caster with the most mana', () => {
    const { world } = party();
    hurt(world, 0, 10);
    world.member(1).mana = 30; // the ranger
    expect(healPlan(world)).toEqual({ caster: 1, spell: HEAL, target: 0 });
    world.member(2).mana = 40; // the cleric, now richer
    expect(healPlan(world)?.caster).toBe(2);
    world.member(2).status = 'D'; // a dead cleric cannot cast
    expect(healPlan(world)?.caster).toBe(1);
  });

  it('walks the example: Great heal on the fighter, then Heal on the next, then nothing', () => {
    const { world } = party();
    world.member(2).mana = 60;
    hurt(world, 0, 90); // the "fighter", worst off
    hurt(world, 1, 15);
    hurt(world, 3, 12);
    expect(healPlan(world)?.spell).toBe(GREAT_HEAL);
    world.member(2).mana -= 50; // cast it: 10 left
    hurt(world, 0, 0);
    expect(healPlan(world)).toEqual({ caster: 2, spell: HEAL, target: 1 });
    world.member(2).mana -= 10; // cast it: 0 left
    hurt(world, 1, 0);
    expect(healPlan(world)).toBeNull(); // Ghiselle is still hurt, but nobody can pay
  });
});

describe('the quick heal', () => {
  it('casts the plan at once: pays the caster, heals the target, asks nothing', async () => {
    const { world, io } = party();
    world.member(2).mana = 60;
    hurt(world, 0, 80);
    io.keys = []; // nothing to answer
    expect(await quickHeal(world, io)).toBe(true);
    expect(world.member(2).mana).toBe(10);
    expect(world.member(0).hitPoints).toBeGreaterThanOrEqual(40); // Great heal gives 20..100
    expect(io.output).toContain('Great heal for Tatiana');
    expect(io.output).toContain('SANCTU MANI');
    expect(world.lastSpell[2]).toBe(GREAT_HEAL);
  });

  it('does nothing, and says so, when there is no plan', async () => {
    const { world, io } = party();
    expect(await quickHeal(world, io)).toBe(false);
  });
});

describe('the field and dungeon menus', () => {
  it('lead with Cast (Heal) or Cast (Great heal) only while someone is hurt and someone can pay', () => {
    const { world } = party();
    const first = () => commandMenu(world, 'field', COMMAND_MENUS.field)[0];
    expect(first().key).not.toBe(QUICK_CAST_KEY);
    hurt(world, 0, 30);
    expect(first().key).not.toBe(QUICK_CAST_KEY); // hurt, but no mana anywhere
    world.member(2).mana = 60;
    expect(first().label).toBe('Cast (Great heal)');
    hurt(world, 0, 10);
    expect(first().label).toBe('Cast (Heal)');
    // Ahead of the surroundings' own suggestion too: stand on a real town square from the location table.
    world.x = world.resources.misc.locationX[1];
    world.y = world.resources.misc.locationY[1];
    world.putXYVal(MapValue.Town, world.x, world.y);
    const keys = commandMenu(world, 'field', COMMAND_MENUS.field).map((o) => o.key);
    expect(keys.slice(0, 2)).toEqual([QUICK_CAST_KEY, 'E']);
    // Dungeons the same.
    expect(commandMenu(world, 'dungeon', COMMAND_MENUS.dungeon)[0].label).toBe('Cast (Heal)');
  });
});
