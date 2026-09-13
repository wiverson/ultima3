/**
 * spells.ts
 *
 * Casting: a port of `Cast()`, `ProcessMagic()`, `Spell()` and the spell
 * effects from UltimaSpellCombat.c.
 *
 * Spell numbers follow the original: wizard spells are 0-15 (keys A-P),
 * cleric spells 16-31 (keys A-P), and three post-Exodus wizard extras 32-34
 * (keys Q, R, S: Terraform, Armageddon, Flotellum). A spell's cost is its
 * letter index times five magic points.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { MapValue, Shape } from './tiles.ts';
import { type GameIO, Sound, inputNumber, type MenuOption } from './io.ts';
import { getDirection } from './commands.ts';
import { shoot, showBall, damageMonster } from './combat.ts';
import { getChest, incapacitated } from './actions.ts';

const Msg = {
  CastByWhom: 119,
  Cancelled: 120,
  NotAMage: 121,
  MpTooLow: 122,
  SpellType: 123,
  ClericSpell: 124,
  WizardSpell: 125,
  CureWhom: 127,
  ResurrectWhom: 128,
  RecallWhom: 129,
  HealWhom: 130,
  Direction: 85,
  Failed: 86,
} as const;

/** Sound played by `Flashriek()` for each spell number. */
const SPELL_SOUNDS = [0, 1, 2, 3, 4, 1, 5, 1, 2, 7, 0, 1, 7, 0, 0, 0, 0, 7, 6, 2, 4, 3, 5, 6, 5, 2, 6, 7, 1, 6, 0, 6, 7, 0, 0];
const SOUND_NAMES = [
  Sound.BigDeath,
  Sound.Immolate,
  Sound.TorchIgnite,
  Sound.Downwards,
  Sound.Upwards,
  Sound.Invocation,
  Sound.Heal,
  Sound.MiscSpell,
];

const CANCELLED = -2;
const NOT_A_MAGE = -1;

/**
 * Mirrors `Cast()`. Outside combat `member` is undefined and the player is
 * asked who casts. Returns false if nothing was cast (so combat can ask
 * for another command).
 */
export async function cast(world: World, io: GameIO, member?: number): Promise<boolean> {
  if (member === undefined) {
    io.printMessage(Msg.CastByWhom);
    const n = await io.chooseMember();
    if (n < 1 || n > 4) return false;
    member = n - 1;
    if (!world.memberAlive(member)) {
      incapacitated(io);
      return false;
    }
  }
  const careers = String.fromCharCode(...world.resources.misc.careerTable);
  const classIndex = careers.indexOf(world.member(member).classLetter);
  let spell = NOT_A_MAGE;
  switch (classIndex) {
    case 1: // Cleric
    case 4: // Paladin
    case 7: // Illusionist
      spell = await chooseCleric(world, io);
      break;
    case 2: // Wizard
    case 6: // Lark
    case 9: // Alchemist
      spell = await chooseWizard(world, io);
      break;
    case 8: // Druid
    case 10: // Ranger
      spell = await chooseEither(world, io);
      break;
    default:
      break;
  }
  if (spell === CANCELLED) {
    io.printMessage(Msg.Cancelled);
    return false;
  }
  if (spell === NOT_A_MAGE) {
    io.printMessage(Msg.NotAMage);
    return false;
  }
  await processMagic(world, io, member, spell);
  return true;
}

/**
 * What each spell is called in plain words, for the menus, and what it
 * does, for the hint line. The Apple II showed only the spell-book names
 * (Mittar, Sanctu ...), which the manual explained; the hint keeps those
 * names alongside. Indexed by spell number; labels stay under 16
 * characters so they fit a menu over the map.
 */
