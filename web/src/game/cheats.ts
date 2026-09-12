/**
 * cheats.ts
 *
 * The cheat menu behind Y on the help screen. Each cheat is a small change
 * to the world; the screen shows the list and applies the chosen one.
 * None of this existed in the original; it is a convenience for testing
 * and for players who want one.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { exitToSurface } from './turn.ts';
import type { GameIO } from './io.ts';

export interface Cheat {
  key: string;
  label: string;
  /** Whether the cheat makes sense right now (e.g. Exit dungeon only in a dungeon). */
  available(world: World): boolean;
  /** Apply it; returns a one-line confirmation. */
  apply(world: World, io: GameIO): string;
}

/** Lord British's doorstep, where a new party starts. */
const HOME_X = 42;
const HOME_Y = 20;

/**
 * Leave a dungeon by asking the dungeon loop to end; the game then returns
 * the party to the surface at `returnX/Y`, which is the dungeon's square
 * unless a cheat moved it.
 */
function leaveDungeon(world: World): void {
  world.dungeon.exit = true;
}

export const CHEATS: Cheat[] = [
  {
    key: 'R',
    label: 'Full restore',
    available: () => true,
    apply(world) {
      for (let m = 0; m < 4; m++) {
        if (world.party.memberSlot(m) < 0) continue;
        const p = world.member(m);
        p.status = 'G';
        p.hitPoints = p.maxHitPoints;
      }
      return 'Everyone is whole again.';
    },
  },
  {
    key: 'H',
    label: 'Go home (Lord British)',
    available: (world) => world.party.location !== Location.Combat,
    apply(world, io) {
      if (world.party.location === Location.Dungeon) {
        world.returnX = HOME_X;
        world.returnY = HOME_Y;
        leaveDungeon(world);
      } else if (world.inTownOrCastle) {
        world.returnX = HOME_X;
        world.returnY = HOME_Y;
        exitToSurface(world, io);
      } else {
        world.x = world.party.surfaceX = HOME_X;
        world.y = world.party.surfaceY = HOME_Y;
        world.party.shape = 0x7e; // on foot: a horse or ship stays behind
      }
      return 'Back at the castle gate.';
    },
  },
  {
    key: 'X',
    label: 'Exit dungeon',
    available: (world) => world.party.location === Location.Dungeon,
    apply(world) {
      leaveDungeon(world);
      return 'Up and out.';
    },
  },
  {
    key: 'G',
    label: 'Get 100 gold',
    available: () => true,
    apply(world) {
      world.party.gold += 100;
      return `Gold: ${world.party.gold}.`;
    },
  },
  {
    key: 'T',
    label: 'Get 5 torches',
    available: () => true,
    apply(world) {
      const m = [0, 1, 2, 3].find((i) => world.party.memberSlot(i) >= 0 && world.memberAlive(i)) ?? 0;
      const p = world.member(m);
      p.torches = Math.min(99, p.torches + 5);
      return `${p.name} has ${p.torches} torches.`;
    },
  },
];
