/**
 * shops.ts
 *
 * The eight kinds of shop, entered by Transacting with a merchant across a
 * counter. A port of `Shop()`, `Clerical()`, `GuildPay()`, `GuildGive()`,
 * `WeaponList()` and `ArmourList()` from UltimaMisc.c.
 *
 * Which shop a merchant runs is decided by the party's Y position & 7:
 *   0 pub, 1 grocer, 2 healer, 3 weapons, 4 armour, 5 guild, 6 oracle, 7 horses
 */

import { World } from './world.ts';
import { type GameIO, Sound, inputNumber, yesNo, letterOptions, type MenuOption } from './io.ts';
import { PlayerRecord } from './player.ts';
import { addGold } from './actions.ts';

const Msg = {
  WelcomePub: 185,
  HaveADrink: 186,
  LeaveMyShop: 187,
  CantPay: 188,
  AnotherDrink: 189,
  Pleasure: 190,
  Grocer: 191,
  Rations: 192,
  CantPayGrocer: 193,
  AnythingElse: 194,
  ComeAgain: 195,
  Clerical: 196,
  ClericalMenu: 197,
  Curing: 198,
  CureWhom: 199,
  Healing: 200,
  HealWhom: 201,
  Resurrection: 202,
  ResurrectWhom: 203,
  Recalling: 204,
  RecallWhom: 205,
  WeaponsShop: 206,
  BuyOrSell: 207,
  YourInterest: 208,
  NoGold: 209,
  HereYouAre: 210,
  ForSale: 211,
  DontOwn: 212,
  ThankYou: 213,
  TooMuchGold: 214,
  MaybeNextTime: 215,
  ArmourShop: 216,
  Guild: 217,
  YourNeed: 218,
  GuildThanks: 219,
  GuildAnythingElse: 220,
  Radrion: 221,
  Offering: 222,
  MoreOffering: 223,
  FareWell: 224,
  Emporium: 225,
  HorsesCost: 226,
  WillYouBuy: 227,
  TooBad: 228,
  NoGoldHorse: 229,
  RideFast: 230,
  NoFunds: 231,
  NoOfferings: 232,
  NotGoldEnough: 233,
  FareThee: 234,
  Available: 237,
  NotEnoughRoom: 260,
  GuildPrices: 261,
} as const;

function error(io: GameIO): void {
  io.sound(Sound.Error1);
}

function priceOf(world: World, index: number): number {
  return parseInt(world.resources.strings.WeaponsArmour[index], 10) || 0;
}

/** Mirrors `Shop()`. `shop` is the Y coordinate & 7; `member` is 0..3. */
export async function shop(world: World, io: GameIO, shopNumber: number, member: number): Promise<void> {
  const p = world.member(member);
  switch (shopNumber) {
    case 0:
      return pub(world, io, p);
    case 1:
      return grocer(world, io, p);
    case 2:
      return healer(world, io, p);
    case 3:
      return weaponsShop(world, io, p);
    case 4:
      return armourShop(world, io, p);
    case 5:
      return guild(world, io, p);
    case 6:
      return oracle(world, io, p);
    default:
      return horses(world, io, p);
  }
}

/** The pub: pay at least 7 gold for a drink and a rumour. More gold, better rumours. */
async function pub(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  io.printMessage(Msg.WelcomePub);
  for (;;) {
    io.printMessage(Msg.HaveADrink);
    const paid = await inputNumber(io);
    io.print('\n\n');
    if (paid < 7) {
      io.printMessage(Msg.LeaveMyShop);
      return error(io);
    }
    if (p.gold < paid) {
      io.printMessage(Msg.CantPay);
      return error(io);
    }
    p.gold -= paid;
    io.print(world.resources.strings.Pub[Math.min(9, Math.floor(paid / 10))]);
    io.printMessage(Msg.AnotherDrink);
    if (!(await yesNo(io))) {
      io.print('N');
      io.printMessage(Msg.Pleasure);
      return;
    }
    io.print('Y');
  }
}

/** The grocer: rations at one gold each. */
async function grocer(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  io.printMessage(Msg.Grocer);
  for (;;) {
    io.printMessage(Msg.Rations);
    const amount = await inputNumber(io, 4);
    if (amount === 0) return io.print('\n\n');
    if (amount > 9999 - p.food) {
      io.printMessage(Msg.NotEnoughRoom);
      io.print('\n\n');
      error(io);
      continue;
    }
    if (p.gold < amount) {
      io.printMessage(Msg.CantPayGrocer);
      return error(io);
    }
    p.gold -= amount;
    const food = p.food + amount;
    p.bytes[32] = Math.floor(food / 100);
    p.bytes[33] = food % 100;
    io.updateStats();
    io.printMessage(Msg.AnythingElse);
    if (!(await yesNo(io))) {
      io.print('N\n\n');
      io.printMessage(Msg.ComeAgain);
      return;
    }
    io.print('Y\n\n');
  }
  void world;
}

