/**
 * menu.ts
 *
 * The title screen and party organisation: a port of `MainMenu()`,
 * `Organize()`, `CreateChar()`, `FormParty()`, `DisperseParty()` and
 * `KillChar()` from UltimaMain.c.
 *
 * The Macintosh version replaced the Apple II text screens with dialogs.
 * This port follows the Apple II flow (which survives in comments in the C
 * source): everything is typed at prompts drawn on the title screen.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { PlayerRecord, ROSTER_SIZE } from './player.ts';
import { type GameIO, Key } from './io.ts';

/** 1-based indices into the MoreMessages table. */
const MM = {
  JourneyOnward: 1,
  NotFormed: 2,
  FormTheParty: 4,
  PartyInUse: 5,
  Player1: 6,
  NotAPlayer: 10,
  Blank: 11,
  Formed: 12,
  DisperseTheParty: 13,
  NoOneThere: 14,
  Dispersed: 15,
  Create: 16,
  EntryNumber: 17,
  OneToTwenty: 18,
  NotEmpty: 19,
  Terminate: 22,
  TerminateNoOne: 23,
  WithAParty: 24,
  Terminated: 25,
  Copyright: 26,
  FromTheDepths: 27,
  HeComes: 28,
  OrganizeAParty: 30,
  JourneyOnwardOption: 31,
  Options: 32,
  PartyOrganization: 33,
  CreateACharacter: 35,
  FormThePartyOption: 36,
  DisperseThePartyOption: 37,
  TerminateACharacter: 38,
  MainMenu: 39,
  PressSpace: 54,
} as const;

function mm(world: World, n: number): string {
  // The bitmap font only has ASCII; the copyright sign becomes "(C)".
  return (world.resources.strings.MoreMessages[n - 1] ?? '').replace(/\u00a9/g, '(C)');
}

/** Wait for any key. */
async function anyKey(io: GameIO): Promise<void> {
  await io.waitKey();
}

/**
 * Mirrors `MainMenu()`. `play` runs the game; it returns when the player
 * quits. The menu then shows again until the page is closed.
 */
export interface MenuOptions {
  /** Called after the roster or party changes in the Organize menu, so it can be saved. */
  save?: (world: World) => void;
}

export async function mainMenu(world: World, io: GameIO, play: () => Promise<void>, options: MenuOptions = {}): Promise<void> {
  for (;;) {
    io.showTitle();
    io.clearBottom();
    io.centreText(11, mm(world, MM.FromTheDepths));
    io.centreText(12, mm(world, MM.HeComes));
    io.centreText(15, mm(world, MM.Options));
    io.centreText(17, `J) ${mm(world, MM.JourneyOnwardOption)}`);
    io.centreText(18, `O) ${mm(world, MM.OrganizeAParty)}`);
    io.centreText(22, mm(world, MM.Copyright));

    const key = (await io.waitKey()).toUpperCase();
    if (key === 'J') {
      if (!world.party.formed) {
        io.centreText(20, mm(world, MM.NotFormed));
        await anyKey(io);
        continue;
      }
      await play();
    } else if (key === 'O') {
      await organize(world, io);
      options.save?.(world);
    }
  }
}

/** Mirrors `Organize()`. */
export async function organize(world: World, io: GameIO): Promise<void> {
  for (;;) {
    io.showTitle();
    io.clearBottom();
    io.centreText(11, mm(world, MM.PartyOrganization));
    io.centreText(13, mm(world, MM.Options));
    io.centreText(15, `C) ${mm(world, MM.CreateACharacter)}`);
    io.centreText(16, `F) ${mm(world, MM.FormThePartyOption)}`);
    io.centreText(17, `D) ${mm(world, MM.DisperseThePartyOption)}`);
    io.centreText(18, `T) ${mm(world, MM.TerminateACharacter)}`);
    io.centreText(19, `M) ${mm(world, MM.MainMenu)}`);

    const key = (await io.waitKey()).toUpperCase();
    switch (key) {
      case 'C':
        await createCharacter(world, io);
        break;
      case 'F':
        await formParty(world, io);
        break;
      case 'D':
        await disperseParty(world, io);
        break;
      case 'T':
        await terminateCharacter(world, io);
        break;
      case 'M':
      case 'B':
      case Key.Escape:
        return;
      default:
        break;
    }
  }
}

