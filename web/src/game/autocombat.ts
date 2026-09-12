/**
 * autocombat.ts
 *
 * Auto-combat: a port of LairWare's UltimaAutocombat.c. This is one of the
 * Macintosh additions rather than part of the Apple II game.
 *
 * The idea is the same as the original's: the AI never touches the fight
 * directly. Each turn it decides what the active member should do and
 * returns the keys a player would press to do it. Combat feeds those keys
 * to the normal prompts, so an automatic turn goes through exactly the same
 * code as a manual one. (The C version pushed the keys into its `Macro[]`
 * queue, which `GetKeyMouse` drained before reading the real keyboard.)
 *
 * The decision list, in priority order, per `AutoCombat()`:
 *  1. Nearly dead and in reach of a monster: step somewhere safe.
 *  2. Orcs and a wizard type: cast Repond once. Skeletons and a cleric
 *     type: cast Pontori once.
 *  3. A big threat and enough magic: the nameless wizard spell, or the
 *     cleric's ZXKUQYB against a bigger one.
 *  4. A cleric type with someone under 75 hit points: Sanctu on the weakest.
 *  5. A ranged weapon (or a wizard's Mittar): fire at a monster in line,
 *     else step to a square that lines one up next turn.
 *  6. A hand weapon: attack an adjacent monster, else step toward the nearest.
 *
 * The original had a "no diagonals" preference; this port always allows
 * diagonal moves, as the combat prompts do.
 */

import { World } from './world.ts';
import { Shape } from './tiles.ts';
import { Key } from './io.ts';
import { monsterAt } from './combat.ts';

/** Hit points below which a member is "nearly dead". */
const NEARLY_DEAD_HP = 50;
/** Hit points below which a cleric casts Sanctu on a member. */
const SANCTU_HP = 75;

/** Monster shapes that poison, and so count double as a threat. */
const POISONOUS = [0x1c, 0x3c, 0x38];
const ORCS = 0x30;
const SKELETONS = 0x32;
const DRAGONS = 0x3a;

/** Ranged weapons: sling, bow, +2 bow, +4 bow. */
const RANGED_WEAPONS = [3, 5, 9, 13];
const MAGIC_BOWS = [9, 13];

/** The keypad digit for a step of (dx, dy), or null for no movement. */
function directionKey(dx: number, dy: number): string | null {
  if (dx === -1 && dy === 1) return '1';
  if (dx === 0 && dy === 1) return '2';
  if (dx === 1 && dy === 1) return '3';
  if (dx === -1 && dy === 0) return '4';
  if (dx === 1 && dy === 0) return '6';
  if (dx === -1 && dy === -1) return '7';
  if (dx === 0 && dy === -1) return '8';
  if (dx === 1 && dy === -1) return '9';
  return null;
}

