/**
 * screen.ts
 *
 * The Canvas renderer, and the browser implementation of `GameIO`.
 *
 * The screen is a grid of 40 x 24 cells (`blkSiz` pixels each in the
 * original; `cell` here). The layout is the Apple II one:
 *
 *   columns 0..23,  rows 0..23   border and the 11x11 map viewport (each
 *                                map tile is 2x2 cells, starting at cell 1,1)
 *   columns 24..38, rows 1..11   four character boxes, two rows each,
 *                                separated by border lines at rows 3, 6, 9, 12
 *                                (the Apple II used three rows and 4, 8, 12, 16;
 *                                this port pools gold and food, so the boxes
 *                                shrank and the message area grew)
 *   columns 24..39, rows 13..23  the scrolling message area; the prompt is
 *                                on row 23
 *   row 0                        party gold, moon phases, party food;   row 23  wind
 *
 * Rendering is split in two: the border, text and stats are drawn straight
 * onto the canvas when they change, while the viewport is redrawn twelve
 * times a second from a cached `Viewport` so terrain and creatures animate.
 * In a dungeon the viewport shows the first-person view instead.
 */

import { GraphicsSet, type ImageMap } from './graphics.ts';
import { Keyboard } from './input.ts';
import { SoundPlayer } from './sound.ts';
import { MusicPlayer } from './music.ts';
import { DungeonRenderer } from './dungeonView.ts';
import { World, STARVATION_MODES } from '../game/world.ts';
import { PlayerRecord, levelUpDue } from '../game/player.ts';
import { commandMenu, hasMagic } from '../game/context.ts';
import { memberShape } from '../game/combat.ts';
import { TILE_SETS, KEYBOARD_HELP, CONTROLLER_HELP } from './help.ts';
import { journalLines, journalSnapshot, markHintSeen, type JournalLine } from '../game/journal.ts';
import { CHEATS } from '../game/cheats.ts';
import { Location } from '../game/party.ts';
import { buildViewport, VIEW_SIZE, type Viewport } from '../game/viewport.ts';
import { buildDungeonView, secretMessage } from '../game/dungeon.ts';
import { cellVisible } from '../game/automap.ts';
import { Key, Sound, type GameIO, type MenuOption, type CommandScope, type MenuPlacement } from '../game/io.ts';
import {
  controllerKeyFor,
  COMMAND_MENUS,
  BUTTON_SHORTCUTS,
  DIRECTION_KEYS,
  ON_SCREEN_KEYBOARD,
  OSK_DELETE,
  OSK_DONE,
  layoutMenu,
  drawMenu,
  moveCursor,
  GamepadReader,
  type MenuWindow,
  HINT_ROWS,
  wrapText,
} from './menus.ts';
import { DungeonCell } from '../game/world.ts';

export const COLUMNS = 40;
export const ROWS = 24;

/** Border pieces in row 0 of the UI sheet, by their 1-based number in `DrawFramePiece()`. */
const Piece = {
  TopLeft: 1,
  TopTee: 2,
  TopRight: 3,
  LeftTee: 4,
  RightTee: 6,
  BottomLeft: 7,
  BottomTee: 8,
  BottomRight: 9,
  Horizontal: 10,
  Vertical: 11,
  CapLeft: 12,
  CapRight: 13,
} as const;

/** The message area. */
/** Character boxes: two rows each, three rows apart, separators below each. */
const BOX_ROWS = 2;

/** Pages over the map (Help, the Journal): text column, width and rows. */
const PAGE_LEFT = 2;
const PAGE_WIDTH = 20;
const PAGE_TOP = 1;
const PAGE_ROWS = 19;
const BOX_PITCH = 3;
const BOX_SEPARATORS = [3, 6, 9, 12];
const BOXES_BOTTOM = 12;
const TEXT_LEFT = 24;
const TEXT_RIGHT = 40; // exclusive
const TEXT_TOP = 13;
const TEXT_BOTTOM = 24; // exclusive

const ANIMATION_INTERVAL_MS = 1000 / 12;

/** The 4 x 6 grid of small tiles used for the dungeon map, in row 1 of the UI sheet. */
const DUNGEON_MAP_PIECE_COLUMN = 7;
/** The auto-map's 5x5 overlay: the top-right corner of the message area, under the fourth box. */
const MAP_OVERLAY_SIZE = 5;
const MAP_OVERLAY_LEFT = 35;
const MAP_OVERLAY_TOP = 13;

/**
 * Which of the nine map pieces (UI sheet row 1 from column 7) draws a
 * dungeon cell: door, secret door, wall, both ladders, up, down, open,
 * anything else; piece 8 is the party marker.
 */
function dungeonMapPiece(value: number): number {
  switch (value) {
    case DungeonCell.Door:
      return 0;
    case DungeonCell.SecretDoor:
      return 1;
    case DungeonCell.Wall:
      return 2;
    case DungeonCell.LadderUp | DungeonCell.LadderDown:
      return 3;
    case DungeonCell.LadderUp:
      return 4;
    case DungeonCell.LadderDown:
      return 5;
    case DungeonCell.Open:
      return 6;
    default:
      return 7;
  }
}

export class Screen implements GameIO {
  private readonly ctx: CanvasRenderingContext2D;
  /** Pixel size of one cell. */
  readonly cell: number;

  private view: Viewport | null = null;
  private viewDirty = true;
  /** While a picture or map covers the viewport the animation loop leaves it alone. */
  private viewCovered = false;
  /** True while the in-game border is shown (false on the title screens). */
  private frameShown = false;
  /** Text drawn on the current title screen, replayed when the graphics set changes. */
  private titleText: { x: number; y: number; text: string }[] = [];
  private lastFrame = 0;
  /** Auto-map: the 5x5 overlay is on screen, so text under it is held back. */
  private overlayShown = false;
  /** Auto-map: the secret-door piece (a wall with one pixel out of place), per tile set. */
  private secretDoorPiece: HTMLCanvasElement | null = null;
  private dungeonRenderer: DungeonRenderer | null;

  /** Text cursor in the message area. (`wx`, `wy`) */
  private cursorX = TEXT_LEFT + 1;
  private cursorY = ROWS - 1;
  /** Characters currently shown in the message area, so it can be scrolled. */
  private textRows: string[][] = [];
  /**
   * A turn that prints exactly what the previous turn printed folds into it
   * with counts: "North (x5)" over "POISON! (x5)". `prevTurn` is the last
   * turn's block of lines, where each now sits and how often it has
   * repeated; `thisTurn` gathers the current turn's lines. Lines fold one by
   * one while they match; the first difference, or a turn that ends short,
   * unfolds what matched and prints the turn afresh.
   */
  private prevTurn: { texts: string[]; rows: number[]; counts: number[] } | null = null;
  private thisTurn: { texts: string[]; rows: number[] } = { texts: [], rows: [] };
  private foldedThisTurn = 0;
  private brokenThisTurn = false;
  private linesSincePrompt = 0;

  /** Last values drawn in each stats box, to avoid redrawing every turn. */
  private statsCache: string[] = ['', '', '', ''];
  private highlighted = new Set<number>();