/** Ask for a roster entry number, 1..20. Returns 0-based slot or -1. */
async function askEntry(world: World, io: GameIO, y: number): Promise<number> {
  io.textAt(14, y, mm(world, MM.EntryNumber));
  const text = await io.inputTextAt(21, y, 2, true);
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 1 || n > ROSTER_SIZE) {
    io.centreText(21, mm(world, MM.OneToTwenty));
    await anyKey(io);
    return -1;
  }
  return n - 1;
}

/**
 * Mirrors the Apple II `CreateChar()`: pick an empty roster entry, then
 * type a name, sex, race, class and four attributes totalling 50 points.
 */
export async function createCharacter(world: World, io: GameIO): Promise<void> {
  io.clearBottom();
  io.centreText(11, mm(world, MM.Create));
  const slot = await askEntry(world, io, 13);
  if (slot < 0) return;
  const p = world.roster.get(slot);
  if (p.exists) {
    io.centreText(21, mm(world, MM.NotEmpty));
    await anyKey(io);
    return;
  }

  const races = world.resources.strings.Races;
  const classes = world.resources.strings.Classes;
  const careers = String.fromCharCode(...world.resources.misc.careerTable);

  for (;;) {
    io.clearBottom();
    io.textAt(11, 11, `Entry#${slot + 1}`);
    io.textAt(20, 11, 'Points:50');
    io.textAt(14, 13, 'Name:');
    io.textAt(14, 14, 'Sex:');
    io.textAt(14, 15, 'Race:');
    io.textAt(14, 16, 'Type:');
    io.textAt(12, 17, 'Strength........');
    io.textAt(12, 18, 'Dexterity.......');
    io.textAt(12, 19, 'Intelligence....');
    io.textAt(12, 20, 'Wisdom..........');
    io.textAt(14, 21, 'O.K.:');

    const name = (await io.inputTextAt(19, 13, 13, false)).trim();
    if (name.length === 0) return;

    let sex = '';
    while (!'MFO'.includes(sex) || sex === '') sex = (await io.waitKey()).toUpperCase();
    io.textAt(19, 14, { M: 'Male', F: 'Female', O: 'Other' }[sex]!);

    let race = -1;
    while (race < 0) {
      const k = (await io.waitKey()).toUpperCase();
      race = races.findIndex((r) => r[0] === k);
    }
    io.textAt(19, 15, races[race]);

    let career = -1;
    while (career < 0) {
      const k = (await io.waitKey()).toUpperCase();
      career = careers.indexOf(k);
    }
    io.textAt(19, 16, classes[career]);

    // Four attributes, 5..25 each, from a pool of 50 points.
    const values: number[] = [];
    let points = 50;
    let valid = true;
    for (let i = 0; i < 4 && valid; i++) {
      io.textAt(27, 11, `${points} `);
      const text = await io.inputTextAt(28, 17 + i, 2, true);
      const v = parseInt(text, 10);
      if (!Number.isFinite(v) || v < 5 || v > 25 || v > points) {
        valid = false;
        break;
      }
      values.push(v);
      points -= v;
    }
    if (!valid) continue;
    io.textAt(27, 11, `${points} `);

    let ok = '';
    while (ok !== 'Y' && ok !== 'N') ok = (await io.waitKey()).toUpperCase();
    io.textAt(19, 21, ok);
    if (ok === 'N') continue;

    p.bytes.fill(0);
    p.name = name;
    p.bytes[24] = sex.charCodeAt(0);
    p.bytes[22] = races[race].charCodeAt(0);
    p.bytes[23] = careers.charCodeAt(career);
    p.bytes[18] = values[0];
    p.bytes[19] = values[1];
    p.bytes[20] = values[2];
    p.bytes[21] = values[3];
    p.status = 'G';
    p.bytes[27] = 100; // hit points
    p.bytes[29] = 100; // max hit points
    p.bytes[32] = 1; // food 150
    p.bytes[33] = 50;
    p.bytes[36] = 150; // gold
    p.bytes[41] = 1; // cloth
    p.bytes[40] = 1; //   worn
    p.bytes[49] = 1; // dagger
    p.bytes[48] = 1; //   readied
    io.centreText(22, mm(world, 21));
    await anyKey(io);
    return;
  }
}

