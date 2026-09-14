/**
 * journal.ts
 *
 * The quest journal (this port; the Apple II had none). It records what
 * the world has told the party and what the party has done along the
 * main line, so a newcomer can play without a walkthrough, and stays out
 * of the way of anyone who never opens it.
 *
 * Entries are revealed one at a time: the first, "Speak to Lord British",
 * is there from the start, and each later one appears once all before it
 * are done. An entry is 'open' (title only), 'heard' (a townsperson's clue
 * about it has been spoken to the party) or 'done'. Clues are recorded
 * whenever heard, shown once the entry is revealed. Every entry also has a
 * hint, a plain line written for this port that the game itself never
 * speaks; it shows only when asked for, and the asking is remembered.
 *
 * Done is computed from the party where it can be (marks, cards, exotics,
 * the ending); the rest are events flagged as they happen. The whole
 * state lives in the save file.
 */

import type { World } from './world.ts';
import { Location } from './party.ts';
import type { GameIO } from './io.ts';

export type EntryState = 'open' | 'heard' | 'done';

export interface JournalState {
  lordBritish: boolean;
  ambrosia: boolean;
  timeLord: boolean;
  wordKnown: boolean;
  serpentParted: boolean;
  /** Clue ids heard, e.g. "Moon#6" or "LB:mark". */
  clues: string[];
  /** Entry ids whose hint has been asked for. */
  hints: string[];
  /** Entry states as last shown to the player, to notice a change ("Journal updated"). */
  seen: string[];
}

export function emptyJournal(): JournalState {
  // `seen` starts as the opening page, so the first clue heard does not announce an update of nothing.
  return {
    lordBritish: false,
    ambrosia: false,
    timeLord: false,
    wordKnown: false,
    serpentParted: false,
    clues: [],
    hints: [],
    seen: ['king:open'],
  };
}

export interface Entry {
  id: string;
  title: string;
  hint: string;
}

/** The main line, in the order the journal reveals it. */
export const ENTRIES: Entry[] = [
  { id: 'king', title: 'Speak to the King', hint: "Lord British holds court in his castle, north of Britain's town. Walk into him." },
  {
    id: 'kings',
    title: 'The Mark of Kings',
    hint: 'Burned on level 1 of the Perinian Depths, the dungeon north of Britain, by the entrance; each member must step on the rod. Britain sells no torches: a wizard casts Lorum, a cleric Luminae, or buy torches at the guild in Grey or Devil Guard.',
  },
  {
    id: 'ambrosia',
    title: 'Lost Ambrosia',
    hint: 'Sail a frigate into the whirlpool. The ship is lost and the party wakes on the shore of Ambrosia; a moongate there leads home.',
  },
  {
    id: 'cards',
    title: 'The Four Cards',
    hint: "In Ambrosia four shrines raise stats for gold. At each, use Other and say SEARCH: a card is found. They lie in the land's far corners.",
  },
  {
    id: 'exotics',
    title: 'Exotic Arms',
    hint: 'Dawn appears in the dark forest south of the Montors only while both moons are new. Its people say to dig on isles: Other, DIG on the small isle in the far north for a weapon and the isle in the western sea for armour, once per member.',
  },
  {
    id: 'fire',
    title: 'The Mark of Fire',
    hint: 'On the deepest level of the Perinian Depths, the Fires of Hell or the Mines of Morinia. Every member should bear it before crossing lava.',
  },
  {
    id: 'force',
    title: 'The Mark of Force',
    hint: "On level 8 of Doom or of the Fires of Hell. Every member, for the force fields in Exodus' castle.",
  },
  {
    id: 'snake',
    title: 'The Silver Snake',
    hint: "The Mark of Snake is on level 8 of Clues, east of Death Gulch. Pray (Other, PRAY) in the circle of light in Yew to learn the word, then stand beside the serpent south of Exodus' castle and Yell it, with a marked member.",
  },
  {
    id: 'order',
    title: 'Order of the Cards',
    hint: 'The Time Lord waits on level 8 of Time Awaits, in the north-east near Death Gulch. He names the order the cards go in.',
  },
  {
    id: 'exodus',
    title: 'Exodus',
    hint: "Exodus' castle stands on the south-western isle, past the serpent and across lava. Inside, only exotic arms bite. Insert each card into its panel in the Time Lord's order; a mistake kills the member.",
  },
];

