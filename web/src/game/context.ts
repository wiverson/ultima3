/**
 * context.ts
 *
 * What the party is standing on or next to, turned into the commands most
 * likely wanted right now. Controller mode puts these at the top of the
 * command menu so the common case is one button press away: Enter on a
 * town, Board on a horse, Klimb on a ladder, and so on.
 *
 * Pure game logic; nothing here knows how menus are drawn.
 */

import { World, DungeonCell } from './world.ts';
import { Location } from './party.ts';
import { MapValue } from './tiles.ts';
import type { CommandScope } from './io.ts';
import { PartyShape, counterWithMerchant } from './commands.ts';
import { monsterAt } from './combat.ts';

/** The four orthogonal steps. */
const STEPS: [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** Command letters that fit the party's surroundings, most useful first. */
export function suggestedCommands(world: World, scope: CommandScope): string[] {
  switch (scope) {
    case 'combat':
      return combatSuggestions(world);
    case 'dungeon':
      return dungeonSuggestions(world);
    default:
      return fieldSuggestions(world);
  }
}

function fieldSuggestions(world: World): string[] {
  const out: string[] = [];
  const here = world.getXYVal(world.x, world.y);
  const shape = world.party.shape;
  const loc = world.party.location;

  if (loc === Location.Sosaria || loc === Location.Ambrosia) {
    if (here === MapValue.Town || here === MapValue.Castle || here === MapValue.Dungeon || here === MapValue.Shrine) out.push('E');
  }
  if (shape === PartyShape.OnFoot && (here === MapValue.Horse || here === MapValue.Frigate)) out.push('B');
  if (shape === PartyShape.Horse || shape === PartyShape.Frigate) out.push('X');
  // A chest left by a monster carries the terrain it stood on in its low bits.
  if (here >= MapValue.Chest && here <= MapValue.Chest + 3) out.unshift('G');

  // Things one step away.
  let person = false;
  let door = false;
  let monster = false;
  for (const [dx, dy] of STEPS) {
    const xs = world.constrain(world.x + dx);
    const ys = world.constrain(world.y + dy);
    const mon = world.monsters.at(xs, ys);
    if (world.inTownOrCastle) {
      if (mon >= 0 || counterWithMerchant(world, xs, ys, dx, dy)) person = true;
      if (dx !== 0 && world.getXYVal(xs, ys) === MapValue.LetterI) door = true;
    } else if (mon >= 0) {
      monster = true;
    }
  }
  if (monster) out.push('A');
  if (monster && shape === PartyShape.Frigate) out.push('F');
  if (person) out.push('T');
  if (door) out.push('U');
  return out;
}

function dungeonSuggestions(world: World): string[] {
  const out: string[] = [];
  const cell = world.getXYDng(world.x, world.y);
  if (cell < DungeonCell.Wall) {
    if (cell & DungeonCell.LadderUp) out.push('K');
    if (cell & DungeonCell.LadderDown) out.push('D');
    if (cell & DungeonCell.Chest) out.push('G');
  }
  if (world.dungeon.torch === 0) {
    for (let m = 0; m < world.party.size; m++) {
      if (world.memberAlive(m) && world.member(m).torches > 0) {
        out.push('I');
        break;
      }
    }
  }
  return out;
}

function combatSuggestions(world: World): string[] {
  const c = world.combat;
  if (!c) return [];
  const me = c.members[c.activeMember];
  const diagonals = world.diagonalMoves;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!diagonals && dx !== 0 && dy !== 0) continue;
      if (monsterAt(c, me.x + dx, me.y + dy) >= 0) return ['A'];
    }
  }
  return [];
}

/** Reorder menu options so the suggested keys come first, in suggestion order. */
export function prioritise<T extends { key: string }>(options: T[], suggested: string[]): T[] {
  const first = suggested.map((k) => options.find((o) => o.key === k)).filter((o): o is T => o !== undefined);
  return [...first, ...options.filter((o) => !first.includes(o))];
}
