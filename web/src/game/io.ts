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

  /** Play a sound effect by file name without extension, e.g. "Step". (`PlaySoundFile`) */
  sound(name: string): void;

  /** Redraw the map viewport around the party. (`DrawMap(xpos, ypos)`) */
  redrawMap(): void;
  /** Briefly invert the map viewport. (`InverseTiles`) */
  flashTiles(): Promise<void>;
  /** Briefly highlight one member's stats box. (`InverseChar`) */
  flashMember(member: number): Promise<void>;
  /** Redraw the four character stat boxes if anything changed. (`ShowChars`) */
  updateStats(force?: boolean): void;
  /** Redraw the wind indicator on the bottom border. (`ShowWind`) */
  showWind(): void;
  /** Redraw the moon phase indicators on the top border. (`DrawMoonGateStuff`, display part) */
  showMoons(): void;
  /** Black out the map viewport. (`ClearTiles`) */
  clearTiles(): void;

  /** Wait `ms` milliseconds while keeping animations running. (`IdleUntil`) */
  pause(ms: number): Promise<void>;
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
  DeathMale: 'DeathMale',
  DeathFemale: 'DeathFemale',
  BigDeath: 'BigDeath',
  TorchIgnite: 'TorchIgnite',
} as const;
