/**
 * commands.ts
 *
 * The player's keyboard commands. Each function is a port of the matching
 * routine in UltimaMain.c (`North()`, `Board()`, `Enter()` ...). They print
 * their own feedback and mutate the world; the game loop runs the end-of-turn
 * processing afterwards.
 *
 * Commands that belong to later phases of the port (combat, spells, shops,
 * dungeons, stats screens) are represented by `notYetPorted()` so the key
 * still produces sensible feedback.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { MapValue, Shape, MapValue as MV } from './tiles.ts';
import { type GameIO, Key, Sound } from './io.ts';

/** 1-based indices into the Messages string table. Names match the text. */
export const Msg = {
  Dismount: 17,
  Pass: 23,
  North: 24,
  South: 25,
  East: 26,
  West: 27,
  Board: 29,
  MountHorse: 30,
  BoardFrigate: 31,
  Descend: 32,
  Enter: 33,
  EnterDungeon: 34,
  EnterTown: 35,
  EnterCastle: 36,
  Klimb: 68,
  Look: 69,
  Exit: 102,
  ExitCraft: 103,
  What: 106,
  ArrowWhat: 107,
  NotHere: 108,
  InvalidMove: 116,
  Southwest: 250,
  Southeast: 251,
  Northwest: 252,
  Northeast: 253,
} as const;

/** Party shapes (`Party[1]`). */
export const PartyShape = {
  OnFoot: 0x7e,
  Horse: 0x14,
  Frigate: 0x16,
  Whirlpool: 0x18,
} as const;

// ---------------------------------------------------------------------------
// Small shared responses
// ---------------------------------------------------------------------------

/** "WHAT?" - the command made no sense. (`What`) */
export function what(io: GameIO): void {
  io.printMessage(Msg.What);
  io.sound('Error2');
}

/** "<-WHAT?" - the command made no sense here. (`What2`) */
export function what2(io: GameIO): void {
  io.printMessage(Msg.ArrowWhat);
  io.sound(Sound.Error1);
}

/** "Not here!" (`NotHere`) */
export function notHere(io: GameIO): void {
  io.printMessage(Msg.NotHere);
  io.sound(Sound.Error1);
}

/** "INVALID MOVE!" with a bump. (`NoGo`) */
export function noGo(io: GameIO): void {
  io.printMessage(Msg.InvalidMove);
  io.sound(Sound.Bump);
  io.flushKeys();
}