const SPELL_INFO: { name: string; does: string }[] = [
  { name: 'Repel orcs', does: 'may destroy an orc pack, once a fight' },
  { name: 'Magic bolt', does: 'a bolt at one foe' },
  { name: 'Light', does: 'lights a dungeon for a while' },
  { name: 'Down a level', does: 'sink to the level below' },
  { name: 'Up a level', does: 'rise to the level above' },
  { name: 'Fireball', does: 'a strong bolt at one foe' },
  { name: 'Far teleport', does: 'a random spot on Sosaria' },
  { name: 'Mind bolt', does: 'a bolt as strong as your mind' },
  { name: 'Long light', does: 'lights a dungeon for a long time' },
  { name: 'Cleric spell', does: 'cast any cleric spell' },
  { name: 'Blast all foes', does: 'hurts every foe on the field' },
  { name: 'Death bolt', does: 'slays one foe' },
  { name: 'Stop time', does: 'foes stand still for twenty turns' },
  { name: 'Mind storm', does: 'hurts every foe, twice your mind' },
  { name: 'Weaken all', does: 'every foe drops to 5 hit points' },
  { name: 'Slay all foes', does: 'may slay every foe on the field' },
  { name: 'Repel undead', does: 'may destroy the undead, once a fight' },
  { name: 'Safe chest', does: 'opens a chest without its trap' },
  { name: 'Heal', does: 'heals one member a little' },
  { name: 'Light', does: 'lights a dungeon for a while' },
  { name: 'Up a level', does: 'rise to the level above' },
  { name: 'Down a level', does: 'sink to the level below' },
  { name: 'Near teleport', does: 'a random spot on this level' },
  { name: 'Cure poison', does: 'cures one member' },
  { name: 'Leave dungeon', does: 'straight out to the surface' },
  { name: 'Long light', does: 'lights a dungeon for a long time' },
  { name: 'Great heal', does: 'heals one member a lot' },
  { name: 'Show the map', does: 'a map, as a gem would show' },
  { name: 'Death bolt', does: 'slays one foe' },
  { name: 'Resurrect', does: 'raises the dead; may leave ashes' },
  { name: 'Slay all foes', does: 'may slay every foe on the field' },
  { name: 'Recall ashes', does: 'restores ashes, for 5 wisdom' },
  { name: 'Terraform', does: 'sets the square ahead to any tile' },
  { name: 'Armageddon', does: 'every creature becomes a chest' },
  { name: 'Conjure frigate', does: 'a frigate on the nearest water' },
];

/** Menu option for a spell: its letter and plain name, with the book name, cost and effect as the hint. */
function spellOption(world: World, spell: number, letter: string): MenuOption {
  const book = spell < 32 ? world.resources.strings.Spells[spell] : ['TERRAFORM', 'ARMAGEDDON', 'FLOTELLUM'][spell - 32];
  const cost = spell === 32 ? 10 : spell === 33 ? 85 : spell === 34 ? 90 : (spell & 0x0f) * 5;
  const info = SPELL_INFO[spell] ?? { name: book.trim() || '?', does: '' };
  return { key: letter, label: `${letter} ${info.name}`, hint: `${book.trim() || 'Nameless'} (${cost} mana): ${info.does}` };
}

async function chooseEither(world: World, io: GameIO): Promise<number> {
  io.printMessage(Msg.SpellType);
  const key = await io.chooseOption(
    [
      { key: 'W', label: 'Wizard spell' },
      { key: 'C', label: 'Cleric spell' },
    ],
    'line',
  );
  if (world.done) return CANCELLED;
  if (key === 'W') return chooseWizard(world, io);
  if (key === 'C') return chooseCleric(world, io);
  return CANCELLED;
}

async function chooseCleric(world: World, io: GameIO): Promise<number> {
  io.printMessage(Msg.ClericSpell);
  const key = await io.chooseOption(
    Array.from('ABCDEFGHIJKLMNOP', (l) => spellOption(world, l.charCodeAt(0) - 65 + 16, l)),
    'line',
  );
  if (!key || world.done) return CANCELLED;
  return key.charCodeAt(0) - 'A'.charCodeAt(0) + 16;
}

async function chooseWizard(world: World, io: GameIO): Promise<number> {
  io.printMessage(Msg.WizardSpell);
  const letters = world.party.exodusDestroyed ? 'ABCDEFGHIJKLMNOPQRS' : 'ABCDEFGHIJKLMNOP';
  const number = (l: string) => ({ Q: 32, R: 33, S: 34 })[l] ?? l.charCodeAt(0) - 65;
  const key = await io.chooseOption(
    Array.from(letters, (l) => spellOption(world, number(l), l)),
    'line',
  );
  if (!key || world.done) return CANCELLED;
  return number(key);
}