/** Mirrors `Clerical()`: confirm and pay. Returns true if paid. */
async function clericalPay(world: World, io: GameIO, p: PlayerRecord, cost: number): Promise<boolean> {
  if (!(await yesNo(io))) {
    io.print('N\n\n');
    io.printMessage(Msg.NoOfferings);
    return false;
  }
  if (cost > p.gold) {
    io.print('Y\n\n');
    io.printMessage(Msg.NotGoldEnough);
    error(io);
    return false;
  }
  p.gold -= cost;
  io.print('Y\n');
  void world;
  return true;
}

/** Mirrors `SpellNoize()`: the healer's flourish. */
async function spellNoise(io: GameIO, member: number): Promise<void> {
  await io.flashTiles();
  await io.flashMember(member);
  io.sound(Sound.Heal);
  io.printMessage(Msg.FareThee);
}

/** The healer: cure, heal, resurrect, recall. */
async function healer(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  io.printMessage(Msg.Clerical);
  io.printMessage(Msg.ClericalMenu);
  const choice = await io.chooseOption(
    [
      { key: '1', label: 'Curing (100 gp)' },
      { key: '2', label: 'Healing (200 gp)' },
      { key: '3', label: 'Resurrection (500 gp)' },
      { key: '4', label: 'Recalling (900 gp)' },
      { key: '0', label: 'Nothing' },
    ],
    'none',
  );
  if (!choice || choice === '0') return io.print('0\n');

  const services: Record<string, [number, number, number, (t: PlayerRecord) => void]> = {
    '1': [Msg.Curing, Msg.CureWhom, 100, (t) => void (t.status === 'P' && (t.status = 'G'))],
    '2': [Msg.Healing, Msg.HealWhom, 200, (t) => void (t.hitPoints = t.maxHitPoints)],
    '3': [Msg.Resurrection, Msg.ResurrectWhom, 500, (t) => void (t.status === 'D' && (t.status = 'G'))],
    '4': [Msg.Recalling, Msg.RecallWhom, 900, (t) => void (t.status === 'A' && (t.status = 'G'))],
  };
  const [askMsg, whomMsg, cost, apply] = services[choice];
  io.printMessage(askMsg);
  if (!(await clericalPay(world, io, p, cost))) return;
  io.printMessage(whomMsg);
  const n = await io.chooseMember();
  io.print('\n');
  if (n < 1 || n > 4) return io.sound(Sound.Bump);
  await spellNoise(io, n - 1);
  apply(world.member(n - 1));
  io.updateStats();
}

/** Print the weapons or armour price list a few lines at a time. (`WeaponList`, `ArmourList`) */
async function priceList(world: World, io: GameIO, isWeapon: boolean, last: number): Promise<void> {
  const names = world.resources.strings.WeaponsArmour;
  io.printMessage(Msg.Available);
  const nameBase = isWeapon ? 0 : 16;
  const priceBase = isWeapon ? 24 : 40;
  const pageBreaks = isWeapon ? [5, 7, 11, 14] : [4, 6];
  for (let i = 1; i < last; i++) {
    let name = names[nameBase + i];
    if (!name.endsWith('s') && name.length < 7) name += 's';
    const price = `${names[priceBase + i]}gp`;
    const label = `${String.fromCharCode(64 + i)}:${name}`;
    io.print(label + price.padStart(16 - label.length) + '\n');
    if (pageBreaks.includes(i)) await io.waitKey();
  }
  await io.waitKey();
}

/** Buy or sell weapons or armour. (`Shop` cases 3 and 4) */
async function equipmentShop(world: World, io: GameIO, p: PlayerRecord, isWeapon: boolean): Promise<void> {
  const names = world.resources.strings.WeaponsArmour;
  const nameBase = isWeapon ? 0 : 16;
  const priceBase = isWeapon ? 24 : 40;
  const countBase = isWeapon ? 48 : 40;
  // The best shops (in the town at surface X = 37) stock everything.
  const fullStock = world.party.surfaceX === 37;
  const last = isWeapon ? (fullStock ? 16 : 9) : fullStock ? 8 : 6; // exclusive letter index

  // Menu of what the shop stocks (letters B..), with prices.
  const stock: MenuOption[] = [];
  for (let i = 1; i < last; i++) stock.push({ key: String.fromCharCode(65 + i), label: `${String.fromCharCode(65 + i)} ${names[nameBase + i]} ${names[priceBase + i]}gp` });
  const owned = (): MenuOption[] => stock.filter((o) => p.bytes[countBase + o.key.charCodeAt(0) - 65] > 0);
  const nothing: MenuOption = { key: ' ', label: 'Nothing' };

  io.printMessage(isWeapon ? Msg.WeaponsShop : Msg.ArmourShop);
  let key = await io.chooseOption([{ key: 'Y', label: 'Yes, list' }, { key: 'N', label: 'No' }], 'none');
  io.print(key || 'N');
  if (key === 'Y') await priceList(world, io, isWeapon, last);
  io.printMessage(Msg.BuyOrSell);
  key = await io.chooseOption([{ key: 'B', label: 'Buy' }, { key: 'S', label: 'Sell' }], 'none');
  io.print(key || 'S');

  let mode = key;
  for (;;) {
    if (mode === 'B') {
      io.printMessage(Msg.YourInterest);
      const k = await io.chooseOption([...stock, nothing], 'none');
      const index = k.charCodeAt(0) - 'A'.charCodeAt(0);
      if (!k || k < 'B' || index >= last) break;
      io.print(k);
      const price = priceOf(world, priceBase + index);
      if (price > p.gold) {
        io.printMessage(Msg.NoGold);
        return;
      }
      if (p.bytes[countBase + index] > 98) {
        io.printMessage(Msg.NotEnoughRoom);
        io.print('\n\n');
        error(io);
        continue;
      }
      p.gold -= price;
      p.bytes[countBase + index]++;
      io.printMessage(Msg.HereYouAre);
    } else {
      io.printMessage(Msg.ForSale);
      const k = await io.chooseOption([...owned(), nothing], 'none');
      const index = k.charCodeAt(0) - 'A'.charCodeAt(0);
      if (!k || k < 'B' || index >= last) break;
      io.print(k);
      if (p.bytes[countBase + index] < 1) {
        io.printMessage(Msg.DontOwn);
        return;
      }
      if (!addGold(p, priceOf(world, priceBase + index), false)) {
        io.printMessage(Msg.TooMuchGold);
        return error(io);
      }
      p.bytes[countBase + index]--;
      if (p.bytes[countBase + index] < 1 && p.bytes[countBase] === index) p.bytes[countBase] = 0;
      io.printMessage(Msg.ThankYou);
      mode = 'S';
    }
  }
  io.printMessage(Msg.MaybeNextTime);
}

