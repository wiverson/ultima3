/**
 * world.ts
 *
 * All mutable game state that is not part of the party or roster records:
 * the current map, its monster table, the party's position, the whirlpool,
 * the moons, the wind, and the timers used by the per-turn logic.
 *
 * The original kept the "current Sosaria" on disk (resource 419) and made an
 * in-memory backup (`PushSosaria`) before entering a town. This port keeps
 * the surface state in `World.surface` at all times. Entering a town loads
 * that town into `World.current`; leaving simply points `current` back at
 * `surface`. The effect is the same and there is nothing to push or pull.
 */

import { type GameResources, MapId, BASERES } from '../data/resources.ts';
import { MonsterTable } from './monsterTable.ts';
import { Party, Location, PARTY_RECORD_SIZE } from './party.ts';
import { Roster, PLAYER_RECORD_SIZE, ROSTER_SIZE } from './player.ts';
import { Random } from './random.ts';
import { MapValue } from './tiles.ts';

/** A loaded map plus the creatures living on it. */
export interface MapState {
  /** Resource ID (400..421). */
  id: number;
  /** Map edge length: 64 for every surface, town and castle map. */
  size: number;
  /** size * size map values, row major. */
  tiles: Uint8Array;
  monsters: MonsterTable;
  /** NPC dialogue for towns and castles; empty for Sosaria. */
  talk: Uint8Array;
}

/** The whirlpool that roams Sosaria. Saved with the surface map. */
export interface Whirlpool {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export class World {
  readonly rng: Random;
  readonly party: Party;
  readonly roster: Roster;

  /** Persistent overworld state. */
  surface: MapState;
  /** The map the party is on right now: `surface`, or a town/castle/dungeon. */
  current: MapState;
  whirlpool: Whirlpool = { x: 2, y: 0x3e, dx: 1, dy: 1 };
  /** Idle ticks until the whirlpool next moves. (`gWhirlCtr`) */
  whirlpoolTimer = 4;

  /** Party position on `current`. (`xpos`, `ypos` in the C source.) */
  x = 0;
  y = 0;

  /**
   * Where to reappear on Sosaria after leaving a town or castle.
   * (`zp[0xE3]`, `zp[0xE4]` in the C source.)
   */
  returnX = 0;
  returnY = 0;

  /**
   * Moon phases. `moonTimer` counts turns until the next phase change;
   * `moonPhase` is 0..7. Index 0 is Trammel (changes every 12 turns), index 1
   * is Felucca (every 4 turns). Felucca selects which moongate is open.
   */
  moonTimer: [number, number] = [12, 4];
  moonPhase: [number, number] = [4, 4];

  /** Wind: 0 calm, 1 north, 2 east, 3 south, 4 west. Blocks ships sailing into it. */
  windDirection = 0;
  windTimer = 0;
  /** Whether wind is simulated at all (a LairWare preference; the Apple II original had it). */
  windEnabled = true;

  /** Turn counters used by `ageChars()`. `gTime[0]` and `gTime[1]` in the C source. */
  ageTimer: [number, number] = [10, 9];

  /** Turns remaining during which monsters do not move (Negate Time). */
  timeNegate = 0;

  /** Alternates each turn while riding or sailing, halving monster movement. (`zp[0xCD]`) */
  private mountToggle = 0;

  /** Whether the party marker on horseback faces east. Cosmetic only. */
  horseFacingEast = false;

  /** Set when the game should stop (quit to menu). `gDone` in the C source. */
  done = false;

  constructor(
    public readonly resources: GameResources,
    seed?: number,
  ) {
    this.rng = new Random(seed);
    this.party = new Party(new Uint8Array(PARTY_RECORD_SIZE));
    this.roster = new Roster(new Uint8Array(PLAYER_RECORD_SIZE * ROSTER_SIZE));
    this.surface = this.loadMapState(MapId.Sosaria);
    this.current = this.surface;
  }

  // -------------------------------------------------------------------------
  // Map access. These mirror GetXYVal / PutXYVal / MapConstrain.
  // -------------------------------------------------------------------------

  get mapSize(): number {
    return this.current.size;
  }

  /** Wrap a coordinate onto the map. Sosaria wraps like a torus. */
  constrain(v: number): number {
    const n = this.current.size;
    return ((v % n) + n) % n;
  }

  /**
   * Read the map value at (x, y), wrapping around the edges. Off the edge of
   * a town, castle or dungeon the original reported grass so the party could
   * walk out. That case is handled by the caller checking `x === 0` etc.,
   * because the wrapped read still returns the far edge here as it did in C.
   */
  getXYVal(x: number, y: number): number {
    const { size, tiles } = this.current;
    const value = tiles[this.constrain(y) * size + this.constrain(x)];
    if (this.party.location !== Location.Sosaria && (x < 0 || x >= size || y < 0 || y >= size)) {
      return MapValue.Grass;
    }
    return value;
  }