/** Mirrors the Apple II `FormParty()`: choose up to four roster entries. */
export async function formParty(world: World, io: GameIO): Promise<void> {
  io.clearBottom();
  io.centreText(13, mm(world, MM.FormTheParty));
  if (world.party.formed) {
    io.centreText(16, mm(world, MM.PartyInUse));
    await anyKey(io);
    return;
  }
  world.party.bytes.fill(0);
  for (let i = 0; i < 4; i++) io.textAt(15, 16 + i, mm(world, MM.Player1 + i));

  const chosen: number[] = [];
  for (let i = 0; i < 4; i++) {
    const text = await io.inputTextAt(24, 16 + i, 2, true);
    const n = parseInt(text, 10);
    if (i > 0 && (!text || n === 0)) break;
    const slot = n - 1;
    const p = world.roster.get(slot);
    let problem = '';
    if (!Number.isFinite(n) || slot < 0 || slot >= ROSTER_SIZE || !p?.exists) problem = mm(world, MM.NotAPlayer);
    else if (p.inParty || chosen.includes(slot)) problem = mm(world, 41);
    if (problem) {
      io.centreText(21, problem);
      await anyKey(io);
      io.centreText(21, mm(world, MM.Blank));
      i--;
      continue;
    }
    chosen.push(slot);
  }
  if (chosen.length === 0) return;

  world.party.size = chosen.length;
  chosen.forEach((slot, i) => {
    world.party.setMemberRosterNumber(i, slot + 1);
    world.roster.get(slot).inParty = true;
  });
  world.party.location = Location.Sosaria;
  world.party.shape = 0x7e;
  world.party.bytes[5] = 0xff;
  world.party.surfaceX = 42;
  world.party.surfaceY = 20;
  world.x = world.returnX = 42;
  world.y = world.returnY = 20;
  world.resetSosaria();
  world.moonPhase = [4, 4];
  world.moonTimer = [12, 4];
  io.centreText(22, mm(world, MM.Formed));
  await anyKey(io);
}

/** Mirrors `DisperseParty()`. */
export async function disperseParty(world: World, io: GameIO): Promise<void> {
  io.clearBottom();
  io.centreText(17, mm(world, MM.DisperseTheParty));
  for (let i = 0; i < ROSTER_SIZE; i++) world.roster.get(i).inParty = false;
  if (!world.party.formed) {
    io.centreText(20, mm(world, MM.NoOneThere));
  } else {
    world.party.bytes.fill(0, 0, 17);
    io.centreText(19, mm(world, MM.Dispersed));
  }
  await anyKey(io);
}

/** Mirrors `KillChar()`: erase a roster entry that is not in a party. */
export async function terminateCharacter(world: World, io: GameIO): Promise<void> {
  io.clearBottom();
  io.centreText(11, mm(world, MM.Terminate));
  const slot = await askEntry(world, io, 13);
  if (slot < 0) return;
  const p: PlayerRecord = world.roster.get(slot);
  if (!p.exists) io.centreText(21, mm(world, MM.TerminateNoOne));
  else if (p.inParty) io.centreText(21, mm(world, MM.WithAParty));
  else {
    p.bytes.fill(0);
    io.centreText(21, mm(world, MM.Terminated));
  }
  await anyKey(io);
}