/** The eight neighbouring steps, orthogonal first as the original checked them. */
const NEIGHBOURS: [number, number][] = [
  [0, 1],
  [-1, 1],
  [1, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

/**
 * The planner for one member's turn. It is a class only so the helpers can
 * share the fight state and the predicted monster positions.
 */
class Planner {
  private readonly c;
  /** Where each monster is expected to be next turn (`futureMonX/Y`). */
  private readonly futureX: number[] = [];
  private readonly futureY: number[] = [];

  constructor(
    private readonly world: World,
    private readonly member: number,
  ) {
    this.c = world.combat!;
    this.setupNow();
  }

  /** Mirrors `AutoCombat()`: the keys to press, in the order to press them. */
  plan(): string[] {
    const { world, member, c } = this;
    const p = world.member(member);
    const careers = String.fromCharCode(...world.resources.misc.careerTable);
    const classIndex = careers.indexOf(p.classLetter);
    const isMulti = classIndex === 8 || classIndex === 10; // Druid, Ranger
    const isWizard = classIndex === 2 || classIndex === 6 || classIndex === 9 || isMulti; // Wizard, Lark, Alchemist
    const isCleric = classIndex === 1 || classIndex === 4 || classIndex === 7 || isMulti; // Cleric, Paladin, Illusionist
    const magic = p.mana;
    const me = c.members[member];
    const x = me.x;
    const y = me.y;

    // Multi-class members are asked "Cleric or Wizard?" after C.
    const wizardCast = (spellLetter: string) => (isMulti ? ['C', 'W', spellLetter] : ['C', spellLetter]);
    const clericCast = (spellLetter: string) => (isMulti ? ['C', 'C', spellLetter] : ['C', spellLetter]);

    // Nearly dead: run to a square no monster can reach.
    if (this.nearlyDead(member) && this.monsterCanAttack(x, y)) {
      for (const [dx, dy] of NEIGHBOURS) {
        if (!this.monsterCanAttack(x + dx, y + dy) && !this.occupied(x + dx, y + dy)) return [directionKey(dx, dy)!];
      }
      // Nowhere to run: fight on.
    }

    // Repond against orcs, Pontori against skeletons, once per fight.
    if (c.monsterShape === ORCS && !world.spellFlags.repond && isWizard) return wizardCast('A');
    if (c.monsterShape === SKELETONS && !world.spellFlags.pontori && isCleric) return clericCast('A');

    // The big spells when the threat is big.
    if (magic >= 75 && isWizard && this.threatValue() > 60) return wizardCast('P');
    if (magic >= 70 && isCleric && this.threatValue() > 80) return clericCast('O');

    // Sanctu for whoever needs it most.
    if (magic >= 10 && isCleric) {
      let lowestHp = 9999;
      let lowest = -1;
      for (let m = 0; m < 4; m++) {
        if (!world.memberAlive(m)) continue;
        const hp = world.member(m).hitPoints;
        if (hp < lowestHp) {
          lowestHp = hp;
          lowest = m;
        }
      }
      if (lowestHp < SANCTU_HP) return [...clericCast('C'), String(lowest + 1)];
    }

    // Ranged attacks: a missile weapon, or Mittar for a wizard without a magic bow.
    const weapon = p.bytes[48];
    const castMittar = magic >= 5 && isWizard && !MAGIC_BOWS.includes(weapon);
    if (RANGED_WEAPONS.includes(weapon) || castMittar) {
      this.setupNow();
      const dir = this.monsterLinedUp(x, y);
      if (dir !== null) return castMittar ? [...wizardCast('B'), dir] : ['A', dir];
      this.setupFuture();
      return [this.lineUpToMonster()];
    }

    // Hand to hand: a wounded member in the top half does not advance.
    if (this.nearlyDead(member) && y < 10) return [Key.Space];
    const adjacent = this.monsterNearby(x, y);
    if (adjacent !== null) return ['A', adjacent];
    this.setupFuture();
    return [this.dirToNearestMonster()];
  }

  /** Mirrors `ThreatValue()`: the experience value of the monsters left, doubled if they poison. */
  threatValue(): number {
    const { c, world } = this;
    const each = world.resources.misc.experience[(c.monsterShape >> 1) & 0x0f];
    let total = 0;
    for (const m of c.monsters) if (m.hp > 0) total += each;
    if (POISONOUS.includes(c.monsterShape)) total *= 2;
    return total;
  }

  /** Mirrors `MonsterNearby()`: the direction of an adjacent monster, or null. */
  monsterNearby(x: number, y: number): string | null {
    const order: [number, number][] = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    for (const [dx, dy] of order) if (monsterAt(this.c, x + dx, y + dy) >= 0) return directionKey(dx, dy)!;
    return null;
  }

  /** Mirrors `MonsterCanAttack()`: is (x, y) next to a monster, or in a dragon's line of fire? */
  monsterCanAttack(x: number, y: number): boolean {
    const { c } = this;
    for (const [dx, dy] of NEIGHBOURS) if (monsterAt(c, x + dx, y + dy) >= 0) return true;
    if (c.monsterShape === DRAGONS) {
      for (const m of c.monsters) {
        if (m.hp > 0 && Math.abs(m.x - x) === Math.abs(m.y - y)) return true;
      }
    }
    return false;
  }

  /** Mirrors `NearlyDead(who)` for one member. */
  nearlyDead(member: number): boolean {
    return this.world.member(member).hitPoints < NEARLY_DEAD_HP;
  }

  /** Mirrors `SetupNow()`: predict no movement. */
  setupNow(): void {
    for (let i = 0; i < 8; i++) {
      this.futureX[i] = this.c.monsters[i].x;
      this.futureY[i] = this.c.monsters[i].y;
    }
  }

  /**
   * Mirrors `SetupFuture()`: predict each monster's next step toward its
   * nearest member (diagonal, else vertical, else horizontal, else stay).
   */
  setupFuture(): void {
    const { c, world } = this;
    this.setupNow();
    for (let i = 0; i < 8; i++) {
      if (c.monsters[i].hp === 0) continue;
      let closest = -1;
      let closestDistance = 128;
      for (let m = 0; m < 4; m++) {
        if (!world.memberAlive(m)) continue;
        const d = Math.abs(this.futureX[i] - c.members[m].x) + Math.abs(this.futureY[i] - c.members[m].y);
        if (d < closestDistance) {
          closestDistance = d;
          closest = m;
        }
      }
      if (closest < 0) continue;
      const dx = Math.sign(c.members[closest].x - this.futureX[i]);
      const dy = Math.sign(c.members[closest].y - this.futureY[i]);
      const fx = this.futureX[i];
      const fy = this.futureY[i];
      let nx = fx + dx;
      let ny = fy + dy;
      if (this.futureOccupied(nx, ny)) {
        nx = fx;
        ny = fy + dy;
        if (this.futureOccupied(nx, ny)) {
          nx = fx + dx;
          ny = fy;
          if (this.futureOccupied(nx, ny)) {
            nx = fx;
            ny = fy;
          }
        }
      }
      this.futureX[i] = nx;
      this.futureY[i] = ny;
    }
  }

  /** Mirrors `FutureMonsterHere()`: a predicted monster, or a living member, at (x, y). */
  futureOccupied(x: number, y: number): boolean {
    const { c, world } = this;
    for (let i = 0; i < 8; i++) if (c.monsters[i].hp > 0 && this.futureX[i] === x && this.futureY[i] === y) return true;
    for (let m = 0; m < 4; m++) if (world.memberAlive(m) && c.members[m].x === x && c.members[m].y === y) return true;
    return false;
  }

  /** Mirrors `CombatCharHere()`: a member, or a square a member cannot stand on. */
  occupied(x: number, y: number): boolean {
    const { c } = this;
    if (x < 0 || x > 10 || y < 0 || y > 10) return true;
    const tile = c.tiles[y * 11 + x];
    if (tile !== Shape.Grass && tile !== Shape.Brush && tile !== Shape.Forest && tile !== Shape.Floor) return true;
    for (const m of c.members) if (m.x === x && m.y === y) return true;
    return false;
  }

  /** Mirrors `DirToNearestMonster()`: the key that heads toward the closest (predicted) monster. */
  dirToNearestMonster(): string {
    const { c } = this;
    const me = c.members[this.member];
    let closest = -1;
    let closestDistance = 128;
    for (let i = 0; i < 8; i++) {
      if (c.monsters[i].hp === 0) continue;
      const d = Math.abs(this.futureX[i] - me.x) + Math.abs(this.futureY[i] - me.y);
      if (d < closestDistance) {
        closestDistance = d;
        closest = i;
      }
    }
    if (closest < 0) return Key.Space;
    return this.autoMove(Math.sign(this.futureX[closest] - me.x), Math.sign(this.futureY[closest] - me.y));
  }

  /**
   * Mirrors `LineUpToMonster()`: step to a neighbouring square from which a
   * monster will be in line next turn, trying the square nearer the middle
   * of the arena first. (The original returned a step toward the monster
   * for the diagonal squares instead of a step onto them; this port steps
   * onto them, which is what the function's comment says it does.)
   */
  lineUpToMonster(): string {
    const me = this.c.members[this.member];
    const inward = me.x < 6 ? 1 : -1;
    const candidates: [number, number][] = [
      [inward, 0],
      [-inward, 0],
      [0, -1],
      [0, 1],
      [inward, -1],
      [inward, 1],
      [-inward, -1],
      [-inward, 1],
    ];
    for (const [dx, dy] of candidates) {
      if (this.monsterLinedUp(me.x + dx, me.y + dy) !== null) return this.autoMove(dx, dy);
    }
    return this.dirToNearestMonster();
  }

  /**
   * Mirrors `MonsterLinedUp()` for a target square: the direction from
   * (x, y) to the nearest predicted monster on the same row, column or
   * diagonal, or null when none is lined up.
   */
  monsterLinedUp(x: number, y: number): string | null {
    const { c } = this;
    let closest = -1;
    let closestDistance = 128;
    for (let i = 0; i < 8; i++) {
      if (c.monsters[i].hp === 0) continue;
      const fx = this.futureX[i];
      const fy = this.futureY[i];
      const inLine = fx === x || fy === y || Math.abs(x - fx) === Math.abs(y - fy);
      if (!inLine) continue;
      const d = Math.abs(fx - x) + Math.abs(fy - y);
      if (d < closestDistance) {
        closestDistance = d;
        closest = i;
      }
    }
    if (closest < 0) return null;
    return directionKey(Math.sign(this.futureX[closest] - x), Math.sign(this.futureY[closest] - y));
  }

  /**
   * Mirrors `AutoMoveChar()`: the key for a step of (dx, dy), or the best
   * free alternative beside it, or a pass when boxed in.
   */
  autoMove(dx: number, dy: number): string {
    const me = this.c.members[this.member];
    const free = (ddx: number, ddy: number) => !this.occupied(me.x + ddx, me.y + ddy);
    const key = (ddx: number, ddy: number) => directionKey(ddx, ddy) ?? Key.Space;
    if (free(dx, dy)) return key(dx, dy);
    let alternatives: [number, number][];
    if (dx === 0) {
      // Vertical blocked: try the diagonals beside it, then sideways.
      alternatives = [
        [1, dy],
        [-1, dy],
        [1, 0],
        [-1, 0],
      ];
    } else if (dy === 0) {
      // Horizontal blocked: try the diagonals beside it, then up and down.
      alternatives = [
        [dx, -1],
        [dx, 1],
        [0, -1],
        [0, 1],
      ];
    } else {
      // Diagonal blocked: try its two components.
      alternatives = [
        [0, dy],
        [dx, 0],
      ];
    }
    for (const [ax, ay] of alternatives) if (free(ax, ay)) return key(ax, ay);
    return Key.Space;
  }
}

/**
 * Decide the active member's turn. Returns the keys to press, in order, or
 * an empty list when there is no fight.
 */
export function autoCombatKeys(world: World, member: number): string[] {
  if (!world.combat) return [];
  return new Planner(world, member).plan();
}