  /**
   * 'keyboard': the Apple II letter commands. 'controller': d-pad movement
   * and pop-up menus, driven by a gamepad or by WASD/Enter/Escape/ZXCV.
   */
  inputMode: 'keyboard' | 'controller' = 'keyboard';
  /** Called when a gamepad press switches the mode to 'controller'. */
  onModeChange: (() => void) | null = null;
  /** What the PAUSED box covers, restored when the window regains focus. */
  private underPaused: { image: ImageData; x: number; y: number } | null = null;
  /** Called when anything in the Settings menu changes, so the page can remember it. */
  onSettingsChange: (() => void) | null = null;
  /** Name of the tile set in use (see help.ts TILE_SETS). */
  tileSetName = 'Standard';
  /**
   * How the party on foot is drawn here: 'grid' is the 2x2 of members (Standard,
   * overworld), 'line' the leader with the others following in a line (Standard
   * in towns and castles, Nintendo everywhere), 'symbol' the Apple II's single figure.
   */
  private get partyStyle(): 'grid' | 'line' | 'symbol' {
    if (this.tileSetName === 'Nintendo') return 'line';
    if (this.tileSetName === 'Standard') return this.world.inTownOrCastle ? 'line' : 'grid';
    return 'symbol';
  }
  /** Standard alone shows the red burst on a hit instead of the HIT tile. */
  private get burstTiles(): boolean {
    return this.tileSetName === 'Standard';
  }
  private readonly gamepads: GamepadReader;
  /** The menu window being shown, drawn over the map every frame. */
  private menu: MenuWindow | null = null;
  /** Scripted keys (auto-combat), read before the keyboard. (`Macro[]`) */
  private macro: string[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private gfx: GraphicsSet,
    private readonly images: ImageMap,
    private readonly keyboard: Keyboard,
    private readonly sounds: SoundPlayer,
    private readonly musicPlayer: MusicPlayer,
    private readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.cell = Math.floor(canvas.width / COLUMNS);
    for (let r = 0; r < TEXT_BOTTOM - TEXT_TOP; r++) this.textRows.push(Array<string>(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    this.dungeonRenderer = DungeonRenderer.forSet(gfx);
    // A pause (window not focused) should not eat into a combat turn's timer.
    keyboard.onResume = (pausedMs) => {
      if (this.world.combat) this.world.combat.markedAt += pausedMs;
    };
    this.gamepads = new GamepadReader(keyboard, () => {
      if (this.inputMode !== 'controller') {
        this.inputMode = 'controller';
        this.onModeChange?.();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------------------
  // Frames and title screen
  // -------------------------------------------------------------------------

  private piece(n: number, x: number, y: number): void {
    this.gfx.drawUiPiece(this.ctx, n - 1, 0, x * this.cell, y * this.cell, this.cell);
  }

  private black(x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(x * this.cell, y * this.cell, w * this.cell, h * this.cell);
  }

  /** Draw the in-game border. (`DrawFrame(1)`) */
  showGameFrame(): void {
    this.viewCovered = false;
    this.frameShown = true;
    this.black(0, 0, COLUMNS, ROWS);
    const piece = (n: number, x: number, y: number) => this.piece(n, x, y);
    for (let x = 1; x < 39; x++) piece(Piece.Horizontal, x, 0);
    for (let x = 1; x < 23; x++) piece(Piece.Horizontal, x, 23);
    for (let x = 24; x < 39; x++) for (const y of BOX_SEPARATORS) piece(Piece.Horizontal, x, y);
    for (let y = 1; y < 23; y++) {
      piece(Piece.Vertical, 0, y);
      piece(Piece.Vertical, 23, y);
    }
    for (let y = 1; y < BOXES_BOTTOM; y++) piece(Piece.Vertical, 39, y);
    piece(Piece.TopLeft, 0, 0);
    piece(Piece.TopRight, 39, 0);
    piece(Piece.BottomLeft, 0, 23);
    piece(Piece.TopTee, 23, 0);
    piece(Piece.BottomRight, 39, BOXES_BOTTOM);
    piece(Piece.BottomRight, 23, 23);
    for (const y of BOX_SEPARATORS) piece(Piece.LeftTee, 23, y);
    for (const y of BOX_SEPARATORS.slice(0, 3)) piece(Piece.RightTee, 39, y);
    // Member numbers 1-4 sit in the separators above each box.
    for (let i = 0; i < 4; i++) {
      piece(Piece.CapLeft, 30, i * BOX_PITCH);
      piece(Piece.CapRight, 32, i * BOX_PITCH);
      this.drawText(String(i + 1), 31, i * BOX_PITCH);
    }
    this.textRows.forEach((row) => row.fill(' '));
    this.prevTurn = null;
    this.thisTurn = { texts: [], rows: [] };
    this.foldedThisTurn = 0;
    this.redrawTextArea();
    this.showWind();
    this.showMoons();
    this.statsCache = ['', '', '', ''];
    this.updateStats(true);
    this.viewDirty = true;
  }

  /** The plain border with the Exodus picture. (`DrawFrame(3)`, `DrawExodusPict`) */
  showTitle(): void {
    this.viewCovered = true;
    this.frameShown = false;
    this.titleText = [];
    this.view = null;
    this.black(0, 0, COLUMNS, ROWS);
    for (let x = 1; x < 39; x++) {
      this.piece(Piece.Horizontal, x, 0);
      this.piece(Piece.Horizontal, x, 23);
    }
    for (let y = 1; y < 23; y++) {
      this.piece(Piece.Vertical, 0, y);
      this.piece(Piece.Vertical, 39, y);
    }
    this.piece(Piece.TopLeft, 0, 0);
    this.piece(Piece.TopRight, 39, 0);
    this.piece(Piece.BottomLeft, 0, 23);
    this.piece(Piece.BottomRight, 39, 23);
    const exodus = this.images.get('Exodus');
    if (exodus) {
      const c = this.cell;
      this.ctx.drawImage(exodus, 5.25 * c, 1.25 * c, 29.5 * c, 8.375 * c);
    }
  }

  clearBottom(): void {
    this.black(1, 10, 38, 13);
    this.titleText = this.titleText.filter((t) => t.y < 10);
  }

  /**
   * Switch to another tile set (font and border pieces included) and redraw
   * everything on screen from what the Screen already knows.
   */
  setGraphics(gfx: GraphicsSet): void {
    this.gfx = gfx;
    this.greenFigures.clear();
    this.secretDoorPiece = null;
    this.dungeonRenderer = DungeonRenderer.forSet(gfx);
    this.redrawAll();
  }

  /** Redraw the whole screen from what the Screen already knows (after a tile change or a full-screen page). */
  private redrawAll(): void {
    if (this.frameShown) {
      const rows = this.textRows.map((r) => [...r]);
      const cx = this.cursorX;
      const cy = this.cursorY;
      this.showGameFrame();
      this.textRows = rows;
      this.cursorX = cx;
      this.cursorY = cy;
      this.redrawTextArea();
      this.highlighted.forEach((m) => this.invert(24, m * BOX_PITCH + 1, 15, BOX_ROWS));
    } else {
      const texts = this.titleText;
      this.showTitle();
      for (const t of texts) this.drawText(t.text, t.x, t.y);
      this.titleText = texts;
    }
    this.showMenuNow();
  }

  // -------------------------------------------------------------------------
  // Text
  // -------------------------------------------------------------------------

  /** Draw a string with the bitmap font at cell (x, y), no wrapping. */
  drawText(text: string, x: number, y: number, colour?: string): void {
    const { ctx, cell } = this;
    if (this.overlayShown && y >= MAP_OVERLAY_TOP && y < MAP_OVERLAY_TOP + MAP_OVERLAY_SIZE && x + text.length > MAP_OVERLAY_LEFT) {
      // Only the part left of the overlay is drawn; the overlay repaints itself.
      const keep = Math.max(0, MAP_OVERLAY_LEFT - x);
      if (keep === 0) return;
      text = text.slice(0, keep);
    }
    for (let i = 0; i < text.length; i++) {
      ctx.fillStyle = '#000';
      ctx.fillRect((x + i) * cell, y * cell, cell, cell);
      this.gfx.drawGlyph(ctx, text[i], (x + i) * cell, y * cell, cell);
    }
    if (colour) {
      // Tint the white glyphs: multiplying leaves the black background black.
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = colour;
      ctx.fillRect(x * cell, y * cell, text.length * cell, cell);
      ctx.restore();
    }
  }

  textAt(x: number, y: number, text: string): void {
    this.drawText(text, x, y);
    if (!this.frameShown) this.titleText.push({ x, y, text });
  }

  centreText(y: number, text: string): void {
    this.textAt(20 - Math.floor(text.length / 2), y, text);
  }

  private redrawTextArea(): void {
    for (let r = 0; r < this.textRows.length; r++) this.drawText(this.textRows[r].join(''), TEXT_LEFT, TEXT_TOP + r);
  }

  /** Scroll the message area up one line. (`UTextScroll`) */
  private scrollText(): void {
    this.textRows.shift();
    this.textRows.push(Array<string>(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    // The folding records follow their lines up the screen; a block that scrolls off is forgotten.
    if (this.prevTurn) {
      this.prevTurn.rows = this.prevTurn.rows.map((r) => r - 1);
      if (this.prevTurn.rows[0] < 0) this.prevTurn = null;
    }
    this.thisTurn.rows = this.thisTurn.rows.map((r) => r - 1);
    while (this.thisTurn.rows.length && this.thisTurn.rows[0] < 0) {
      this.thisTurn.rows.shift();
      this.thisTurn.texts.shift();
    }
    this.redrawTextArea();
    // The prompt corner piece is part of the border; redraw it after scrolling.
    this.piece(Piece.BottomRight, 23, 23);
  }

  print(text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        if (!this.foldRepeat()) this.newline();
        continue;
      }
      if (ch < ' ') continue;
      if (this.cursorX >= TEXT_RIGHT) continue; // the original simply ran off the edge
      this.textRows[this.cursorY - TEXT_TOP][this.cursorX - TEXT_LEFT] = ch;
      this.drawText(ch, this.cursorX, this.cursorY);
      this.cursorX++;
    }
  }

  private newline(): void {
    this.cursorX = TEXT_LEFT;
    this.cursorY++;
    if (this.cursorY >= TEXT_BOTTOM) {
      this.cursorY = TEXT_BOTTOM - 1;
      this.scrollText();
    }
  }

  /** Write a whole message-area row (text with its prompt column kept) and draw it. */
  private setRow(row: number, text: string): void {
    const width = TEXT_RIGHT - TEXT_LEFT;
    const padded = text.slice(0, width).padEnd(width);
    this.textRows[row] = padded.split('');
    this.drawText(padded, TEXT_LEFT, TEXT_TOP + row);
  }

  private countLabel(text: string, count: number): string {
    return count > 1 && text.trim() ? `${text} (x${count})` : text;
  }

  /**
   * At the end of a line: if this turn has matched the previous turn's block
   * so far and this line matches its next line too, fold it in (count up,
   * leave the cursor where the line began) and return true. Otherwise the
   * line is the turn's own; any lines folded earlier in this turn are unfolded
   * and printed again ahead of it, so a turn that only starts like the last
   * one is shown in full.
   */
  private foldRepeat(): boolean {
    const row = this.cursorY - TEXT_TOP;
    const raw = this.textRows[row].join('').trimEnd(); // keeps the prompt column's leading space
    const k = this.linesSincePrompt++;
    const prev = this.prevTurn;
    const contiguous = prev !== null && prev.rows[prev.rows.length - 1] === row - 1;
    if (!this.brokenThisTurn && prev && contiguous && k === this.foldedThisTurn && k < prev.texts.length && prev.texts[k] === raw) {
      prev.counts[k]++;
      this.setRow(row, '');
      this.setRow(prev.rows[k], this.countLabel(prev.texts[k], prev.counts[k]));
      this.foldedThisTurn++;
      this.cursorX = TEXT_LEFT;
      return true;
    }
    if (this.foldedThisTurn > 0) this.unfold(raw);
    this.brokenThisTurn = true;
    this.thisTurn.texts.push(raw);
    this.thisTurn.rows.push(row);
    return false;
  }

  /** Take back the lines folded this turn and print them again as this turn's own, ahead of `pending` (the line now on the bottom row). */
  private unfold(pending: string | null): void {
    const prev = this.prevTurn!;
    const row = this.cursorY - TEXT_TOP;
    const lines = prev.texts.slice(0, this.foldedThisTurn);
    lines.forEach((text, i) => {
      prev.counts[i]--;
      this.setRow(prev.rows[i], this.countLabel(text, prev.counts[i]));
    });
    this.foldedThisTurn = 0;
    for (const text of lines) {
      this.setRow(this.cursorY - TEXT_TOP, text);
      this.thisTurn.texts.push(text);
      this.thisTurn.rows.push(this.cursorY - TEXT_TOP);
      this.newline();
    }
    if (pending !== null) this.setRow(this.cursorY - TEXT_TOP, pending);
    void row;
  }

  printMessage(n: number): void {
    const s = this.world.resources.strings.Messages[n - 1];
    this.print(s ?? `[msg ${n}]`);
  }

  prompt(): void {
    this.endTurn(); // may print unfolded lines, so before the prompt row is cleared
    this.piece(Piece.BottomTee, 23, 23);
    this.piece(Piece.CapLeft, 24, 23);
    this.textRows[TEXT_BOTTOM - 1 - TEXT_TOP].fill(' ');
    for (let x = TEXT_LEFT + 1; x < TEXT_RIGHT; x++) this.drawText(' ', x, TEXT_BOTTOM - 1);
    this.cursorX = TEXT_LEFT + 1;
    this.cursorY = TEXT_BOTTOM - 1;
  }

  /** A new command prompt: the block just printed becomes the one the next turn may fold into. */
  private endTurn(): void {
    const prev = this.prevTurn;
    if (this.foldedThisTurn > 0 && prev && this.foldedThisTurn < prev.texts.length) {
      // The turn ended before matching the whole block: show it on its own.
      this.unfold(null);
    }
    if (this.thisTurn.texts.length > 0) {
      this.prevTurn = { texts: this.thisTurn.texts, rows: this.thisTurn.rows, counts: this.thisTurn.texts.map(() => 1) };
    }
    this.thisTurn = { texts: [], rows: [] };
    this.foldedThisTurn = 0;
    this.brokenThisTurn = false;
    this.linesSincePrompt = 0;
  }

  // -------------------------------------------------------------------------
  // Keyboard, text input and sound
  // -------------------------------------------------------------------------

  /**
   * Read a key, translating the controller stand-ins when in controller
   * mode (WASD to the d-pad, Enter/Z to A, Escape/X to B, C to X, V to Y).
   */
  private async readKey(timeoutMs?: number): Promise<string | null> {
    const scripted = this.macro.shift();
    if (scripted !== undefined) return scripted;
    const key = timeoutMs === undefined ? await this.keyboard.nextKey() : await this.keyboard.nextKeyOrTimeout(timeoutMs);
    if (key === null) return null;
    return this.inputMode === 'controller' ? controllerKeyFor(key) : key;
  }

  async waitKey(): Promise<string> {
    return (await this.readKey()) as string;
  }

  waitKeyOrTimeout(ms: number): Promise<string | null> {
    return this.readKey(ms);
  }

  flushKeys(): void {
    this.keyboard.flush();
    this.macro.length = 0;
  }

  queueKeys(keys: string[]): void {
    this.macro = [...keys];
  }

  /** Scripted keys are Apple II keys, so prompts read them keyboard-style whatever the mode. */
  private get promptMode(): 'keyboard' | 'controller' {
    return this.macro.length > 0 ? 'keyboard' : this.inputMode;
  }

  // --- Semantic prompts: keyboard reads a key, controller shows a menu ----

  /**
   * Show a menu and run it until the player picks an item (its index) or
   * cancels (-1). Letter keys still pick the matching option, so a keyboard
   * works in controller mode too.
   */
  private async runMenu(title: string, options: MenuOption[], columns = 1, place?: MenuPlacement, cursor = 0): Promise<number> {
    const visible = options.filter((o) => !o.hidden);
    const menu = layoutMenu(
      title,
      visible.map((o) => o.label),
      columns,
    );
    if (visible.some((o) => o.hint)) menu.hints = visible.map((o) => o.hint);
    if (visible.some((o) => o.disabled)) menu.disabled = visible.map((o) => !!o.disabled);
    if (visible.some((o) => o.colour)) menu.colours = visible.map((o) => o.colour);
    if (place) this.placeMenu(menu, place);
    else if (cursor > 0 && cursor < menu.items.length) {
      menu.cursor = cursor;
      if (menu.cursor >= menu.visibleRows) menu.top = menu.cursor - menu.visibleRows + 1;
    }
    this.openMenu(menu);
    try {
      for (;;) {
        const key = await this.readKey();
        if (key === null) continue;
        if (moveCursor(menu, key)) {
          this.showMenuNow();
          continue;
        }
        // Enter and Escape serve keyboard users where a menu is shown in both modes.
        if (key === Key.A || key === Key.Enter) {
          if (!visible.length) return -1;
          if (visible[menu.cursor].disabled) {
            this.sound(Sound.Error1);
            continue;
          }
          return options.indexOf(visible[menu.cursor]);
        }
        if (key === Key.B || key === Key.Escape) return -1;
        const byKey = options.findIndex((o) => o.key === key.toUpperCase());
        if (byKey >= 0) {
          if (options[byKey].disabled) {
            this.sound(Sound.Error1);
            continue;
          }
          return byKey;
        }
      }
    } finally {
      this.closeMenu();
    }
  }

  /**
   * A placed window sits at the given row, centred on the whole screen and
   * as wide as its labels need. On a title screen it replaces the text at
   * those rows; over the game frame it simply covers what is there, which
   * comes back when it closes.
   */
  private placeMenu(menu: MenuWindow, place: MenuPlacement): void {
    const longest = Math.max(menu.title.length, ...menu.items.map((s) => s.length));
    menu.width = Math.min(COLUMNS - 2, longest + 4); // up to the frame's inner edge, for a long title
    menu.y = place.row;
    menu.x = Math.floor((COLUMNS - menu.width) / 2);
    // Keep the window (and its hint row) inside the frame; long lists scroll.
    const available = ROWS - 1 - place.row - 2 - (menu.hints ? HINT_ROWS : 0);
    menu.visibleRows = Math.max(1, Math.min(menu.visibleRows, available));
    if (place.cursor !== undefined && place.cursor >= 0 && place.cursor < menu.items.length) {
      menu.cursor = place.cursor;
      if (menu.cursor >= menu.visibleRows) menu.top = menu.cursor - menu.visibleRows + 1;
    }
    if (!this.frameShown) this.black(1, place.row, COLUMNS - 2, menu.visibleRows + 2 + (menu.hints ? HINT_ROWS : 0));
  }

  /**
   * The Settings menu, on the title screen or over the map. Each toggle
   * shows its state and flips in place; Tiles opens the list of sets; Help
   * shows the pages for the current input mode.
   */
  async showSettings(): Promise<void> {
    const w = this.world;
    const onOff = (b: boolean) => (b ? 'On' : 'Off');
    const place: MenuPlacement | undefined = this.frameShown ? undefined : { row: 13, title: 'Settings' };
    let cursor = 0;
    for (;;) {
      const options: MenuOption[] = [
        { key: 'I', label: `Input: ${this.inputMode === 'controller' ? 'Controller' : 'Keyboard'}` },
        { key: 'T', label: `Tiles: ${this.tileSetName}` },
        { key: 'A', label: `Auto combat: ${onOff(w.autoCombat)}` },
        { key: 'P', label: `Poison kills: ${onOff(w.poisonKills)}` },
        { key: 'V', label: `Starving: ${w.starvation[0].toUpperCase()}${w.starvation.slice(1)}` },
        { key: 'X', label: `Balanced XP: ${onOff(w.balancedXp)}` },
        { key: 'S', label: `Sound effects: ${onOff(w.soundEnabled)}` },
        { key: 'M', label: `Music: ${onOff(this.musicPlayer.enabled)}` },
        { key: 'H', label: 'Help' },
        { key: 'B', label: 'Back' },
      ];
      const picked = await this.runMenu('Settings', options, 1, place && { ...place, cursor }, cursor);
      if (picked < 0) return;
      cursor = picked;
      switch (options[picked].key) {
        case 'I':
          this.inputMode = this.inputMode === 'controller' ? 'keyboard' : 'controller';
          this.onModeChange?.();
          break;
        case 'T':
          await this.chooseTiles();
          break;
        case 'A':
          w.autoCombat = !w.autoCombat;
          w.onAutoCombatChange?.();
          break;
        case 'P':
          w.poisonKills = !w.poisonKills;
          break;
        case 'V':
          w.starvation = STARVATION_MODES[(STARVATION_MODES.indexOf(w.starvation) + 1) % STARVATION_MODES.length];
          break;
        case 'X':
          w.balancedXp = !w.balancedXp;
          break;
        case 'S':
          w.soundEnabled = !w.soundEnabled;
          break;
        case 'M':
          this.musicPlayer.enabled = !this.musicPlayer.enabled;
          if (this.musicPlayer.enabled) this.musicPlayer.play(w.music);
          else this.musicPlayer.play(0);
          break;
        case 'H':
          await this.showHelp();
          break;
        default:
          return;
      }
      this.onSettingsChange?.();
    }
  }

  /** The Tiles sub-menu: pick a set and switch to it. */
  private async chooseTiles(): Promise<void> {
    const options = TILE_SETS.map((name) => ({ key: '', label: name }));
    const current = Math.max(0, TILE_SETS.indexOf(this.tileSetName));
    const place: MenuPlacement | undefined = this.frameShown ? undefined : { row: 13, title: 'Tiles', cursor: current };
    const picked = await this.runMenu('Tiles', options, 1, place, current);
    if (picked < 0) return;
    try {
      const gfx = await GraphicsSet.load(TILE_SETS[picked]);
      this.tileSetName = TILE_SETS[picked];
      this.setGraphics(gfx);
    } catch {
      /* keep the current set */
    }
  }

  // -------------------------------------------------------------------------
  // Pages over the map: Help and the Journal
  // -------------------------------------------------------------------------

  /**
   * A page is a boxed screen of text over the map area, with its title in
   * the box's top edge as a menu window has it: up to PAGE_ROWS lines of
   * PAGE_WIDTH characters from row 1, a note row, then two footer rows.
   * Over the game frame the box is the map's own frame; on a title screen
   * the same box is drawn in the plain frame first. Returns whether the
   * viewport was already covered, for closePage.
   */
  private openPage(): boolean {
    const wasCovered = this.viewCovered;
    this.viewCovered = true; // stop the viewport repainting under the page
    if (!this.frameShown) {
      this.black(1, 1, COLUMNS - 2, ROWS - 2); // the title picture comes back on closing
      for (let y = 1; y < 23; y++) this.piece(Piece.Vertical, 23, y);
      this.piece(Piece.TopTee, 23, 0);
      this.piece(Piece.BottomTee, 23, 23);
    }
    return wasCovered;
  }

  private closePage(wasCovered: boolean): void {
    this.viewCovered = wasCovered;
    this.redrawAll();
  }

  private drawPage(title: string, lines: string[], footer: string[], note = '', cursor = -1): void {
    this.black(1, 0, 22, 23);
    for (let x = 1; x <= 22; x++) this.piece(Piece.Horizontal, x, 0);
    const t = title.slice(0, PAGE_WIDTH);
    const tx = 1 + Math.floor((22 - t.length) / 2);
    this.black(tx, 0, t.length, 1);
    this.drawText(t, tx, 0);
    lines.slice(0, PAGE_ROWS).forEach((line, i) => this.drawText(line.slice(0, PAGE_WIDTH), PAGE_LEFT, PAGE_TOP + i));
    if (cursor >= 0 && cursor < Math.min(lines.length, PAGE_ROWS)) this.invert(PAGE_LEFT - 1, PAGE_TOP + cursor, PAGE_WIDTH + 2, 1);
    if (note) this.drawText(note.slice(0, PAGE_WIDTH), PAGE_LEFT, PAGE_TOP + PAGE_ROWS);
    footer.forEach((line, i) => this.drawText(line.slice(0, PAGE_WIDTH), PAGE_LEFT, PAGE_TOP + PAGE_ROWS + 1 + i));
  }

  /**
   * The help pages for the current input mode, in a box over the map. Any
   * key (A) turns the page, Escape or B closes, and Y (V on the keyboard
   * in controller mode) opens the cheat menu.
   */
  private async showHelp(): Promise<void> {
    const pages = this.inputMode === 'controller' ? CONTROLLER_HELP : KEYBOARD_HELP;
    const footer = this.inputMode === 'controller' ? ['A next  B close', 'Y cheats'] : ['Any key next  Esc', 'Y cheats'];
    const wasCovered = this.openPage();
    let note = '';
    try {
      for (let index = 0; index < pages.length; ) {
        this.drawPage(pages[index].title, pages[index].lines, footer, note);
        const key = await this.readKey();
        if (key === Key.Escape || key === Key.B) break;
        if (key === Key.Y || key === 'y' || key === 'Y') {
          note = await this.cheatMenu();
          continue;
        }
        index++;
      }
    } finally {
      this.closePage(wasCovered);
    }
  }

  /**
   * The quest journal (J): the revealed entries as a list, each marked
   * open, heard or done; choosing one shows its page with its state, the
   * clues heard about it and, on request, its hint. What the player has
   * seen is noted on closing, so "Journal updated" only marks real change.
   */
  async showJournal(): Promise<void> {
    const controller = this.inputMode === 'controller';
    const wasCovered = this.openPage();
    let cursor = 0;
    try {
      for (;;) {
        const entries = journalLines(this.world);
        const marks = { open: '-', heard: '?', done: '*' };
        const lines = entries.map((e) => `${marks[e.state]} ${e.title}`);
        const footer = [controller ? 'A open  B close' : 'Enter opens  Esc', '- open ? heard *done'];
        this.drawPage('Journal', lines, footer, '', cursor);
        const key = await this.readKey();
        if (key === Key.Escape || key === Key.B) break;
        if (key === Key.Up && cursor > 0) cursor--;
        else if (key === Key.Down && cursor < entries.length - 1) cursor++;
        else if (key === Key.Enter || key === Key.A) await this.journalEntry(entries[cursor]);
      }
    } finally {
      journalSnapshot(this.world);
      this.closePage(wasCovered);
    }
  }

  /** One journal entry's page; Up and Down scroll when it runs long. */
  private async journalEntry(entry: JournalLine): Promise<void> {
    const controller = this.inputMode === 'controller';
    let top = 0;
    for (;;) {
      const state = entry.state === 'done' ? 'Done.' : entry.state === 'heard' ? 'Heard of.' : 'Not yet.';
      const lines: string[] = [state];
      if (entry.note) lines.push(...wrapText(entry.note, PAGE_WIDTH, 4));
      for (const clue of entry.clues) {
        lines.push('');
        lines.push(...wrapText(`${clue.from}: ${clue.text}`, PAGE_WIDTH, 12));
      }
      const hintSeen = this.world.journal.hints.includes(entry.id);
      if (hintSeen) {
        lines.push('');
        lines.push(...wrapText(`Hint: ${entry.hint}`, PAGE_WIDTH, 12));
      }
      const maxTop = Math.max(0, lines.length - PAGE_ROWS);
      top = Math.min(top, maxTop);
      const scroll = [top > 0 && 'Up', top < maxTop && 'Down'].filter(Boolean).join('/');
      const footer = [controller ? 'B back' : 'Esc back', hintSeen ? '' : controller ? 'Y for a hint' : 'H for a hint'];
      this.drawPage(entry.title, lines.slice(top), footer, scroll && `${scroll} for more`);
      const key = await this.readKey();
      if (key === Key.Escape || key === Key.B) return;
      if (key === Key.Up) top = Math.max(0, top - 1);
      else if (key === Key.Down) top = Math.min(maxTop, top + 1);
      else if (!hintSeen && (key === Key.Y || key === 'h' || key === 'H')) {
        markHintSeen(this.world, entry.id);
        top = lines.length; // scroll to the hint (clamped next time round)
      }
    }
  }

  /** The cheat menu over the help page. Returns a confirmation line, or '' when nothing was done. */
  private async cheatMenu(): Promise<string> {
    const cheats = CHEATS.filter((c) => c.available(this.world));
    const options: MenuOption[] = [...cheats.map((c) => ({ key: c.key, label: c.label })), { key: 'B', label: 'Back' }];
    const picked = await this.runMenu('Cheats', options, 1, { row: 8, title: 'Cheats' });
    if (picked < 0 || picked >= cheats.length) return '';
    return cheats[picked].apply(this.world, this);
  }

  async chooseFromList(options: MenuOption[], place?: MenuPlacement): Promise<string> {
    const picked = await this.runMenu(place?.title ?? 'Choose', options, 1, place);
    return picked < 0 ? '' : options[picked].key;
  }

  async allocatePoints(labels: string[], total: number, min: number, max: number, place: MenuPlacement): Promise<number[] | null> {
    // Start with an even spread, the remainder going to the first rows.
    const n = labels.length;
    const values = labels.map((_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
    const left = () => total - values.reduce((a, b) => a + b, 0);
    const width = Math.max(...labels.map((l) => l.length));
    const items = () => [...labels.map((l, i) => `${l.padEnd(width)}  < ${String(values[i]).padStart(2)} >`), 'O.K.'];
    const hints = () => {
      const hint = left() > 0 ? `${left()} points left to spend` : 'All points spent';
      return [...labels.map(() => hint), left() === 0 ? 'Press A or Enter to accept' : hint];
    };
    const menu = layoutMenu(place.title, items(), 1);
    menu.hints = hints();
    this.placeMenu(menu, place);
    this.openMenu(menu);
    try {
      for (;;) {
        const key = await this.readKey();
        if (key === null) continue;
        if (key === Key.Left || key === Key.Right) {
          if (menu.cursor < n) {
            const delta = key === Key.Right ? 1 : -1;
            const next = Math.max(min, Math.min(max, values[menu.cursor] + delta));
            // Right stops at the last point: the pool can be spent, never overspent.
            if (delta > 0 && left() <= 0) this.sound(Sound.Error1);
            else values[menu.cursor] = next;
            menu.items = items();
            menu.hints = hints();
            this.showMenuNow();
          }
          continue;
        }
        if (moveCursor(menu, key)) {
          this.showMenuNow();
          continue;
        }
        if (key === Key.A || key === Key.Enter) {
          if (menu.cursor < n) {
            menu.cursor++; // step to the next row, as a form would
            this.showMenuNow();
            continue;
          }
          if (left() === 0) return values;
          continue;
        }
        if (key === Key.B || key === Key.Escape) return null;
      }
    } finally {
      this.closeMenu();
    }
  }

  /** Pixels under the open menu, restored when it closes over a static screen. */
  private underMenu: { image: ImageData; x: number; y: number } | null = null;

  /** Open a menu window: remember what is under it, then draw it. */
  private openMenu(menu: MenuWindow): void {
    const { cell } = this;
    // The hint line runs across the whole screen under the window, so save that too.
    const x = menu.hints ? 1 : menu.x;
    const w = menu.hints ? COLUMNS - 2 : menu.width;
    const h = menu.visibleRows + 2 + (menu.hints ? HINT_ROWS : 0);
    this.underMenu = {
      image: this.ctx.getImageData(x * cell, menu.y * cell, w * cell, Math.min(h, ROWS - menu.y) * cell),
      x: x * cell,
      y: menu.y * cell,
    };
    this.menu = menu;
    this.showMenuNow();
  }

  /** Close the menu window and restore what it covered. */
  private closeMenu(): void {
    this.menu = null;
    if (this.underMenu) this.ctx.putImageData(this.underMenu.image, this.underMenu.x, this.underMenu.y);
    this.underMenu = null;
    if (!this.viewCovered) this.viewDirty = true;
  }

  /** Redraw the open menu (after the cursor moved or its text changed). */
  private showMenuNow(): void {
    if (!this.menu) return;
    if (this.viewCovered) drawMenu(this.ctx, this.gfx, this.cell, this.menu);
    else this.viewDirty = true;
  }

  async waitCommand(scope: CommandScope, timeoutMs: number): Promise<string | null> {
    const key = await this.readKey(timeoutMs);
    if (key === null || this.promptMode === 'keyboard') return key;
    if (DIRECTION_KEYS.includes(key)) return key;
    const shortcuts = BUTTON_SHORTCUTS[scope];
    if (key === Key.B) return shortcuts.B;
    if (key === Key.X) return shortcuts.X;
    if (key === Key.Y) return shortcuts.Y;
    if (key === Key.A) {
      // The commands the surroundings call for come first.
      const options = [...commandMenu(this.world, scope, COMMAND_MENUS[scope]), { key: Key.Escape, label: 'Settings' }];
      const picked = await this.runMenu('Command', options);
      return picked < 0 ? null : options[picked].key;
    }
    return key;
  }

  async chooseMember(only?: number[]): Promise<number> {
    let n: number;
    for (;;) {
      if (this.promptMode === 'controller') {
        const options: MenuOption[] = [];
        for (let m = 0; m < 4; m++) {
          const slot = this.world.party.memberSlot(m);
          if (slot < 0 || (only && !only.includes(m))) continue;
          const p = this.world.roster.get(slot);
          options.push({ key: String(m + 1), label: `${m + 1} ${p.name}`, colour: memberColour(p) });
        }
        const picked = await this.runMenu('Who?', options);
        n = picked < 0 ? 0 : Number(options[picked].key);
        this.print(picked < 0 ? ' ' : String(n));
        break;
      }
      const key = (await this.waitKey()).toUpperCase();
      // A controller button means the mode just switched: show the menu instead.
      if (key === Key.A || key === Key.B) continue;
      this.print(key.length === 1 && key >= ' ' ? key : ' ');
      n = key.charCodeAt(0) - '0'.charCodeAt(0);
      break;
    }
    this.print('\n');
    return n;
  }

  async chooseDirection(allowNone: boolean, allowDiagonal: boolean): Promise<string | null> {
    const accepted = allowDiagonal ? [...DIRECTION_KEYS, '1', '2', '3', '4', '6', '7', '8', '9'] : [...DIRECTION_KEYS, '2', '4', '6', '8'];
    if (this.promptMode === 'controller') {
      const hint = layoutMenu('Direction?', [allowNone ? 'd-pad, or A: none' : 'd-pad, B: cancel']);
      hint.cursor = -1;
      this.openMenu(hint);
    }
    try {
      for (;;) {
        const key = await this.waitKey();
        if (accepted.includes(key)) return key;
        if (allowNone && (key === Key.Space || key === Key.A)) return Key.Space;
        if (key === Key.B || key === Key.Escape) return null;
      }
    } finally {
      if (this.menu) this.closeMenu();
    }
  }

  async chooseOption(options: MenuOption[], echo: 'none' | 'key' | 'line', place?: MenuPlacement): Promise<string> {
    let key = '';
    for (;;) {
      if (this.promptMode === 'controller') {
        const picked = await this.runMenu(place?.title ?? 'Choose', options, 1, place);
        key = picked < 0 ? '' : options[picked].key;
        break;
      }
      const k = (await this.waitKey()).toUpperCase();
      if (k === Key.Escape) break;
      const hit = options.find((o) => o.key === k);
      if (hit?.disabled) {
        this.sound(Sound.Error1); // e.g. a spell the caster cannot afford
        continue;
      }
      if (hit) {
        key = k;
        break;
      }
      // Other keys are ignored; a controller button loops round to show the menu.
    }
    if (echo !== 'none') this.print(key || ' ');
    if (echo === 'line') this.print('\n');
    return key;
  }

  /**
   * Line input with a blinking cursor. Mirrors `UInputText()`: the cursor
   * frames are in row 1 of the UI sheet, and the text is echoed in place.
   */
  private async readLine(x: number, y: number, maxChars: number, numbersOnly: boolean, echo: (s: string) => void): Promise<string> {
    let text = '';
    let frame = 0;
    for (;;) {
      echo(text);
      const cx = x + text.length;
      // Blink the cursor while waiting.
      let key: string | null = null;
      while (key === null) {
        frame = (frame + 1) % 7;
        if (cx < COLUMNS) this.gfx.drawUiPiece(this.ctx, frame, 1, cx * this.cell, y * this.cell, this.cell);
        key = await this.keyboard.nextKeyOrTimeout(120);
      }
      if (cx < COLUMNS) this.drawText(' ', cx, y);
      if (key === Key.Enter || key === Key.Escape) return text;
      if (key === Key.Backspace) {
        text = text.slice(0, -1);
        continue;
      }
      if (key.length !== 1 || key < ' ') continue;
      if (numbersOnly && (key < '0' || key > '9')) continue;
      if (text.length < maxChars) text += key;
    }
  }

  async inputText(maxChars: number, numbersOnly: boolean, words?: string[]): Promise<string> {
    const x = this.cursorX;
    const y = this.cursorY;
    let result: string;
    if (this.inputMode === 'controller') result = await this.controllerInput(maxChars, numbersOnly, words);
    else result = await this.readLine(x, y, maxChars, numbersOnly, (s) => this.drawText((s + '   ').slice(0, maxChars + 1), x, y));
    // Leave the typed text in the message buffer and move the cursor past it.
    this.cursorX = x;
    this.print(result);
    return result;
  }

  async inputTextAt(x: number, y: number, maxChars: number, numbersOnly: boolean): Promise<string> {
    if (this.inputMode === 'controller') {
      const result = await this.controllerInput(maxChars, numbersOnly);
      this.drawText((result + ' ').padEnd(maxChars + 1), x, y);
      return result;
    }
    return this.readLine(x, y, maxChars, numbersOnly, (s) => this.drawText((s + ' ').padEnd(maxChars + 1), x, y));
  }

  /**
   * Controller text entry: a spinner for numbers (d-pad up/down by one,
   * left/right by ten), a word list when one is offered, otherwise an
   * on-screen keyboard.
   */
  private async controllerInput(maxChars: number, numbersOnly: boolean, words?: string[]): Promise<string> {
    if (numbersOnly) {
      const max = Math.pow(10, maxChars) - 1;
      let value = 0;
      const menu = layoutMenu('Amount', [`${String(0).padStart(maxChars, ' ')}  up/down`]);
      menu.cursor = -1;
      this.openMenu(menu);
      const show = () => {
        menu.items[0] = `${String(value).padStart(maxChars, ' ')}  up/down`;
        this.showMenuNow();
      };
      try {
        for (;;) {
          const key = await this.readKey();
          if (key === Key.Up) value = Math.min(max, value + 1);
          else if (key === Key.Down) value = Math.max(0, value - 1);
          else if (key === Key.Right) value = Math.min(max, value + 10);
          else if (key === Key.Left) value = Math.max(0, value - 10);
          else if (key === Key.A) return String(value);
          else if (key === Key.B) return '';
          else if (key !== null && key >= '0' && key <= '9') value = Math.min(max, value * 10 + Number(key));
          show();
        }
      } finally {
        this.closeMenu();
      }
    }
    if (words && words.length) {
      const picked = await this.runMenu(
        'Word',
        words.map((w) => ({ key: w[0], label: w })),
      );
      return picked < 0 ? '' : words[picked];
    }
    // On-screen keyboard.
    const keys = [...ON_SCREEN_KEYBOARD.join(''), OSK_DELETE, OSK_DONE];
    const columns = ON_SCREEN_KEYBOARD[0].length;
    const options = keys.map((k) => ({ key: k, label: k }));
    let text = '';
    for (;;) {
      const menu = layoutMenu(
        text || 'Type',
        options.map((o) => o.label),
        columns,
      );
      this.openMenu(menu);
      let picked = -1;
      try {
        for (;;) {
          const key = await this.readKey();
          if (key === null) continue;
          if (moveCursor(menu, key)) {
            this.showMenuNow();
            continue;
          }
          if (key === Key.A) {
            picked = menu.cursor;
            break;
          }
          if (key === Key.B) {
            picked = keys.indexOf(OSK_DELETE);
            break;
          }
          if (key === Key.X || key === Key.Y) {
            picked = keys.indexOf(OSK_DONE);
            break;
          }
          if (key.length === 1 && key >= ' ') {
            text = (text + key).slice(0, maxChars);
            break;
          }
        }
      } finally {
        this.closeMenu();
      }
      if (picked < 0) continue;
      const k = keys[picked];
      if (k === OSK_DONE) return text;
      if (k === OSK_DELETE) {
        if (!text) return '';
        text = text.slice(0, -1);
      } else if (text.length < maxChars) text += k;
    }
  }

  sound(name: string): void {
    if (this.world.soundEnabled) this.sounds.play(name);
  }

  music(track: number): void {
    this.musicPlayer.play(track);
  }

  pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------------
  // Map viewport
  // -------------------------------------------------------------------------

  redrawMap(): void {
    this.viewCovered = false;
    this.view = buildViewport(this.world);
    this.viewDirty = true;
  }

  clearTiles(): void {
    this.view = null;
    this.viewCovered = true;
    this.black(1, 1, 22, 22);
  }

  /** Paint the cached viewport, or the dungeon view. Called from the animation loop. */
  /**
   * In combat, a rounded outline around the member whose turn it is, two
   * game pixels wide just outside their tile. It starts white and fades to
   * mid grey over the time the member has before the turn passes by
   * itself, so the outline doubles as the timer. (The Apple II blinked the
   * figure.)
   */
  private markActiveMember(): void {
    const c = this.world.combat;
    if (!c || c.markedMember < 0) return;
    const { ctx, cell } = this;
    const me = c.members[c.markedMember];
    if (me.x > 10 || me.y > 10) return;
    const tile = 2 * cell;
    const gamePixel = tile / 16; // the Apple II tile was 16 pixels, whatever the sheet's size
    const width = 2 * gamePixel;
    const x = (1 + 2 * me.x) * cell - width / 2;
    const y = (1 + 2 * me.y) * cell - width / 2;
    const elapsed = c.markedFor > 0 ? (performance.now() - c.markedAt) / c.markedFor : 1;
    const level = Math.round(255 - 127 * Math.max(0, Math.min(1, elapsed)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell, cell, 22 * cell, 22 * cell); // never paint over the border
    ctx.clip();
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgb(${level},${level},${level})`;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, tile + width, tile + width, 3 * gamePixel);
    else ctx.rect(x, y, tile + width, tile + width);
    ctx.stroke();
    ctx.restore();
  }

  private paintViewport(): void {
    const { ctx, cell, gfx, world } = this;
    const inDungeon = world.party.location === Location.Dungeon && !world.combat;
    const overlay = inDungeon && world.mapMode !== 'off'; // small: the 5x5 map; full: the small first-person view
    if (this.overlayShown && !overlay) {
      // The overlay has gone: bring back the text it was covering.
      this.overlayShown = false;
      this.redrawTextArea();
    }
    if (inDungeon) {
      const lit = world.dungeon.torch > 0 && this.dungeonRenderer;
      const view = lit ? this.dungeonRenderer!.render(buildDungeonView(world), world.dungeon.torch, secretMessage(world)) : null;
      if (world.mapMode === 'full') {
        // The level fills the window; the first-person view shrinks into the overlay slot.
        this.overlayShown = true;
        this.black(1, 1, 22, 22);
        this.paintAutoMap(0, 0, 16, 16, 4, 4); // where Peer draws the level
        this.black(MAP_OVERLAY_LEFT, MAP_OVERLAY_TOP, MAP_OVERLAY_SIZE, MAP_OVERLAY_SIZE);
        if (view) {
          const w = MAP_OVERLAY_SIZE * cell;
          const h = Math.round((w * 512) / 600);
          ctx.drawImage(view, MAP_OVERLAY_LEFT * cell, MAP_OVERLAY_TOP * cell + Math.floor((MAP_OVERLAY_SIZE * cell - h) / 2), w, h);
        }
        return;
      }
      if (overlay) {
        this.overlayShown = true;
        this.paintAutoMap(world.x - 2, world.y - 2, MAP_OVERLAY_SIZE, MAP_OVERLAY_SIZE, MAP_OVERLAY_LEFT, MAP_OVERLAY_TOP);
      }
      this.black(1, 1, 22, 22);
      if (!view) return;
      // The original drew the 600x512 view at (84, 128) for 32-pixel cells, scaling with the cell size.
      const mult = cell / 32;
      ctx.drawImage(view, 84 * mult, 128 * mult, 600 * mult, 512 * mult);
      return;
    }
    if (!this.view) return;
    const tile = cell * 2;
    for (let i = 0; i < this.view.cells.length; i++) {
      const c = this.view.cells[i];
      const dx = cell + (i % VIEW_SIZE) * tile;
      const dy = cell + Math.floor(i / VIEW_SIZE) * tile;
      gfx.drawShape(ctx, c.base, dx, dy, tile);
      if (c.follower !== undefined && this.partyStyle === 'line') this.drawMember(c.follower, dx, dy, tile);
      if (c.hit && !this.burstTiles) {
        // The Apple II way: the ball's "HIT" frame replaces whatever was hit.
        gfx.drawShape(ctx, c.hit.shape, dx, dy, tile, { masked: true, altFrame: true });
        continue;
      }
      if (c.party && this.partyStyle !== 'symbol') this.drawParty(dx, dy, tile, this.partyStyle);
      else if (c.overlay !== undefined) gfx.drawShape(ctx, c.overlay, dx, dy, tile, { masked: true, flip: c.flip, altFrame: c.altFrame });
      if (c.hit) this.drawBurst(dx, dy, tile, c.hit.frame);
    }
    this.markActiveMember();
  }

  /**
   * With the Standard tiles the party on foot is drawn as its members. On
   * the overworld they are at half size in a 2x2 grid in marching order
   * (1 top left, 2 top right, 3 bottom left, 4 bottom right), which sells
   * the scale of the map. In a town or castle the first living member
   * stands here at full size and the others follow in a line behind (see
   * `world.trail`); with the Nintendo tiles the line is used everywhere, as
   * the NES did. A poisoned member is drawn all in green; a dead one, or
   * ashes, is not drawn. The other tile sets keep the Apple II's single figure.
   */
  private drawParty(dx: number, dy: number, tile: number, style: 'grid' | 'line'): void {
    const { world } = this;
    if (style === 'line') {
      const leader = [0, 1, 2, 3].find((m) => world.party.memberSlot(m) >= 0 && world.memberAlive(m));
      if (leader !== undefined) this.drawMember(leader, dx, dy, tile);
      return;
    }
    const q = tile / 2;
    for (let m = 0; m < 4; m++) {
      if (world.party.memberSlot(m) < 0) continue;
      this.drawMember(m, dx + (m % 2) * q, dy + Math.floor(m / 2) * q, q);
    }
  }

  /** One member's class figure at (x, y), `size` pixels square: green if poisoned, nothing if dead or ashes. */
  private drawMember(m: number, x: number, y: number, size: number): void {
    const p = this.world.member(m);
    if (p.status === 'D' || p.status === 'A') return;
    const shape = memberShape(this.world, p.classLetter);
    if (p.status === 'P') this.ctx.drawImage(this.greenFigure(shape, size), x, y);
    else this.gfx.drawShape(this.ctx, shape, x, y, size, { masked: true });
  }

  /** Cache of member figures recoloured green (poison), keyed by shape and size. */
  private greenFigures = new Map<string, HTMLCanvasElement>();

  /** A member figure with every pixel turned green, its shading kept as brightness. */
  private greenFigure(shape: number, size: number): HTMLCanvasElement {
    const key = `${shape}:${size}`;
    const cached = this.greenFigures.get(key);
    if (cached) return cached;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d')!;
    octx.imageSmoothingEnabled = false;
    this.gfx.drawShape(octx, shape, 0, 0, size, { masked: true });
    const image = octx.getImageData(0, 0, size, size);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const bright = Math.max(d[i], d[i + 1], d[i + 2]);
      d[i] = 0;
      d[i + 1] = Math.max(64, bright);
      d[i + 2] = 0;
    }
    octx.putImageData(image, 0, 0);
    this.greenFigures.set(key, off);
    return off;
  }

  /**
   * A hit with the Standard tiles: a red burst that grows over three frames,
   * drawn on the 16-pixel grid of the era's tiles so it sits with the art.
   * Frames 1 and 2 are filled discs, a bright rim round a darker centre;
   * frame 3 is a ring, so the target shows through as the burst passes.
   */
  private drawBurst(dx: number, dy: number, tile: number, frame: number): void {
    const { ctx } = this;
    const gp = tile / 16;
    const radius = [0, 2.6, 4.6, 6.8][frame] ?? 6.8;
    const inner = frame === 3 ? 4.6 : frame === 2 ? 3.0 : 0; // hollow, or the darker centre
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const d = Math.hypot(px - 7.5, py - 7.5);
        if (d > radius) continue;
        if (frame === 3 && d <= inner) continue;
        ctx.fillStyle = d <= inner ? '#a01818' : d > radius - 1.2 ? '#ff5040' : '#e02020';
        ctx.fillRect(dx + px * gp, dy + py * gp, gp, gp);
      }
    }
  }

  private invert(x: number, y: number, w: number, h: number): void {
    const { ctx, cell } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(x * cell, y * cell, w * cell, h * cell);
    ctx.restore();
  }

  async flashTiles(): Promise<void> {
    this.invert(1, 1, 22, 22);
    await this.pause(100);
    this.viewDirty = true;
    if (this.viewCovered) this.invert(1, 1, 22, 22);
  }

  private frame(time: number): void {
    this.gamepads.poll();
    // Unfocused: the keyboard stops its timers; the screen shows PAUSED and stops animating.
    if (this.keyboard.paused !== (this.underPaused !== null)) {
      if (this.keyboard.paused) this.showPaused();
      else this.hidePaused();
    }
    if (this.underPaused) {
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    if (time - this.lastFrame >= ANIMATION_INTERVAL_MS) {
      this.lastFrame = time;
      this.gfx.tick();
      if (!this.viewCovered) this.viewDirty = true;
    }
    if (this.viewDirty && !this.viewCovered) {
      this.paintViewport();
      this.viewDirty = false;
      if (this.menu) drawMenu(this.ctx, this.gfx, this.cell, this.menu);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * A small black box reading PAUSED over whatever is there: the middle of
   * the map window in play, the gap under the Options box on the title screen.
   */
  private showPaused(): void {
    const { ctx, cell } = this;
    const text = 'PAUSED';
    const w = text.length + 4;
    const h = 3;
    const x = this.frameShown ? Math.floor((1 + VIEW_SIZE * 2) / 2 - w / 2) + 1 : Math.floor((COLUMNS - w) / 2);
    const y = this.frameShown ? Math.floor((1 + VIEW_SIZE * 2) / 2 - h / 2) + 1 : 19;
    this.underPaused = { image: ctx.getImageData(x * cell, y * cell, w * cell, h * cell), x: x * cell, y: y * cell };
    this.black(x, y, w, h);
    this.drawText(text, x + 2, y + 1);
  }

  private hidePaused(): void {
    if (!this.underPaused) return;
    this.ctx.putImageData(this.underPaused.image, this.underPaused.x, this.underPaused.y);
    this.underPaused = null;
  }

  // -------------------------------------------------------------------------
  // Pictures, mini maps, the ending
  // -------------------------------------------------------------------------

  showImage(name: string): void {
    const img = this.images.get(name);
    this.viewCovered = true;
    this.view = null;
    this.black(1, 1, 22, 22);
    if (img) this.ctx.drawImage(img, this.cell, this.cell, 22 * this.cell, 22 * this.cell);
  }

  /**
   * The dungeon auto-map: `w` x `h` cells of the current level from (x0, y0),
   * wrapping as the dungeon does, drawn at text cell (left, top) with the
   * pieces Peer at gem uses. Only cells the party has seen (or, in the
   * dark, the 3x3 around it) are drawn; the rest stay black. Secret doors
   * are drawn as a wall with one pixel out of place, so a sharp eye can
   * spot them where Peer shows them plainly. The party is the figure of
   * its first living member, standing still (Peer's blinking diamond was
   * a distraction on a map that stays up).
   */
  private paintAutoMap(x0: number, y0: number, w: number, h: number, left: number, top: number): void {
    const { ctx, cell, world } = this;
    this.black(left, top, w, h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const xs = (x0 + col) & 0x0f;
        const ys = (y0 + row) & 0x0f;
        if (!cellVisible(world, xs, ys)) continue;
        const dx = (left + col) * cell;
        const dy = (top + row) * cell;
        const value = world.getXYDng(xs, ys);
        if (value === DungeonCell.SecretDoor) ctx.drawImage(this.secretDoor(), dx, dy, cell, cell);
        else this.gfx.drawUiPiece(ctx, DUNGEON_MAP_PIECE_COLUMN + dungeonMapPiece(value), 1, dx, dy, cell);
        if (xs === world.x && ys === world.y) {
          const leader = this.livingLeader();
          if (leader !== undefined) this.drawMember(leader, dx, dy, cell);
        }
      }
    }
  }

  /** The first member in marching order who is neither dead nor ashes. */
  private livingLeader(): number | undefined {
    for (let m = 0; m < 4; m++) {
      if (this.world.party.memberSlot(m) < 0) continue;
      const s = this.world.member(m).status;
      if (s !== 'D' && s !== 'A') return m;
    }
    return undefined;
  }

  /** The wall piece with one pixel (one Apple-scale pixel, whatever the sheet's size) turned black. */
  private secretDoor(): HTMLCanvasElement {
    if (this.secretDoorPiece) return this.secretDoorPiece;
    const size = this.gfx.uiSize;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d')!;
    this.gfx.drawUiPiece(octx, DUNGEON_MAP_PIECE_COLUMN + 2, 1, 0, 0, size);
    const dot = Math.max(1, Math.floor(size / 32));
    octx.fillStyle = '#000';
    octx.fillRect(Math.floor(size * 0.6), Math.floor(size * 0.35), dot, dot);
    this.secretDoorPiece = off;
    return off;
  }

  /** Mirrors `DrawMiniMap()`: the whole map in miniature, the party's square blinking. */
  async showMiniMap(): Promise<void> {
    const { ctx, cell, world } = this;
    this.viewCovered = true;
    this.view = null;
    const size = world.mapSize;
    const mini = Math.max(1, Math.floor((cell * 22) / size));
    const left = 12 * cell - mini * (size / 2);
    const top = left;
    this.black(1, 1, 22, 22);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.gfx.drawShape(ctx, (world.getXYVal(x, y) >> 2) * 2, left + x * mini, top + y * mini, mini);
      }
    }
    let bright = true;
    for (;;) {
      ctx.fillStyle = bright ? '#fff' : '#444';
      ctx.fillRect(left + world.x * mini, top + world.y * mini, mini, mini);
      bright = !bright;
      const key = await this.keyboard.nextKeyOrTimeout(150);
      if (key !== null) break;
    }
    this.redrawMap();
  }

  /** Mirrors `DrawMiniDng()`: the current level as a 16x16 map from the UI sheet's small pieces. */
  async showMiniDungeon(): Promise<void> {
    const { ctx, cell, world } = this;
    this.viewCovered = true;
    this.view = null;
    this.black(1, 1, 22, 22);
    const draw = (xs: number, ys: number, piece: number) =>
      this.gfx.drawUiPiece(ctx, piece + DUNGEON_MAP_PIECE_COLUMN, 1, (xs + 4) * cell, (ys + 4) * cell, cell);
    let under = 6;
    for (let ys = 0; ys < 16; ys++) {
      for (let xs = 0; xs < 16; xs++) {
        const piece = dungeonMapPiece(world.getXYDng(xs, ys));
        draw(xs, ys, piece);
        if (xs === world.x && ys === world.y) under = piece;
      }
    }
    let shown = true;
    for (;;) {
      draw(world.x, world.y, shown ? 8 : under);
      shown = !shown;
      const key = await this.keyboard.nextKeyOrTimeout(160);
      if (key !== null) break;
    }
    this.print('\n');
    this.redrawMap();
  }

  /** The victory sequence: flashing colours over the map, then the closing text. */
  async playEnding(): Promise<void> {
    const { ctx, cell } = this;
    this.viewCovered = true;
    this.view = null;
    for (let i = 0; i <= 20; i++) {
      ctx.fillStyle = `rgb(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0})`;
      ctx.fillRect(cell, cell, 22 * cell, 22 * cell);
      this.sound('Hit');
      await this.pause(120);
    }
    this.black(1, 1, 22, 22);
    const lines = [
      '   And so it came to',
      'pass  that  on  this',
      'day EXODUS,hell-born',
      'incarnate  of  evil,',
      'was vanquished  from',
      'SOSARIA.   What  now',
      'lies  ahead  in  the',
      'ULTIMA saga can only',
      'be pure speculation!',
      'Onward to ULTIMA IV!',
    ];
    lines.forEach((line, i) => this.drawText(line, 2, 3 + i * 2));
    await this.keyboard.nextKey();
    this.redrawMap();
  }

  // -------------------------------------------------------------------------
  // Stats boxes, wind, moons
  // -------------------------------------------------------------------------

  /**
   * The four character boxes, two rows each (the Apple II's had three:
   * name and status letter; sex, race, class, mana and level; hit points
   * and food):
   *
   *   Tatiana               name, coloured by state: green poisoned, light
   *   100/150     M:25      grey dead, dark grey ashes, blue when Lord
   *                         British would raise the member, else white
   *
   * Hit points turn yellow under a quarter of the maximum and red under a
   * tenth. Gold and food are pooled and shown on the top border (`showMoons`).
   */
  updateStats(force = false): void {
    for (let m = 0; m < 4; m++) {
      const slot = this.world.party.memberSlot(m);
      const p = slot >= 0 ? this.world.roster.get(slot) : null;
      const due = p ? levelUpDue(p) : false;
      const key = p ? `${p.name}|${p.status}|${due}|${p.hitPoints}|${p.maxHitPoints}|${p.mana}` : '';
      if (!force && key === this.statsCache[m]) continue;
      this.statsCache[m] = key;

      const top = m * BOX_PITCH + 1;
      this.black(24, top, 15, BOX_ROWS);
      if (p) {
        const nameColour = memberColour(p, due);
        this.drawText(p.name, 24, top, nameColour);
        // Dead or ashes: the whole box takes the name's grey. Otherwise hit points warn by colour.
        const gone = p.status === 'D' || p.status === 'A';
        const hp = p.hitPoints;
        const max = Math.max(1, p.maxHitPoints);
        const hpColour = gone ? nameColour : hp < max / 10 ? '#ff4040' : hp < max / 4 ? '#ffe040' : undefined;
        this.drawText(`${hp}/${p.maxHitPoints}`, 24, top + 1, hpColour);
        if (hasMagic(this.world, p)) {
          const mana = `M:${p.mana}`;
          this.drawText(mana, 39 - mana.length, top + 1, gone ? nameColour : undefined);
        }
      }
      if (this.highlighted.has(m)) this.invert(24, top, 15, BOX_ROWS);
    }
    this.showMoons();
  }

  async flashMember(member: number): Promise<void> {
    const top = member * BOX_PITCH + 1;
    this.invert(24, top, 15, BOX_ROWS);
    await this.pause(100);
    this.invert(24, top, 15, BOX_ROWS);
  }

  highlightMember(member: number, on: boolean): void {
    if (this.highlighted.has(member) === on) return;
    if (on) this.highlighted.add(member);
    else this.highlighted.delete(member);
    this.invert(24, member * BOX_PITCH + 1, 15, BOX_ROWS);
  }

  /** Wind indicator on the bottom border, or the heading in a dungeon. (`ShowWind`, `DngInfo`) */
  showWind(): void {
    const w = this.world;
    const mm = w.resources.strings.MoreMessages;
    if (w.party.location === Location.Dungeon) {
      this.piece(Piece.CapLeft, 6, 23);
      this.piece(Piece.CapRight, 17, 23);
      // MoreMessages 49 "HEAD-", then 50..53 North, -East, South, -West.
      const label = (mm[48] + mm[49 + w.dungeon.heading]).padEnd(10);
      this.drawText(label, 7, 23);
      return;
    }
    if (w.party.location === Location.Combat || !w.windEnabled) {
      for (let x = 6; x <= 17; x++) this.piece(Piece.Horizontal, x, 23);
      return;
    }
    this.piece(Piece.CapLeft, 6, 23);
    this.piece(Piece.CapRight, 17, 23);
    // MoreMessages 43..47 (1-based) are CALM WINDS, NORTH WIND ... WEST WIND.
    this.drawText((mm[42 + w.windDirection] ?? '').padEnd(10), 7, 23);
  }

  /**
   * The status bar on the top border over the map: the party's gold on the
   * left, the moon phases (or the dungeon level) in the middle where the
   * Apple II showed them, and the party's food on the right.
   * (`DrawMoonGateStuff`, `DngInfo`)
   */
  showMoons(): void {
    const w = this.world;
    if (!this.frameShown) return; // title screens have no status bar
    const piece = (n: number, x: number) => this.piece(n, x, 0);

    // Plain bar across the top of the map, then the three fields over it:
    // gold at the left, the moons (or dungeon level) in the middle where the
    // Apple II showed them, food at the right.
    for (let x = 1; x <= 22; x++) piece(Piece.Horizontal, x);
    this.drawText(`G:${w.party.gold}`, 1, 0);
    if (w.party.location === Location.Dungeon) this.drawText(`Lvl:${w.dungeon.level + 1}`.padEnd(6), 9, 0);
    else this.drawText(`(${w.moonPhase[0]})(${w.moonPhase[1]})`, 9, 0);
    const food = `F:${w.party.food}`;
    this.drawText(food, 23 - food.length, 0);
  }
}

/**
 * The colour that tells a member's state: green poisoned, light grey dead,
 * dark grey ashes, blue when a raise is due, undefined (white) otherwise.
 */
function memberColour(p: PlayerRecord, due = false): string | undefined {
  if (p.status === 'P') return '#40ff40';
  if (p.status === 'D') return '#b0b0b0';
  if (p.status === 'A') return '#606060';
  return due ? '#60a0ff' : undefined;
}