/** Placeholder for commands that later phases of the port will supply. */
export function notYetPorted(io: GameIO, name: string): void {
  io.print(`${name}\nNot yet ported\n`);
  io.sound(Sound.Error1);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Compass directions as the wind code numbers them: 1 north, 2 east, 3 south, 4 west. */
type Compass = 1 | 2 | 3 | 4;

/**
 * Mirrors `ValidTrans()`: a frigate cannot sail directly into the wind.
 * (Once Exodus is destroyed the wind no longer matters.)
 */
export function validTrans(world: World, dir: Compass): boolean {
  if (world.party.exodusDestroyed) return true;
  if (world.party.shape === PartyShape.Frigate && world.windEnabled) {
    return world.windDirection === 0 || dir !== world.windDirection;
  }
  return true;
}

/**
 * Mirrors `ValidDir()`: may the party step onto a square with this map
 * value? Also applies the side effects of trying: forcefields and lava
 * damage anyone without the protecting Mark, and footsteps make a sound.
 */
export async function validDir(world: World, io: GameIO, value: number): Promise<boolean> {
  if (world.party.shape === PartyShape.Frigate) {
    return value === MapValue.Water || value === MapValue.Whirlpool;
  }

  let goodPlace = false;
  if (value === MapValue.ForceField) {
    await io.flashTiles();
    io.sound(Sound.ForceField);
    for (let m = 0; m < 4; m++) {
      if (world.party.memberSlot(m) < 0) continue;
      const p = world.member(m);
      if (!(p.marks & 0x10)) {
        // No Mark of Force: the first unprotected member takes 99 damage and the party is stopped.
        if (p.subtractHitPoints(99)) io.sound(p.sex === 'F' ? Sound.DeathFemale : Sound.DeathMale);
        await io.flashMember(m);
        io.sound(Sound.Hit);
        await io.flashTiles();
        goodPlace = false;
        break;
      }
      goodPlace = true;
    }
  }
  if (value === MapValue.Lava) {
    goodPlace = true;
    io.sound(Sound.Attack);
    for (let m = 0; m < 4; m++) {
      if (world.party.memberSlot(m) < 0) continue;
      const p = world.member(m);
      if (!(p.marks & 0x20) && p.alive) {
        if (p.subtractHitPoints(50)) io.sound(p.sex === 'F' ? Sound.DeathFemale : Sound.DeathMale);
        await io.flashMember(m);
        io.sound(Sound.Hit);
      }
    }
  }
  if (value === MapValue.MoonGate || value === MapValue.Shrine) value = MapValue.Grass;
  if (value < MapValue.Whirlpool && value !== MapValue.Water && value !== MapValue.Mountains) {
    goodPlace = true;
    io.sound(world.party.shape === PartyShape.Horse ? Sound.HorseWalk : Sound.Step);
  }
  return goodPlace;
}

interface MoveSpec {
  dx: number;
  dy: number;
  message: number;
  /** Compass directions that must not be against the wind. */
  compass: Compass[];
}

const MOVES: Record<string, MoveSpec> = {
  north: { dx: 0, dy: -1, message: Msg.North, compass: [1] },
  south: { dx: 0, dy: 1, message: Msg.South, compass: [3] },
  east: { dx: 1, dy: 0, message: Msg.East, compass: [2] },
  west: { dx: -1, dy: 0, message: Msg.West, compass: [4] },
  northeast: { dx: 1, dy: -1, message: Msg.Northeast, compass: [1, 2] },
  southeast: { dx: 1, dy: 1, message: Msg.Southeast, compass: [2, 3] },
  southwest: { dx: -1, dy: 1, message: Msg.Southwest, compass: [3, 4] },
  northwest: { dx: -1, dy: -1, message: Msg.Northwest, compass: [1, 4] },
};

export type MoveName = keyof typeof MOVES;

/** Mirrors `North()`, `South()` ... `NorthWest()`. */
export async function move(world: World, io: GameIO, name: MoveName): Promise<void> {
  const spec = MOVES[name];
  if (spec.dx !== 0) world.horseFacingEast = spec.dx > 0;
  io.printMessage(spec.message);
  if (!spec.compass.every((c) => validTrans(world, c))) {
    noGo(io);
    return;
  }
  if (!(await validDir(world, io, world.getXYVal(world.x + spec.dx, world.y + spec.dy)))) {
    noGo(io);
    return;
  }
  world.x = world.constrain(world.x + spec.dx);
  world.y = world.constrain(world.y + spec.dy);
}

/** Map a key press to a movement, or undefined. Arrow keys and the numeric keypad both work. */
export function moveForKey(key: string, allowDiagonal = true): MoveName | undefined {
  switch (key) {
    case Key.Up:
    case '8':
      return 'north';
    case Key.Down:
    case '2':
      return 'south';
    case Key.Right:
    case '6':
      return 'east';
    case Key.Left:
    case '4':
      return 'west';
    case '7':
      return allowDiagonal ? 'northwest' : undefined;
    case '9':
      return allowDiagonal ? 'northeast' : undefined;
    case '1':
      return allowDiagonal ? 'southwest' : undefined;
    case '3':
      return allowDiagonal ? 'southeast' : undefined;
    default:
      return undefined;
  }
}

/**
 * Mirrors `GetDirection()`: after a command such as Look, wait for the
 * player to press a direction. Returns the adjacent square chosen.
 */
export async function getDirection(world: World, io: GameIO): Promise<{ xs: number; ys: number; dx: number; dy: number }> {
  for (;;) {
    const key = await io.waitKey();
    const name = moveForKey(key);
    if (!name) continue;
    const spec = MOVES[name];
    io.printMessage(spec.message);
    return { xs: world.x + spec.dx, ys: world.y + spec.dy, dx: spec.dx, dy: spec.dy };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Space bar. (`Pass`) */
export function pass(io: GameIO): void {
  io.printMessage(Msg.Pass);
}

/** B: mount a horse or board a ship the party is standing on. (`Board`) */
export function board(world: World, io: GameIO): void {
  if (world.party.shape !== PartyShape.OnFoot) {
    io.printMessage(Msg.Board);
    what2(io);
    return;
  }
  const here = world.getXYVal(world.x, world.y);
  if (here === MapValue.Horse) {
    world.putXYVal(MapValue.Grass, world.x, world.y);
    world.party.shape = PartyShape.Horse;
    io.printMessage(Msg.MountHorse);
    io.sound(Sound.MountHorse);
  } else if (here === MapValue.Frigate) {
    world.putXYVal(MapValue.Water, world.x, world.y);
    world.party.shape = PartyShape.Frigate;
    io.printMessage(Msg.BoardFrigate);
  } else {
    io.printMessage(Msg.Board);
    what2(io);
  }
}

/** X: leave the horse or ship, which stays behind on the map. (`Exit`) */
export function exit(world: World, io: GameIO): void {
  if (world.party.shape === PartyShape.OnFoot) {
    io.printMessage(Msg.Exit);
    io.printMessage(Msg.What);
    io.sound(Sound.Error1);
    return;
  }
  const here = world.getXYVal(world.x, world.y);
  if (here > MapValue.Grass) {
    // Only water (for a ship) or grass (for a horse) can hold the mount.
    io.printMessage(Msg.Exit);
    io.print('\n');
    notHere(io);
    return;
  }
  world.putXYVal(world.party.shape * 2, world.x, world.y);
  io.printMessage(world.party.shape === PartyShape.Horse ? Msg.Dismount : Msg.ExitCraft);
  world.party.shape = PartyShape.OnFoot;
}

/** L: name what is on an adjacent square. (`Look`) */
export async function look(world: World, io: GameIO): Promise<void> {
  io.printMessage(Msg.Look);
  const { xs, ys } = await getDirection(world, io);
  io.print('->');
  const value = world.getXYVal(xs, ys);
  const mon = world.monsters.at(world.constrain(xs), world.constrain(ys));
  const tiles = world.resources.strings.Tiles;
  const plurals = world.resources.strings.TilesPlural;
  if (mon < 0) {
    io.print(tiles[value >> 2] ?? '?');
  } else {
    // Monsters are named in the plural on the surface, singular in towns and castles.
    const plural = !world.inTownOrCastle;
    const type = world.monsters.type(mon) >> 1;
    const variant = world.monsters.variant(mon);
    const names = plural ? plurals : tiles;
    io.print(type > 44 && variant > 0 ? names[type - 46 + 63 + variant] : names[type >> 1]);
  }
  io.print('\n');
}

/**
 * E: enter the town, castle or dungeon the party is standing on. (`Enter`)
 * Ambrosia's shrines are also entered with E; that part is not yet ported.
 */
export function enter(world: World, io: GameIO): void {
  const loc = world.party.location;
  if (loc !== Location.Sosaria && loc !== Location.Ambrosia) {
    io.printMessage(Msg.Enter);
    what(io);
    return;
  }
  if (loc === Location.Ambrosia) {
    if (world.getXYVal(world.x, world.y) !== MV.Shrine) {
      io.printMessage(Msg.Enter);
      what2(io);
      return;
    }
    notYetPorted(io, 'Enter shrine');
    return;
  }

  const { locationX, locationY } = world.resources.misc;
  let place = -1;
  for (let i = 0; i < 32; i++) if (locationX[i] === world.x && locationY[i] === world.y) place = i;
  if (place < 0) {
    io.printMessage(Msg.Enter);
    what2(io);
    return;
  }

  world.party.surfaceX = world.x;
  world.party.surfaceY = world.y;
  world.returnX = world.x;
  world.returnY = world.y;

  const tile = world.getXYVal(world.x, world.y) >> 1;
  let newLocation: number;
  if (tile === Shape.Dungeon) {
    io.printMessage(Msg.Enter);
    io.printMessage(Msg.EnterDungeon);
    notYetPorted(io, 'Dungeons');
    return;
  } else if (tile === Shape.Town) {
    io.printMessage(Msg.Enter);
    io.printMessage(Msg.EnterTown);
    newLocation = Location.Town;
    world.x = 1;
    world.y = 32;
  } else if (tile === Shape.Castle) {
    io.printMessage(Msg.Enter);
    io.printMessage(Msg.EnterCastle);
    newLocation = Location.Castle;
    world.x = 32;
    world.y = 62;
  } else {
    what2(io);
    return;
  }

  world.enterMap(World.mapIdForLocation(place));
  world.party.location = newLocation;
  // Note: the original also ran `SafeExodus()` when entering Exodus' castle
  // after his defeat (it removes the traps). That belongs to the endgame phase.
}