async function weaponsShop(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  return equipmentShop(world, io, p, true);
}

async function armourShop(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  return equipmentShop(world, io, p, false);
}

/** The guild: keys, torches (five at a time), powders and gems. */
async function guild(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  io.printMessage(Msg.Guild);
  for (;;) {
    io.printMessage(Msg.GuildPrices);
    io.printMessage(Msg.YourNeed);
    const key = await io.chooseOption(
      [
        { key: 'K', label: 'Keys (50 gp)' },
        { key: 'T', label: 'Torches, five (30 gp)' },
        { key: 'P', label: 'Powders (90 gp)' },
        { key: 'G', label: 'Gems (75 gp)' },
        { key: 'N', label: 'Nothing' },
      ],
      'none',
    );
    const item = { T: [30, 15, 5], K: [50, 38, 1], P: [90, 39, 1], G: [75, 37, 1] }[key];
    if (!item) {
      io.print('N\n\n');
      io.printMessage(Msg.GuildThanks);
      return;
    }
    const [cost, offset, quantity] = item;
    io.print(`${key}\n`);
    if (p.bytes[offset] + quantity > 99) {
      io.printMessage(Msg.NotEnoughRoom);
      error(io);
      continue;
    }
    if (p.gold < cost) {
      io.printMessage(Msg.NoFunds);
      return;
    }
    p.gold -= cost;
    p.bytes[offset] = Math.min(99, p.bytes[offset] + quantity);
    io.printMessage(Msg.GuildAnythingElse);
    if (!(await yesNo(io))) {
      io.print('N\n\n');
      io.printMessage(Msg.GuildThanks);
      return;
    }
  }
  void world;
}

/** Radrion the prophet: offerings of hundreds of gold buy verses of his rhyme. */
async function oracle(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  io.printMessage(Msg.Radrion);
  for (;;) {
    io.printMessage(Msg.Offering);
    const key = await io.chooseOption(letterOptions('0123456789', (d) => (d === '0' ? '0 (nothing)' : `${d} = ${d}00 gold`)), 'none');
    const digit = key ? key.charCodeAt(0) - '0'.charCodeAt(0) : 0;
    io.print(`${digit}\n\n`);
    const cost = digit * 100;
    if (cost > p.gold) {
      io.printMessage(Msg.CantPay);
      return error(io);
    }
    p.gold -= cost;
    io.print(world.resources.strings.Radrion[digit]);
    io.printMessage(Msg.MoreOffering);
    if (!(await yesNo(io))) {
      io.print('N\n');
      io.printMessage(Msg.FareWell);
      return;
    }
    io.print('Y\n');
  }
}

/** The equine emporium: a horse for 200 gold per member. */
async function horses(world: World, io: GameIO, p: PlayerRecord): Promise<void> {
  const cost = world.party.size * 200;
  io.printMessage(Msg.Emporium);
  io.print(String(world.party.size));
  io.printMessage(Msg.HorsesCost);
  io.print(String(cost));
  io.printMessage(Msg.WillYouBuy);
  if (!(await yesNo(io))) {
    io.print('N\n\n');
    io.printMessage(Msg.TooBad);
    return;
  }
  if (p.gold < cost) {
    io.print('Y\n\n');
    io.printMessage(Msg.NoGoldHorse);
    return error(io);
  }
  p.gold -= cost;
  io.print('Y\n\n');
  io.printMessage(Msg.RideFast);
  world.party.shape = 0x14;
  io.redrawMap();
}