/**
 * Townsfolk lines that bear on the main line: town name and speaker
 * number in the talk table, and the entries each speaks to. The words
 * themselves come from the talk table at the time, so they are shown as
 * spoken.
 */
const TOWN_CLUES: Record<string, string[]> = {
  'LCB Towne#2': ['ambrosia'],
  'LCB Towne#3': ['exotics'],
  'LCB Towne#4': ['snake'],
  'LCB Towne#5': ['exotics'],
  'Moon#2': ['cards'],
  'Moon#3': ['order'],
  'Moon#6': ['ambrosia'],
  'Moon#7': ['exotics'],
  'Yew#1': ['cards'],
  'East Montor#1': ['order'],
  'East Montor#2': ['order'],
  'East Montor#5': ['cards'],
  'East Montor#6': ['kings'],
  'East Montor#7': ['exotics'],
  'West Montor#5': ['cards'],
  'West Montor#6': ['cards'],
  'Grey#3': ['exotics'],
  'Grey#4': ['exotics'],
  'Grey#5': ['exotics'],
  'Dawn#2': ['exotics'],
  'Dawn#3': ['exotics'],
  'Dawn#4': ['exotics'],
  'Dawn#6': ['exotics'],
  'Dawn#7': ['ambrosia'],
  'Devil Guard#1': ['kings'],
  'Devil Guard#2': ['kings'],
  'Devil Guard#3': ['kings'],
  'Devil Guard#4': ['snake'],
  'Devil Guard#5': ['kings', 'fire', 'force', 'snake'],
  'Devil Guard#7': ['kings'],
  'Fawn#1': ['snake'],
  'Fawn#2': ['snake'],
  'Fawn#3': ['snake'],
  'Fawn#4': ['snake'],
  'Death Gulch#2': ['order'],
  'Death Gulch#3': ['order', 'exodus'],
  'Death Gulch#4': ['snake'],
  'Death Gulch#5': ['snake'],
};

/** Clues that are not townsfolk lines: the id, who said it, the words, and the entries. */
const OTHER_CLUES: Record<string, { from: string; text: string; entries: string[] }> = {
  'LB:mark': { from: 'Lord British', text: 'SEEK YE, THE MARK OF KINGS!', entries: ['kings'] },
  'Yew:pray': { from: 'Yew, the circle of light', text: "YELL 'EVOCARE'", entries: ['snake'] },
  TimeLord: { from: 'The Time Lord', text: 'THE ONE WAY IS LOVE, SOL, MOONS & DEATH, ALL ELSE FAILS.', entries: ['order', 'exodus'] },
};

export interface JournalLine {
  id: string;
  title: string;
  state: EntryState;
  /** A short progress note for the list ("2 of 4"). */
  note: string;
  /** Clues heard about it, as spoken, with the speaker's town. */
  clues: { from: string; text: string }[];
  hint: string;
  hintSeen: boolean;
}

/** The living members' names, for a holder list. */
function holders(world: World, has: (m: number) => boolean): string {
  return [0, 1, 2, 3]
    .filter((m) => world.party.memberSlot(m) >= 0 && has(m))
    .map((m) => world.member(m).name)
    .join(', ');
}

function markHolders(world: World, bit: number): string {
  return holders(world, (m) => (world.member(m).marks & bit) !== 0);
}