  putXYVal(value: number, x: number, y: number): void {
    const { size, tiles } = this.current;
    tiles[this.constrain(y) * size + this.constrain(x)] = value;
  }

  get monsters(): MonsterTable {
    return this.current.monsters;
  }

  get onSurface(): boolean {
    return this.party.location === Location.Sosaria;
  }

  /** True inside a town or castle (the maps you leave by walking off the edge). */
  get inTownOrCastle(): boolean {
    const l = this.party.location;
    return l === Location.Town || l === Location.Castle;
  }

  // -------------------------------------------------------------------------
  // Loading maps
  // -------------------------------------------------------------------------

  /**
   * Build a fresh MapState from the pristine resources. Mirrors the parts of
   * `LoadUltimaMap()` that apply to surface, town and castle maps.
   *
   * A MAPS resource is: 1 byte edge length (0 means 256), then size*size
   * values. Sosaria carries four extra bytes: whirlpool x, y, dx, dy.
   */
  loadMapState(id: number): MapState {
    const raw = this.resources.maps.get(id);
    if (!raw) throw new Error(`no map resource ${id}`);
    const size = raw[0] === 0 ? 256 : raw[0];
    const tiles = raw.slice(1, 1 + size * size);

    const monsterBytes = this.resources.monsters.get(id) ?? new Uint8Array(256);
    const monsters = new MonsterTable(monsterBytes.slice());

    const talk = this.resources.talk.get(id) ?? new Uint8Array(256);

    if (id === MapId.Sosaria && raw.length >= 1 + size * size + 4) {
      const t = 1 + size * size;
      // dx/dy are signed bytes.
      this.whirlpool = { x: raw[t], y: raw[t + 1], dx: (raw[t + 2] << 24) >> 24, dy: (raw[t + 3] << 24) >> 24 };
    }
    return { id, size, tiles, monsters, talk: talk.slice() };
  }

  /** Enter a town, castle or dungeon: the current map becomes a fresh copy of it. */
  enterMap(id: number): void {
    this.current = this.loadMapState(id);
  }

  /** Return to the overworld. */
  returnToSurface(): void {
    this.current = this.surface;
  }

  /** Restore Sosaria to its pristine state (new game, or after resurrection). Mirrors `ResetSosaria()`. */
  resetSosaria(): void {
    this.surface = this.loadMapState(MapId.Sosaria);
    if (this.party.location === Location.Sosaria) this.current = this.surface;
  }

  /** Resource ID for the location table entry, mirroring `Enter()`: entries above 18 are Ambrosia's. */
  static mapIdForLocation(placeIndex: number): number {
    return placeIndex > 18 ? BASERES + placeIndex + 3 : BASERES + placeIndex;
  }

  // -------------------------------------------------------------------------
  // Party helpers
  // -------------------------------------------------------------------------

  /** Roster records of the up-to-four party members, in marching order. */
  members() {
    const out = [];
    for (let m = 0; m < 4; m++) {
      const slot = this.party.memberSlot(m);
      if (slot >= 0) out.push(this.roster.get(slot));
    }
    return out;
  }

  /** Roster record of member 0..3, even when that position is empty (slot 0 is then returned, as in C). */
  member(m: number) {
    return this.roster.get(Math.max(0, this.party.memberSlot(m)));
  }

  /** Mirrors `CheckAlive(member)`. */
  memberAlive(m: number): boolean {
    return this.party.memberSlot(m) >= 0 && this.member(m).alive;
  }

  /**
   * Start from the shipped default roster and party, as if the player had
   * just chosen "Form party" with the first four characters.
   */
  newGame(): void {
    this.party.bytes.set(this.resources.defaultParty);
    this.roster.bytes.set(this.resources.defaultRoster);
    for (let m = 0; m < this.party.size; m++) this.member(m).inParty = true;
    this.party.location = Location.Sosaria;
    this.party.shape = 0x7e;
    this.x = this.party.surfaceX;
    this.y = this.party.surfaceY;
    this.returnX = this.x;
    this.returnY = this.y;
    this.resetSosaria();
  }

  /**
   * Mirrors the `zp[0xCD]` toggle in `FinishAll()`: while on a horse or ship
   * monsters only get to act every other turn. Returns true on the skipped turns.
   */
  skipMonstersThisTurn(): boolean {
    const shape = this.party.shape;
    if (shape !== 0x14 && shape !== 0x16) return false;
    this.mountToggle = 255 - this.mountToggle;
    return this.mountToggle < 128;
  }

  /** Mirrors `ExodusCastle()`: true while the party is inside Exodus' castle and Exodus still lives. */
  inExodusCastle(): boolean {
    if (this.party.exodusDestroyed) return false;
    if (this.party.location !== Location.Castle) return false;
    return this.party.surfaceX === this.resources.misc.locationX[1];
  }
}
