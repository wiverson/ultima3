/**
 * actions.ts
 *
 * Commands that act on the party's own records rather than the world:
 * chests, handing equipment, joining gold, marching order, negate time,
 * peering at gems, readying weapons, wearing armour, torches, stats.
 * Ports of the matching routines in UltimaMain.c, plus `AddExp()`,
 * `AddGold()`, `AddItem()` and `StealDisarmFail()` from UltimaMisc.c.
 */

import { World } from './world.ts';
import { Location, GOLD_MAX } from './party.ts';
import { MapValue } from './tiles.ts';
import { type GameIO, Key, Sound, inputNumber, deathSound, type MenuOption } from './io.ts';
import { PlayerRecord } from './player.ts';

const Msg = {
  GetChest: 40,
  NoSuchPlayer: 41,
  AcidTrap: 42,
  PoisonTrap: 43,
  BombTrap: 44,
  GasTrap: 45,
  TrapEvaded: 46,
  Gold: 47,
  Overflowing: 48,
  AndA: 49,
  And: 50,
  HandFrom: 51,
  HandTo: 52,
  HandWhat: 53,
  Amount: 54,
  NotEnough: 55,
  TooMuch: 56,
  Done: 57,
  HandEquipmentWhat: 58,
  None: 59,
  HowMany: 60,
  WhichWeapon: 61,
  WhichArmour: 62,
  InUse: 63,
  IgniteTorch: 64,
  WhoseTorch: 65,
  JoinGoldTo: 66,
  NoneLeft: 67,
  ModifyOrder: 70,
  Aborted: 71,
  Plr: 72,
  Exchanged: 73,
  NegateTime: 74,
  PeerAtGem: 75,
  ReadyFor: 79,
  Weapon: 80,
  NotOwned: 81,
  NotAllowed: 82,
  Ready: 83,
  Volume: 97,
  VolumeOn: 98,
  VolumeOff: 99,
  WearFor: 100,
  Armour: 101,
  Ztats: 105,
  NotHere: 108,
  Incapacitated: 126,
} as const;

/** "Incapacitated!" - the chosen member is dead or otherwise unable. (`Incap`) */
export function incapacitated(io: GameIO): void {
  io.printMessage(Msg.Incapacitated);
  io.sound(Sound.Error1);
}

function notHere(io: GameIO): void {
  io.printMessage(Msg.NotHere);
  io.sound(Sound.Error1);
}

// ---------------------------------------------------------------------------
// Bookkeeping helpers
// ---------------------------------------------------------------------------

/** Mirrors `AddExp()`: experience is capped at 9899 and levels up every 100. */
export function addExperience(world: World, io: GameIO, member: number, amount: number): void {
  const p = world.member(member);
  let exp = p.bytes[30] * 100 + p.bytes[31];
  const oldLevel = Math.floor(exp / 100);
  exp = Math.min(9899, exp + amount);
  if (Math.floor(exp / 100) > oldLevel) io.sound(Sound.ExpLevelUp);
  p.bytes[30] = Math.floor(exp / 100);
  p.bytes[31] = exp % 100;
  io.updateStats();
}

/**
 * Mirrors `AddGold()`, on the party's pool. Returns false if the cap cut
 * the amount short; with `overflow` the surplus is simply lost, without it
 * nothing is added at all.
 */
export function addGold(world: World, gold: number, overflow: boolean): boolean {
  if (!overflow && world.party.gold + gold > GOLD_MAX) return false;
  return world.addGold(gold);
}

/** Mirrors `AddItem()`: item counts are capped at 99. */
export function addItem(p: PlayerRecord, offset: number, amount: number): void {
  p.bytes[offset] = Math.min(99, p.bytes[offset] + amount);
}

/**
 * Mirrors `StealDisarmFail()`: true if the attempt fails. Dexterity is the
 * base; thieves get a big bonus, barbarians, illusionists, rangers and
 * alchemists a smaller one.
 */