/** Mirrors `ProcessMagic()`: pay for the spell, announce it, cast it. */
export async function processMagic(world: World, io: GameIO, member: number, spell: number): Promise<void> {
  const p = world.member(member);
  let cost = (spell & 0x0f) * 5;
  if (spell === 32) cost = 10;
  if (spell === 33) cost = 85;
  if (spell === 34) cost = 90;
  if (cost > p.mana) {
    io.printMessage(Msg.MpTooLow);
    return;
  }
  p.mana -= cost;
  io.updateStats();
  io.print('\n');
  if (spell < 32) io.print(world.resources.strings.Spells[spell]);
  else io.print(['TERRAFORM', 'ARMAGEDDON', 'FLOTELLUM'][spell - 32]);
  io.print('\n\n');
  await spellEffect(world, io, member, spell);
}

/** Mirrors `Failed()`. */
export function failed(io: GameIO): void {
  io.printMessage(Msg.Failed);
  io.sound(Sound.FailedSpell);
}

/** Mirrors `Flashriek()`: flash the view and play the spell's sound. */
async function flashriek(io: GameIO, spell: number): Promise<void> {
  await io.flashTiles();
  io.sound(SOUND_NAMES[SPELL_SOUNDS[spell] ?? 7]);
  await io.flashTiles();
}