/** Whether an entry is done, and its progress note, from the party and the flags. */
function progress(world: World, id: string): { done: boolean; note: string } {
  const j = world.journal;
  const inParty = [0, 1, 2, 3].filter((m) => world.party.memberSlot(m) >= 0);
  switch (id) {
    case 'king':
      return { done: j.lordBritish, note: '' };
    case 'kings': {
      const who = markHolders(world, 0x80);
      return { done: who !== '', note: who };
    }
    case 'ambrosia':
      return { done: j.ambrosia || world.party.location === Location.Ambrosia, note: '' };
    case 'cards': {
      const union = inParty.reduce((bits, m) => bits | (world.member(m).marks & 0x0f), 0);
      const n = [1, 2, 4, 8].filter((b) => union & b).length;
      return { done: n === 4, note: n ? `${n} of 4` : '' };
    }
    case 'exotics': {
      const weapons = world.party.weapons(15) + inParty.filter((m) => world.member(m).bytes[48] === 15).length;
      const armour = world.party.armour(7) + inParty.filter((m) => world.member(m).bytes[40] === 7).length;
      const note = weapons || armour ? `weapons ${weapons}, armour ${armour}` : '';
      return { done: weapons > 0 && armour > 0, note };
    }
    case 'fire': {
      const who = markHolders(world, 0x20);
      return { done: who !== '', note: who };
    }
    case 'force': {
      const who = markHolders(world, 0x10);
      return { done: who !== '', note: who };
    }
    case 'snake': {
      const who = markHolders(world, 0x40);
      const note = [who && `mark: ${who}`, j.wordKnown && 'the word is known'].filter(Boolean).join('; ');
      return { done: j.serpentParted, note };
    }
    case 'order':
      return { done: j.timeLord, note: '' };
    case 'exodus':
      return { done: world.party.exodusDestroyed, note: '' };
    default:
      return { done: false, note: '' };
  }
}

/** The clues heard for an entry, as spoken. */
function cluesFor(world: World, id: string): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  for (const clue of world.journal.clues) {
    const other = OTHER_CLUES[clue];
    if (other) {
      if (other.entries.includes(id)) out.push({ from: other.from, text: other.text });
      continue;
    }
    const entries = TOWN_CLUES[clue];
    if (!entries || !entries.includes(id)) continue;
    const [town, n] = clue.split('#');
    out.push({ from: town, text: world.townLine(town, Number(n)) });
  }
  return out;
}

/** The journal as the player sees it: revealed entries only, in order. */
export function journalLines(world: World): JournalLine[] {
  const out: JournalLine[] = [];
  for (const entry of ENTRIES) {
    const { done, note } = progress(world, entry.id);
    const clues = cluesFor(world, entry.id);
    const state: EntryState = done ? 'done' : clues.length ? 'heard' : 'open';
    out.push({ id: entry.id, title: entry.title, state, note, clues, hint: entry.hint, hintSeen: world.journal.hints.includes(entry.id) });
    if (!done) break; // the next entry stays hidden until this one is done
  }
  return out;
}

/** Record a townsperson's line. Returns true if it was a new clue. */
export function hearTownLine(world: World, town: string, speaker: number): boolean {
  const id = `${town}#${speaker}`;
  if (!TOWN_CLUES[id] || world.journal.clues.includes(id)) return false;
  world.journal.clues.push(id);
  return true;
}

/** Record one of the other clues (Lord British, the prayer, the Time Lord). */
export function hearClue(world: World, id: string): void {
  if (OTHER_CLUES[id] && !world.journal.clues.includes(id)) world.journal.clues.push(id);
}

export function markHintSeen(world: World, id: string): void {
  if (!world.journal.hints.includes(id)) world.journal.hints.push(id);
}

/**
 * After anything that may move the journal on: compare the revealed
 * entries' states with those last noted and, on a change, note the new
 * ones and print "Journal updated". Clues alone do not count unless they
 * turn an entry from open to heard, which is a state change too.
 */
export function journalCheck(world: World, io: GameIO): boolean {
  if (!journalSnapshot(world)) return false;
  io.print('Journal updated\n');
  return true;
}

/** Note the revealed entries' states as seen; true if they differed from the last note. */
export function journalSnapshot(world: World): boolean {
  const now = journalLines(world).map((l) => `${l.id}:${l.state}`);
  const before = world.journal.seen;
  if (now.length === before.length && now.every((s, i) => s === before[i])) return false;
  world.journal.seen = now;
  return true;
}