export function stealDisarmFails(world: World, p: PlayerRecord): boolean {
  const careers = String.fromCharCode(...world.resources.misc.careerTable);
  const classIndex = careers.indexOf(p.classLetter);
  let factor = p.dexterity;
  if (classIndex === 3) factor += 0x80;
  if (classIndex === 5 || classIndex === 7 || classIndex === 10 || classIndex === 9) factor += 0x40;
  return world.rng.range(0, 255) > factor;
}

/** Mirrors `BombTrap()`: every living member takes damage. */
export async function bombTrap(world: World, io: GameIO): Promise<void> {
  for (let m = 0; m < world.party.size; m++) {
    if (!world.memberAlive(m)) continue;
    const p = world.member(m);
    await io.flashMember(m);
    io.sound(Sound.Hit);
    let died = p.subtractHitPoints(world.rng.range(0, 255) & 0x77);
    died = p.subtractHitPoints((world.dungeon.level + 1) * 8) || died;
    if (died) io.sound(deathSound(p.sex));
  }
  io.updateStats();
}

// ---------------------------------------------------------------------------
// G: Get chest
// ---------------------------------------------------------------------------

/**
 * Mirrors `GetChest()`. `how` is "command" (ask who opens it and check for
 * traps), "spell" (Appar Unem: member chosen, traps disarmed) or "steal"
 * (Steal: skip straight to the loot).
 */