/** Mirrors `Spell()`: the effect of each spell. */
async function spellEffect(world: World, io: GameIO, member: number, spell: number): Promise<void> {
  if (world.done) return;
  const p = world.member(member);
  const inCombat = world.party.location === Location.Combat;
  const c = world.combat;

  switch (spell) {
    case 0: // Repond: destroys orcs (once per fight)
      if (!inCombat || !c || c.monsterShape !== 0x30 || world.spellFlags.repond) return failed(io);
      world.spellFlags.repond = true;
      if (world.rng.range(0, 255) < 128) return failed(io);
      return bigDeath(world, io, member, spell, 255);
    case 1: // Mittar
      return projectile(world, io, member, spell, world.rng.range(0, 40) | 0x10);
    case 2: // Lorum
    case 19: // Luminae
      world.dungeon.torch = 10;
      return flashriek(io, spell);
    case 3: // Dor Acron
    case 21: // Rec Du
      return downLevel(world, io, spell);
    case 4: // Sur Acron
    case 20: // Rec Su
      return upLevel(world, io, spell);
    case 5: // Fulgar
      return projectile(world, io, member, spell, 75);
    case 6: {
      // Dag Acron: teleport to a random spot on Sosaria
      await flashriek(io, spell);
      if (!world.onSurface || (world.party.shape === 0x16 && !world.party.exodusDestroyed)) return failed(io);
      const wanted = world.party.shape === 0x16 ? MapValue.Water : MapValue.Grass;
      let value = -1;
      while (value !== wanted) {
        world.x = world.rng.range(0, world.mapSize - 1);
        world.y = world.rng.range(0, world.mapSize - 1);
        value = world.getXYVal(world.x, world.y);
      }
      return;
    }
    case 7: // Mentar
      return projectile(world, io, member, spell, p.intelligence);
    case 8: // Dag Lorum
    case 25: // Sominae
      world.dungeon.torch = 250;
      return flashriek(io, spell);
    case 9: {
      // Fal Divi: cast any cleric spell
      await flashriek(io, spell);
      const chosen = await chooseCleric(world, io);
      if (chosen < 0) return;
      return processMagic(world, io, member, chosen);
    }
    case 10: // Noxum
      return bigDeath(world, io, member, spell, 75);
    case 11: // Decorp
    case 28: // Excuun
      return projectile(world, io, member, spell, 255);
    case 12: // Altair
      world.timeNegate = 20;
      return;
    case 13: // Dag Mentar
      return bigDeath(world, io, member, spell, p.intelligence * 2);
    case 14: // Necorp: every monster drops to 5 hit points
      return necorp(world, io, spell);
    case 15: // (nameless)
    case 30: // ZXKUQYB
      return bigDeath(world, io, member, spell, 255);
    case 16: // Pontori: destroys undead (once per fight)
      if (!inCombat || !c || c.monsterShape !== 0x32 || world.spellFlags.pontori) return failed(io);
      world.spellFlags.pontori = true;
      if (world.rng.range(0, 255) < 128) return failed(io);
      return bigDeath(world, io, member, spell, 255);
    case 17: // Appar Unem: open a chest safely
      await flashriek(io, spell);
      if ((world.rng.range(0, 255) & 0x03) === 0) return failed(io);
      world.chestTrapsArmed = false;
      return getChest(world, io, member, 'spell');
    case 18: // Sanctu
      return heal(world, io, spell, world.rng.range(0, 20) + 10);
    case 22: // Lib Rec: random spot on this dungeon level
      await flashriek(io, spell);
      if (world.party.location !== Location.Dungeon) return failed(io);
      return relocateInDungeon(world);
    case 23: {
      // Alcort: cure poison
      io.printMessage(Msg.CureWhom);
      const n = await io.chooseMember();
      if (n < 1 || n > 4) return failed(io);
      await io.flashMember(n - 1);
      await flashriek(io, spell);
      const target = world.member(n - 1);
      if (target.status !== 'P') return failed(io);
      target.status = 'G';
      return;
    }
    case 24: // Sequitu: leave the dungeon
      if (world.party.location !== Location.Dungeon) return failed(io);
      await flashriek(io, spell);
      world.dungeon.level = 0;
      world.dungeon.exit = true;
      return;
    case 26: // Sanctu Mani
      return heal(world, io, spell, world.rng.range(0, 80) + 20);
    case 27: // Vieda: show the map
      await flashriek(io, spell);
      if (world.party.location === Location.Dungeon) await io.showMiniDungeon();
      else await io.showMiniMap();
      return;
    case 29: {
      // Surmandum: resurrect
      if (inCombat) return failed(io);
      io.printMessage(Msg.ResurrectWhom);
      const n = await io.chooseMember();
      if (n < 1 || n > 4) return failed(io);
      await io.flashMember(n - 1);
      await flashriek(io, spell);
      const target = world.member(n - 1);
      if (target.status !== 'D') return failed(io);
      if ((world.rng.range(0, 255) & 0x03) === 0) {
        target.status = 'A';
        return failed(io);
      }
      target.status = 'G';
      return;
    }
    case 31: {
      // Anju Sermani: recall from ashes, at the cost of 5 wisdom
      if (inCombat) return failed(io);
      io.printMessage(Msg.RecallWhom);
      const n = await io.chooseMember();
      if (n < 1 || n > 4) return failed(io);
      await io.flashMember(n - 1);
      await flashriek(io, spell);
      const target = world.member(n - 1);
      if (target.status !== 'A') return failed(io);
      target.status = 'G';
      p.bytes[21] -= 5;
      return;
    }
    case 32: {
      // Terraform: place any tile (or creature) on an adjacent square
      if (inCombat) return failed(io);
      io.printMessage(Msg.Direction);
      const dir = await getDirection(world, io);
      if (!dir) return failed(io);
      io.print('TypeNum-');
      const value = await inputNumber(io);
      await flashriek(io, spell);
      const x = world.constrain(world.x + dir.dx);
      const y = world.constrain(world.y + dir.dy);
      if (value > 12 && value < 31) {
        const slot = world.monsters.freeSlot();
        if (slot >= 0) {
          world.monsters.setType(slot, value * 4);
          world.monsters.setTileUnder(slot, world.getXYVal(x, y));
          world.monsters.setPosition(slot, x, y);
          world.monsters.setHp(slot, 0x40);
          world.monsters.setVariant(slot, 0);
        }
      }
      world.putXYVal(value * 4, x, y);
      io.print('\n');
      return;
    }
    case 33: {
      // Armageddon: every creature on the map becomes a chest
      if (inCombat) return failed(io);
      await flashriek(io, spell);
      const m = world.monsters;
      for (let i = 0; i < 32; i++) {
        if (m.type(i) === 0) continue;
        let under = m.tileUnder(i);
        if (under !== 0) under = ((under >> 2) & 0x03) + MapValue.Chest;
        world.putXYVal(under, m.x(i), m.y(i));
        m.clear(i);
      }
      return;
    }
    case 34: {
      // Flotellum: conjure a frigate on the nearest water
      if (inCombat) return failed(io);
      let best = 99;
      let destX = -1;
      let destY = -1;
      for (let ty = -5; ty <= 5; ty++) {
        for (let tx = -5; tx <= 5; tx++) {
          if (tx === 0 && ty === 0) continue;
          if (world.getXYVal(world.x + tx, world.y + ty) !== MapValue.Water) continue;
          const d = Math.abs(tx) + Math.abs(ty);
          if (d < best) {
            best = d;
            destX = world.constrain(world.x + tx);
            destY = world.constrain(world.y + ty);
          }
        }
      }
      if (destX < 0) return failed(io);
      await flashriek(io, spell);
      world.putXYVal(MapValue.Frigate, destX, destY);
      return;
    }
    default:
      return;
  }
}

