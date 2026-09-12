/**
 * io.ts
 *
 * The boundary between game logic and the browser. Game code talks to the
 * screen, keyboard and speaker only through this interface, so the logic can
 * be unit-tested with a fake and the renderer can be swapped.
 *
 * The original was written in a blocking style (`WaitKeyMouse()` spun until a
 * key arrived). A browser cannot block, so every wait is a Promise and every
 * game routine that might wait is `async`.
 */

/** Single-character key codes used throughout the game logic. */
export const Key = {
  Left: '\x1c',
  Right: '\x1d',
  Up: '\x1e',
  Down: '\x1f',
  Enter: '\r',
  Backspace: '\b',
  Escape: '\x1b',
  Space: ' ',
} as const;

/** Music tracks, numbered as `gSongNext` was in the C source. */
export const Music = {
  None: 0,
  Sosaria: 1,
  Town: 2,
  Castle: 3,
  Dungeon: 4,
  Combat: 5,
  Shop: 6,
  ExodusCastle: 7,
  LordBritish: 8,
  Shrine: 10,
  Ambrosia: 11,
} as const;

export interface GameIO {
  /** Print to the scrolling message area. `\n` starts a new line. (`UPrintWin`) */
  print(text: string): void;
  /** Print entry `n` (1-based, as in the C source) of the Messages table. (`UPrintMessage`) */
  printMessage(n: number): void;
  /** Draw the command prompt on the bottom line and move the cursor after it. (`DrawPrompt`) */
  prompt(): void;

  /** Wait for the next key press. (`WaitKeyMouse`) */
  waitKey(): Promise<string>;
  /** Wait for a key, or resolve `null` after `ms` milliseconds. Used for the idle "Pass". */
  waitKeyOrTimeout(ms: number): Promise<string | null>;
  /** Discard any queued key presses. (`FlushEvents`) */
  flushKeys(): void;
  /**
   * Read a line of text at the cursor with a blinking cursor, echoing each
   * character. Backspace edits; Enter finishes. (`UInputText`)
   */
  inputText(maxChars: number, numbersOnly: boolean): Promise<string>;

  /** Play a sound effect by file name without extension, e.g. "Step". (`PlaySoundFile`) */
  sound(name: string): void;
  /** Select the background music track (`gSongNext`). Music is optional; may be a no-op. */
  music(track: number): void;

  /** Redraw the map viewport around the party (or the combat arena, or the dungeon). (`DrawMap`) */
  redrawMap(): void;
  /** Briefly invert the map viewport. (`InverseTiles`) */
  flashTiles(): Promise<void>;
  /** Briefly highlight one member's stats box. (`InverseChar`) */
  flashMember(member: number): Promise<void>;
  /** Keep one member's stats box highlighted (combat turn marker). (`InverseChnum`) */
  highlightMember(member: number, on: boolean): void;
  /** Redraw the four character stat boxes if anything changed. (`ShowChars`) */
  updateStats(force?: boolean): void;
  /** Redraw the wind indicator on the bottom border. (`ShowWind`) */
  showWind(): void;
  /** Redraw the moon phase indicators on the top border. (`DrawMoonGateStuff`, display part) */
  showMoons(): void;
  /** Black out the map viewport. (`ClearTiles`) */
  clearTiles(): void;

  /** Show a full-viewport picture: "Fountain", "Rod", "Shrine", "TimeLord". (`ImageDisplay`) */
  showImage(name: string): void;
  /** Draw the whole current map small, with the party blinking, until a key is pressed. (`DrawMiniMap`) */
  showMiniMap(): Promise<void>;
  /** Draw the current dungeon level as a map until a key is pressed. (`DrawMiniDng`) */
  showMiniDungeon(): Promise<void>;
  /** Play the end-of-game colour flash and scrolling text. (`OtherCommand` INSERT ending) */
  playEnding(): Promise<void>;

  /** Wait `ms` milliseconds while keeping animations running. (`IdleUntil`) */
  pause(ms: number): Promise<void>;

  // --- Title screen and party organisation menus -------------------------

  /** Draw the plain border and the Exodus title picture. (`DrawFrame(3)` + `DrawExodusPict`) */
  showTitle(): void;
  /** Draw the in-game border with the stats boxes. (`DrawFrame(1)`) */
  showGameFrame(): void;
  /** Black out the lower part of the title screen where menu text goes. (`ClearBottom`) */
  clearBottom(): void;
  /** Draw text at a cell position, outside the message area. (`UPrint`) */
  textAt(x: number, y: number, text: string): void;
  /** Draw text centred on the 40-column screen. (`CenterMessage`) */
  centreText(y: number, text: string): void;
  /** Read a line of text at a cell position (for the character creation screen). */
  inputTextAt(x: number, y: number, maxChars: number, numbersOnly: boolean): Promise<string>;
}

/**
 * Wait for a key, upper-case it, echo it and start a new line. (`GetKey`)
 * Returns the key as a one-character string.
 */
export async function getKey(io: GameIO): Promise<string> {
  const key = (await io.waitKey()).toUpperCase();
  io.print(key.length === 1 && key >= ' ' ? key : ' ');
  io.print('\n');
  return key;
}

/**
 * Read a member number after a "whom?" prompt. (`GetChar`) Returns 1..4 for
 * a valid choice; any other key gives a number outside that range, which
 * callers treat as "cancel", exactly as the original did.
 */
export async function getChar(io: GameIO): Promise<number> {
  const key = await getKey(io);
  return key.charCodeAt(0) - '0'.charCodeAt(0);
}

/** Read a number of up to two digits. (`UInputNum`) */
export async function inputNumber(io: GameIO, maxDigits = 2): Promise<number> {
  const text = await io.inputText(maxDigits, true);
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/** Sound effect names, matching files in public/sounds. */
export const Sound = {
  Step: 'Step',
  HorseWalk: 'HorseWalk',
  Bump: 'Bump',
  MountHorse: 'MountHorse',
  Hit: 'Hit',
  Attack: 'Attack',
  ForceField: 'ForceField',
  Moongate: 'Moongate',
  Sink: 'Sink',
  Shoot: 'Shoot',
  Error1: 'Error1',
  Error2: 'Error2',
  DeathMale: 'DeathMale',
  DeathFemale: 'DeathFemale',
  BigDeath: 'BigDeath',
  TorchIgnite: 'TorchIgnite',
  Creak: 'Creak',
  Ouch: 'Ouch',
  Alarm: 'Alarm',
  CombatStart: 'CombatStart',
  CombatVictory: 'CombatVictory',
  FailedSpell: 'FailedSpell',
  Immolate: 'Immolate',
  Downwards: 'Downwards',
  Upwards: 'Upwards',
  Invocation: 'Invocation',
  Heal: 'Heal',
  MiscSpell: 'MiscSpell',
  MonsterSpell: 'MonsterSpell',
  Shrine: 'Shrine',
  LBLevelRise: 'LBLevelRise',
  ExpLevelUp: 'ExpLevelUp',
  Swish: ['Swish1', 'Swish2', 'Swish3', 'Swish4'],
} as const;

/** The death sound for a character. */
export function deathSound(sex: string): string {
  return sex === 'F' ? Sound.DeathFemale : Sound.DeathMale;
}