export async function getChest(world: World, io: GameIO, member: number, how: 'command' | 'spell' | 'steal'): Promise<void> {
  if (how === 'command') {
    world.chestTrapsArmed = true;
    io.printMessage(Msg.GetChest);
    const n = await io.chooseMember();
    if (n < 1 || n > 4) {
      io.printMessage(Msg.NoSuchPlayer);
      io.sound(Sound.Error1);
      return;
    }
    member = n - 1;
    if (!world.memberAlive(member)) return incapacitated(io);
  }
  const p = world.member(member);

  if (how !== 'steal') {
    if (world.party.location !== Location.Dungeon) {
      const tile = world.getXYVal(world.x, world.y);
      if (tile < MapValue.Chest || tile > MapValue.Chest + 3) return notHere(io);
      // The chest's low bits say what it sat on.
      let under = (tile & 0x3) * 4;
      if (under === 0) under = MapValue.Floor;
      world.putXYVal(under, world.x, world.y);
    } else {
      if (world.getXYDng(world.x, world.y) !== 0x40) return notHere(io);
      world.putXYDng(0, world.x, world.y);
    }

    if (world.chestTrapsArmed && world.rng.range(0, 255) <= 127) {
      const trap = world.rng.range(0, 255) & world.rng.range(0, 255) & 0x03;
      const evaded = () => {
        io.printMessage(Msg.TrapEvaded);
        io.sound(Sound.Ouch);
      };
      switch (trap) {
        case 0:
          io.printMessage(Msg.AcidTrap);
          if (!stealDisarmFails(world, p)) evaded();
          else {
            await io.flashMember(member);
            io.sound(Sound.Hit);
            if (p.subtractHitPoints(world.rng.range(0, 255) & 0x37)) io.sound(deathSound(p.sex));
          }
          break;
        case 1:
          io.printMessage(Msg.PoisonTrap);
          if (!stealDisarmFails(world, p)) evaded();
          else {
            await io.flashMember(member);
            io.sound(Sound.Hit);
            p.status = 'P';
          }
          break;
        case 2:
          io.printMessage(Msg.BombTrap);
          if (!stealDisarmFails(world, p)) evaded();
          else {
            await bombTrap(world, io);
            return;
          }
          break;
        default:
          io.printMessage(Msg.GasTrap);
          if (!stealDisarmFails(world, p)) evaded();
          else {
            for (let m = 0; m < 4; m++) {
              if (!world.memberAlive(m)) continue;
              await io.flashMember(m);
              io.sound(Sound.Hit);
              world.member(m).status = 'P';
            }
          }
          break;
      }
    }
  }

  // The loot.
  io.sound(Sound.Creak);
  let gold = world.rng.range(0, 100);
  if (gold < 30) gold += 30;
  io.printMessage(Msg.Gold);
  io.print(`${gold}\n`);
  if (!addGold(world, gold, true)) {
    io.printMessage(Msg.Overflowing);
    io.sound(Sound.Error1);
  }
  io.updateStats();
  if (world.rng.range(0, 255) > 63) return;

  const names = world.resources.strings.WeaponsArmour;
  let weapon = world.rng.range(0, 255);
  if (weapon < 128) {
    weapon = world.rng.range(0, 255) & weapon & 0x07;
    if (weapon !== 0) {
      io.printMessage(Msg.AndA);
      io.print(`${names[weapon]}\n`);
      addItem(p, 48 + weapon, 1);
      return;
    }
  }
  let armour = world.rng.range(0, 255);
  if (armour < 128) {
    armour = world.rng.range(0, 255) & armour & 0x03;
    if (armour !== 0) {
      io.printMessage(Msg.AndA);
      io.print(`${names[armour + 16]}\n`);
      addItem(p, 40 + armour, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// H: Hand equipment
// ---------------------------------------------------------------------------

/** Mirrors `HandEquip()` in its interactive form. */
export async function handEquipment(world: World, io: GameIO): Promise<void> {
  const error = (msg: number) => {
    io.printMessage(msg);
    io.sound(Sound.Error1);
  };
  io.printMessage(Msg.HandFrom);
  const from = await io.chooseMember();
  if (from < 1 || from > 4 || !world.member(from - 1).exists) return error(Msg.NoSuchPlayer);
  io.printMessage(Msg.HandTo);
  const to = await io.chooseMember();
  if (to < 1 || to > 4 || !world.member(to - 1).exists) return error(Msg.NoSuchPlayer);
  if (from === to) return io.sound(Sound.Error1);
  const a = world.member(from - 1);
  const b = world.member(to - 1);

  io.printMessage(Msg.HandWhat);
  const item = await io.chooseOption(
    [
      { key: 'E', label: 'Equipment (gems, keys, powders, torches)' },
      { key: 'W', label: 'Weapon' },
      { key: 'A', label: 'Armour' },
    ],
    'line',
  );
  switch (item) {
    case 'E': {
      io.printMessage(Msg.HandEquipmentWhat);
      const what = await io.chooseOption(
        [
          { key: 'G', label: `Gems (${a.gems})` },
          { key: 'K', label: `Keys (${a.keys})` },
          { key: 'P', label: `Powders (${a.powders})` },
          { key: 'T', label: `Torches (${a.torches})` },
        ],
        'line',
      );
      const offset = { G: 37, K: 38, P: 39, T: 15 }[what];
      if (!offset) return error(Msg.None);
      io.printMessage(Msg.HowMany);
      const amount = await inputNumber(io);
      io.print('\n');
      if (amount > a.bytes[offset]) return error(Msg.NotEnough);
      if (amount + b.bytes[offset] > 99) return error(Msg.TooMuch);
      a.bytes[offset] -= amount;
      b.bytes[offset] = Math.min(99, b.bytes[offset] + amount);
      io.printMessage(Msg.Done);
      break;
    }
    case 'W':
    case 'A': {
      const isWeapon = item === 'W';
      io.printMessage(isWeapon ? Msg.WhichWeapon : Msg.WhichArmour);
      const last = isWeapon ? 'P' : 'H';
      const what = await io.chooseOption(ownedItems(world, a, isWeapon, last), 'line');
      if (!what || what < 'B' || what > last) return error(Msg.None);
      const index = what.charCodeAt(0) - 'A'.charCodeAt(0);
      const base = isWeapon ? 48 : 40;
      if (a.bytes[base] === index && a.bytes[base + index] < 2) return error(Msg.InUse);
      if (a.bytes[base + index] === 0) return error(Msg.None);
      a.bytes[base + index]--;
      b.bytes[base + index] = Math.min(99, b.bytes[base + index] + 1);
      io.printMessage(Msg.Done);
      break;
    }
    default:
      return error(Msg.None);
  }
  io.updateStats();
}


// ---------------------------------------------------------------------------
// I: Ignite torch, M: Modify order, N: Negate time, P: Peer (Join gold is gone: gold is pooled)
// ---------------------------------------------------------------------------

/** Mirrors `Ignite()`. */
export async function igniteTorch(world: World, io: GameIO): Promise<void> {
  io.printMessage(Msg.IgniteTorch);
  if (world.party.location !== Location.Dungeon) return notHere(io);
  io.printMessage(Msg.WhoseTorch);
  const n = await io.chooseMember();
  if (n < 1 || n > 4) return;
  const p = world.member(n - 1);
  if (p.torches < 1) return io.printMessage(Msg.NoneLeft);
  p.torches--;
  io.sound(Sound.TorchIgnite);
  world.dungeon.torch = 255;
}

/** Mirrors `ModifyOrder()`: swap two members' positions. */
export async function modifyOrder(world: World, io: GameIO): Promise<void> {
  io.printMessage(Msg.ModifyOrder);
  const a = await io.chooseMember();
  if (a < 1 || a > 4) return io.printMessage(Msg.Aborted);
  io.printMessage(Msg.Plr);
  const b = await io.chooseMember();
  if (b < 1 || b > 4 || a === b) return io.printMessage(Msg.Aborted);
  const ra = world.party.memberRosterNumber(a - 1);
  world.party.setMemberRosterNumber(a - 1, world.party.memberRosterNumber(b - 1));
  world.party.setMemberRosterNumber(b - 1, ra);
  io.updateStats(true);
  io.printMessage(Msg.Exchanged);
}

/** Mirrors `NegateTime()`: a powder stops time for ten turns. In combat the member is preset. */
export async function negateTime(world: World, io: GameIO, member?: number): Promise<void> {
  if (member === undefined) {
    io.printMessage(Msg.NegateTime);
    const n = await io.chooseMember();
    if (n < 1 || n > 4) return io.print('\n');
    member = n - 1;
  }
  const p = world.member(member);
  if (p.powders < 1) return io.printMessage(Msg.NoneLeft);
  p.bytes[39]--;
  world.timeNegate = 10;
}

/** Mirrors `PeerGem()`. */
export async function peerGem(world: World, io: GameIO): Promise<void> {
  io.printMessage(Msg.PeerAtGem);
  const n = await chooseHolder(world, io, (p) => p.gems);
  if (n < 1 || n > 4) return io.print('\n');
  const p = world.member(n - 1);
  io.print('\n');
  if (p.gems < 1) return io.printMessage(Msg.NoneLeft);
  p.bytes[37]--;
  if (world.party.location === Location.Dungeon) await io.showMiniDungeon();
  else await io.showMiniMap();
}

/**
 * "Whose gem-" and the like, answered by the inventory: the controller menu
 * lists only the members who have one, and when exactly one member has any
 * the answer is echoed without asking. With nobody holding one (a keyboard
 * can still get here) the ordinary prompt runs and the command says "None
 * left!" as before. Returns 1..4 like `chooseMember`, 0 when cancelled.
 */
export async function chooseHolder(world: World, io: GameIO, count: (p: PlayerRecord) => number): Promise<number> {
  const holders: number[] = [];
  for (let m = 0; m < 4; m++) if (world.party.memberSlot(m) >= 0 && count(world.member(m)) > 0) holders.push(m);
  if (holders.length === 1) {
    io.print(`${holders[0] + 1}\n`);
    return holders[0] + 1;
  }
  return io.chooseMember(holders.length ? holders : undefined);
}

// ---------------------------------------------------------------------------
// R: Ready weapon, W: Wear armour, V: Volume
// ---------------------------------------------------------------------------

/**
 * Menu options for a member's weapons (letters A..P) or armour (A..H): the
 * letter, the name and how many are owned. Hands/skin (A) are always there.
 * Letters for items not owned are hidden: a keyboard may still type them
 * (and get "Not owned!", as in the original) but a menu does not list them.
 */
export function ownedItems(world: World, p: PlayerRecord, isWeapon: boolean, last: string): MenuOption[] {
  const names = world.resources.strings.WeaponsArmour;
  const base = isWeapon ? 48 : 40;
  const nameBase = isWeapon ? 0 : 16;
  const letters = isWeapon ? 'ABCDEFGHIJKLMNOP' : 'ABCDEFGH';
  const options: MenuOption[] = [];
  for (const letter of letters) {
    if (letter > last) break;
    const index = letter.charCodeAt(0) - 65;
    const count = index === 0 ? 1 : p.bytes[base + index];
    options.push({ key: letter, label: `${letter} ${names[nameBase + index]}${index ? ` x${count}` : ''}`, hidden: count < 1 });
  }
  return options;
}

/**
 * Mirrors `ReadyWeapon()`. Each class may only use weapons up to a letter
 * in the weapon-use table; exotic weapons (P) are allowed to everyone.
 */
export async function readyWeapon(world: World, io: GameIO, member?: number): Promise<void> {
  const error = (msg: number) => {
    io.printMessage(msg);
    io.sound(Sound.Error1);
  };
  if (member === undefined) {
    io.printMessage(Msg.ReadyFor);
    const n = await io.chooseMember();
    if (n < 1 || n > 4) return error(Msg.NoSuchPlayer);
    member = n - 1;
  }
  const p = world.member(member);
  io.printMessage(Msg.Weapon);
  const key = await io.chooseOption(ownedItems(world, p, true, 'P'), 'key');
  if (!key || key < 'A' || key > 'P') return error(Msg.NotOwned);
  const careers = String.fromCharCode(...world.resources.misc.careerTable);
  const classIndex = Math.max(0, careers.indexOf(p.classLetter));
  if (key !== 'P' && key.charCodeAt(0) >= world.resources.misc.weaponUseTable[classIndex]) return error(Msg.NotAllowed);
  const index = key.charCodeAt(0) - 'A'.charCodeAt(0);
  if (index > 0 && p.bytes[48 + index] < 1) return error(Msg.NotOwned);
  p.bytes[48] = index;
  io.print('\n');
  io.print(world.resources.strings.WeaponsArmour[index]);
  io.printMessage(Msg.Ready);
}

/** Mirrors `WearArmour()`. Exotic armour (H) is allowed to everyone. */
export async function wearArmour(world: World, io: GameIO): Promise<void> {
  const error = (msg: number) => {
    io.printMessage(msg);
    io.sound(Sound.Error1);
  };
  io.printMessage(Msg.WearFor);
  const n = await io.chooseMember();
  if (n < 1 || n > 4) return error(Msg.NoSuchPlayer);
  const p = world.member(n - 1);
  io.printMessage(Msg.Armour);
  const key = await io.chooseOption(ownedItems(world, p, false, 'H'), 'key');
  if (!key || key < 'A' || key > 'H') return error(Msg.NotOwned);
  const careers = String.fromCharCode(...world.resources.misc.careerTable);
  const classIndex = Math.max(0, careers.indexOf(p.classLetter));
  if (key !== 'H' && key.charCodeAt(0) >= world.resources.misc.armourUseTable[classIndex]) return error(Msg.NotAllowed);
  const index = key.charCodeAt(0) - 'A'.charCodeAt(0);
  if (index > 0 && p.bytes[40 + index] < 1) return error(Msg.NotOwned);
  p.bytes[40] = index;
  io.print('\n');
  io.print(world.resources.strings.WeaponsArmour[index + 16]);
  io.printMessage(Msg.Ready);
}

/** Mirrors `Volume()`: toggle sound effects. */
export function volume(world: World, io: GameIO): void {
  io.printMessage(Msg.Volume);
  world.soundEnabled = !world.soundEnabled;
  io.printMessage(world.soundEnabled ? Msg.VolumeOn : Msg.VolumeOff);
}

// ---------------------------------------------------------------------------
// Z: Ztats
// ---------------------------------------------------------------------------

/**
 * Mirrors the classic `Stats()`: print a member's record a few lines at a
 * time, waiting for a key between sections. Escape stops early.
 */
export async function stats(world: World, io: GameIO, member?: number): Promise<void> {
  if (member === undefined) {
    io.printMessage(Msg.Ztats);
    const n = await io.chooseMember();
    if (n < 1 || n > 4) return io.print('\n');
    member = n - 1;
  }
  const p = world.member(member);
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  const wait = async (): Promise<boolean> => {
    const key = await io.waitKey();
    if (key === Key.Escape || key === Key.B || world.done) {
      io.print('\n');
      return true;
    }
    return false;
  };
  const names = world.resources.strings.WeaponsArmour;

  io.print(p.name);
  io.print(`\nSTR...${pad(p.strength, 2)}\nDEX...${pad(p.dexterity, 2)}\nINT...${pad(p.intelligence, 2)}\nWIS...${pad(p.wisdom, 2)}`);
  if (await wait()) return;
  const lines = [
    `\nH.P...${pad(p.hitPoints, 4)}`,
    `\nH.M...${pad(p.maxHitPoints, 4)}`,
    `\nEXP...${pad(p.bytes[30] * 100 + p.bytes[31], 4)}`,
    `\nGEMS..${pad(p.gems, 2)}`,
    `\nKEYS..${pad(p.keys, 2)}`,
    `\nPOWD..${pad(p.powders, 2)}`,
    `\nTRCH..${pad(p.torches, 2)}`,
  ];
  for (const line of lines) {
    io.print(line);
    if (await wait()) return;
  }
  const marks = p.marks;
  const cards: [number, string][] = [
    [0x08, 'CARD OF DEATH'],
    [0x02, 'CARD OF SOL'],
    [0x01, 'CARD OF LOVE'],
    [0x04, 'CARD OF MOONS'],
    [0x10, 'MARK OF FORCE'],
    [0x20, 'MARK OF FIRE'],
    [0x40, 'MARK OF SNAKE'],
    [0x80, 'MARK OF KINGS'],
  ];
  for (const [bit, label] of cards) {
    if (!(marks & bit)) continue;
    io.print(`\n${label}`);
    if (await wait()) return;
  }
  io.print(`\nWEAPON:${names[p.bytes[48]]}`);
  if (await wait()) return;
  io.print(`\nARMOUR:${names[p.bytes[40] + 16]}`);
  if (await wait()) return;
  io.print('\n**WEAPONS**\n');
  for (let x = 15; x >= 0; x--) {
    if (x === 0) {
      io.print('02-Hands-(A)\n**ARMOUR**\n');
      continue;
    }
    if (!p.bytes[48 + x]) continue;
    io.print(`${pad(p.bytes[48 + x], 2)}-${names[x]}-(${String.fromCharCode(65 + x)})`);
    if (await wait()) return;
    io.print('\n');
  }
  for (let x = 7; x >= 0; x--) {
    if (x === 0) {
      io.print('01-Skin-(A)\n');
      continue;
    }
    if (!p.bytes[40 + x]) continue;
    io.print(`${pad(p.bytes[40 + x], 2)}-${names[x + 16]}-(${String.fromCharCode(65 + x)})`);
    if (await wait()) return;
    io.print('\n');
  }
}