/** Mirrors `Projectile()`: a bolt in a chosen direction that damages the first monster hit. */
async function projectile(world: World, io: GameIO, member: number, spell: number, damage: number): Promise<void> {
  const c = world.combat;
  if (!c) return failed(io);
  io.printMessage(Msg.Direction);
  const dir = await getDirection(world, io);
  if (!dir) return failed(io);
  await flashriek(io, spell);
  const me = c.members[member];
  const hit = await shoot(world, io, me.x, me.y, dir.dx, dir.dy, Shape.MagicBall);
  if (hit < 0) return failed(io);
  io.sound(Sound.Hit);
  await showBall(world, io, c.monsters[hit].x, c.monsters[hit].y, Shape.MagicBall, true);
  damageMonster(world, io, hit, damage, member);
}

/** Mirrors `BigDeath()`: damage every monster, each with a 3 in 4 chance of being struck. */
async function bigDeath(world: World, io: GameIO, member: number, spell: number, damage: number): Promise<void> {
  const c = world.combat;
  if (!c) return failed(io);
  await flashriek(io, spell);
  for (let i = 7; i >= 0; i--) {
    if ((world.rng.range(0, 255) & 0x03) === 0) continue;
    const m = c.monsters[i];
    if (m.hp === 0) continue;
    io.sound(Sound.Hit);
    await showBall(world, io, m.x, m.y, Shape.MagicBall, true);
    damageMonster(world, io, i, damage, member);
  }
}

/** Mirrors `Necorp()`. */
async function necorp(world: World, io: GameIO, spell: number): Promise<void> {
  const c = world.combat;
  if (!c) return failed(io);
  await flashriek(io, spell);
  for (let i = 7; i >= 0; i--) {
    const m = c.monsters[i];
    if (m.hp === 0) continue;
    m.hp = 5;
    io.sound(Sound.Hit);
    await showBall(world, io, m.x, m.y, Shape.MagicBall, true);
  }
}

/** Mirrors `Heal()`. */
async function heal(world: World, io: GameIO, spell: number, amount: number): Promise<void> {
  io.printMessage(Msg.HealWhom);
  const n = await io.chooseMember();
  if (n < 1 || n > 4) return failed(io);
  world.member(n - 1).addHitPoints(amount);
  await io.flashMember(n - 1);
  await flashriek(io, spell);
  io.updateStats();
}

/** Mirrors `RelocateDungeon()`: a random open cell on the current level. */
export function relocateInDungeon(world: World): void {
  let value = -1;
  let xs = 0;
  let ys = 0;
  while (value !== 0) {
    xs = world.rng.range(0, 15);
    ys = world.rng.range(0, 15);
    value = world.getXYDng(xs, ys);
  }
  world.x = xs;
  world.y = ys;
}

/** Mirrors `DownLevel()`. */
async function downLevel(world: World, io: GameIO, spell: number): Promise<void> {
  if (world.party.location !== Location.Dungeon) return failed(io);
  await flashriek(io, spell);
  if (world.dungeon.level > 6) return failed(io);
  world.dungeon.level++;
  relocateInDungeon(world);
}

/** Mirrors `UpLevel()`: from the top level this leaves the dungeon. */
async function upLevel(world: World, io: GameIO, spell: number): Promise<void> {
  if (world.party.location !== Location.Dungeon) return failed(io);
  await flashriek(io, spell);
  world.dungeon.level--;
  if (world.dungeon.level < 0) {
    world.dungeon.level = 0;
    world.dungeon.exit = true;
    return;
  }
  relocateInDungeon(world);
}
