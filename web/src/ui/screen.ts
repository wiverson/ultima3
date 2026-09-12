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
 *   columns 24..38, rows 1..15   four character boxes, three rows each,
 *                                separated by border lines at rows 4, 8, 12, 16
 *   columns 24..39, rows 17..23  the scrolling message area; the prompt is
 *                                on row 23
 *   row 0                        moon phases;   row 23  wind
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
import { World } from '../game/world.ts';
import { Location } from '../game/party.ts';
import { buildViewport, VIEW_SIZE, type Viewport } from '../game/viewport.ts';
import { buildDungeonView, secretMessage } from '../game/dungeon.ts';
import { Key, type GameIO } from '../game/io.ts';
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
const TEXT_LEFT = 24;
const TEXT_RIGHT = 40; // exclusive
const TEXT_TOP = 17;
const TEXT_BOTTOM = 24; // exclusive

const ANIMATION_INTERVAL_MS = 1000 / 12;

/** The 4 x 6 grid of small tiles used for the dungeon map, in row 1 of the UI sheet. */
const DUNGEON_MAP_PIECE_COLUMN = 7;

export class Screen implements GameIO {
  private readonly ctx: CanvasRenderingContext2D;
  /** Pixel size of one cell. */
  readonly cell: number;

  private view: Viewport | null = null;
  private viewDirty = true;
  /** While a picture or map covers the viewport the animation loop leaves it alone. */
  private viewCovered = false;
  private lastFrame = 0;
  private readonly dungeonRenderer: DungeonRenderer | null;

  /** Text cursor in the message area. (`wx`, `wy`) */
  private cursorX = TEXT_LEFT + 1;
  private cursorY = ROWS - 1;
  /** Characters currently shown in the message area, so it can be scrolled. */
  private textRows: string[][] = [];

  /** Last values drawn in each stats box, to avoid redrawing every turn. */
  private statsCache: string[] = ['', '', '', ''];
  private highlighted = new Set<number>();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly gfx: GraphicsSet,
    private readonly images: ImageMap,
    private readonly keyboard: Keyboard,
    private readonly sounds: SoundPlayer,
    private readonly musicPlayer: MusicPlayer,
    private readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.cell = Math.floor(canvas.width / COLUMNS);
    for (let r = 0; r < TEXT_BOTTOM - TEXT_TOP; r++) this.textRows.push(new Array(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    const shapes = images.get('DungeonShapes');
    const masks = images.get('DungeonMasks');
    this.dungeonRenderer = shapes && masks ? new DungeonRenderer(shapes, masks) : null;
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
    this.black(0, 0, COLUMNS, ROWS);
    const piece = (n: number, x: number, y: number) => this.piece(n, x, y);
    for (let x = 1; x < 39; x++) piece(Piece.Horizontal, x, 0);
    for (let x = 1; x < 23; x++) piece(Piece.Horizontal, x, 23);
    for (let x = 24; x < 39; x++) for (const y of [4, 8, 12, 16]) piece(Piece.Horizontal, x, y);
    for (let y = 1; y < 23; y++) {
      piece(Piece.Vertical, 0, y);
      piece(Piece.Vertical, 23, y);
    }
    for (let y = 1; y < 16; y++) piece(Piece.Vertical, 39, y);
    piece(Piece.TopLeft, 0, 0);
    piece(Piece.TopRight, 39, 0);
    piece(Piece.BottomLeft, 0, 23);
    piece(Piece.TopTee, 23, 0);
    piece(Piece.BottomRight, 39, 16);
    piece(Piece.BottomRight, 23, 23);
    for (const y of [4, 8, 12, 16]) piece(Piece.LeftTee, 23, y);
    for (const y of [4, 8, 12]) piece(Piece.RightTee, 39, y);
    // Member numbers 1-4 sit in the separators above each box.
    for (let i = 0; i < 4; i++) {
      piece(Piece.CapLeft, 30, i * 4);
      piece(Piece.CapRight, 32, i * 4);
      this.drawText(String(i + 1), 31, i * 4);
    }
    this.textRows.forEach((row) => row.fill(' '));
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
  }

  // -------------------------------------------------------------------------
  // Text
  // -------------------------------------------------------------------------

  /** Draw a string with the bitmap font at cell (x, y), no wrapping. */
  drawText(text: string, x: number, y: number): void {
    const { ctx, cell } = this;
    for (let i = 0; i < text.length; i++) {
      ctx.fillStyle = '#000';
      ctx.fillRect((x + i) * cell, y * cell, cell, cell);
      this.gfx.drawGlyph(ctx, text[i], (x + i) * cell, y * cell, cell);
    }
  }

  textAt(x: number, y: number, text: string): void {
    this.drawText(text, x, y);
  }

  centreText(y: number, text: string): void {
    this.drawText(text, 20 - Math.floor(text.length / 2), y);
  }

  private redrawTextArea(): void {
    for (let r = 0; r < this.textRows.length; r++) this.drawText(this.textRows[r].join(''), TEXT_LEFT, TEXT_TOP + r);
  }

  /** Scroll the message area up one line. (`UTextScroll`) */
  private scrollText(): void {
    this.textRows.shift();
    this.textRows.push(new Array(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    this.redrawTextArea();
    // The prompt corner piece is part of the border; redraw it after scrolling.
    this.piece(Piece.BottomRight, 23, 23);
  }

  print(text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        this.cursorX = TEXT_LEFT;
        this.cursorY++;
        if (this.cursorY >= TEXT_BOTTOM) {
          this.cursorY = TEXT_BOTTOM - 1;
          this.scrollText();
        }
        continue;
      }
      if (ch < ' ') continue;
      if (this.cursorX >= TEXT_RIGHT) continue; // the original simply ran off the edge
      this.textRows[this.cursorY - TEXT_TOP][this.cursorX - TEXT_LEFT] = ch;
      this.drawText(ch, this.cursorX, this.cursorY);
      this.cursorX++;
    }
  }

  printMessage(n: number): void {
    const s = this.world.resources.strings.Messages[n - 1];
    this.print(s ?? `[msg ${n}]`);
  }

  prompt(): void {
    this.piece(Piece.BottomTee, 23, 23);
    this.piece(Piece.CapLeft, 24, 23);
    this.textRows[TEXT_BOTTOM - 1 - TEXT_TOP].fill(' ');
    for (let x = TEXT_LEFT + 1; x < TEXT_RIGHT; x++) this.drawText(' ', x, TEXT_BOTTOM - 1);
    this.cursorX = TEXT_LEFT + 1;
    this.cursorY = TEXT_BOTTOM - 1;
  }

  // -------------------------------------------------------------------------
  // Keyboard, text input and sound
  // -------------------------------------------------------------------------

  waitKey(): Promise<string> {
    return this.keyboard.nextKey();
  }

  waitKeyOrTimeout(ms: number): Promise<string | null> {
    return this.keyboard.nextKeyOrTimeout(ms);
  }

  flushKeys(): void {
    this.keyboard.flush();
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

  async inputText(maxChars: number, numbersOnly: boolean): Promise<string> {
    const x = this.cursorX;
    const y = this.cursorY;
    const result = await this.readLine(x, y, maxChars, numbersOnly, (s) => {
      this.drawText((s + '   ').slice(0, maxChars + 1), x, y);
    });
    // Leave the typed text in the message buffer and move the cursor past it.
    this.cursorX = x;
    this.print(result);
    return result;
  }

  async inputTextAt(x: number, y: number, maxChars: number, numbersOnly: boolean): Promise<string> {
    return this.readLine(x, y, maxChars, numbersOnly, (s) => this.drawText((s + ' ').padEnd(maxChars + 1), x, y));
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
  private paintViewport(): void {
    const { ctx, cell, gfx, world } = this;
    if (world.party.location === Location.Dungeon && !world.combat) {
      if (world.dungeon.torch < 1 || !this.dungeonRenderer) {
        this.black(1, 1, 22, 22);
        return;
      }
      const image = this.dungeonRenderer.render(buildDungeonView(world), world.dungeon.torch, secretMessage(world));
      // The original drew the 600x512 view at (84, 128) for 32-pixel cells, scaling with the cell size.
      const mult = cell / 32;
      this.black(1, 1, 22, 22);
      ctx.drawImage(image, 84 * mult, 128 * mult, 600 * mult, 512 * mult);
      return;
    }
    if (!this.view) return;
    const tile = cell * 2;
    for (let i = 0; i < this.view.cells.length; i++) {
      const c = this.view.cells[i];
      const dx = cell + (i % VIEW_SIZE) * tile;
      const dy = cell + Math.floor(i / VIEW_SIZE) * tile;
      gfx.drawShape(ctx, c.base, dx, dy, tile);
      if (c.overlay !== undefined) gfx.drawShape(ctx, c.overlay, dx, dy, tile, { masked: true, flip: c.flip, altFrame: c.altFrame });
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
    if (time - this.lastFrame >= ANIMATION_INTERVAL_MS) {
      this.lastFrame = time;
      this.gfx.tick();
      if (!this.viewCovered) this.viewDirty = true;
    }
    if (this.viewDirty && !this.viewCovered) {
      this.paintViewport();
      this.viewDirty = false;
    }
    requestAnimationFrame((t) => this.frame(t));
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
    const pieceFor = (value: number): number => {
      switch (value) {
        case DungeonCell.Door:
          return 0;
        case 0xa0:
          return 1;
        case DungeonCell.Wall:
          return 2;
        case 0x30:
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
    };
    const draw = (xs: number, ys: number, piece: number) =>
      this.gfx.drawUiPiece(ctx, piece + DUNGEON_MAP_PIECE_COLUMN, 1, (xs + 4) * cell, (ys + 4) * cell, cell);
    let under = 6;
    for (let ys = 0; ys < 16; ys++) {
      for (let xs = 0; xs < 16; xs++) {
        const piece = pieceFor(world.getXYDng(xs, ys));
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
      ctx.fillStyle = `rgb(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0})`;
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
   * Draw the four character boxes in the classic text layout of
   * `RenderCharStats()`:
   *
   *      NAME          G      <- name centred, status letter at the right
   *   FET   M:00  L:01        <- sex/race/class, mana, level
   *   H:0100  F:0150          <- hit points, food
   */
  updateStats(force = false): void {
    for (let m = 0; m < 4; m++) {
      const slot = this.world.party.memberSlot(m);
      const p = slot >= 0 ? this.world.roster.get(slot) : null;
      const lines = p
        ? [
            p.name,
            `${p.sex}${p.race}${p.classLetter} M:${pad(p.mana, 2)} L:${pad(p.level, 2)} ${p.status}`,
            `H:${pad(p.hitPoints, 4)} F:${pad(p.food, 4)}`,
          ]
        : ['', '', ''];
      const key = lines.join('|');
      if (!force && key === this.statsCache[m]) continue;
      this.statsCache[m] = key;

      const top = m * 4 + 1;
      this.black(24, top, 15, 3);
      if (p) {
        this.drawText(p.name, 24 + 7 - Math.floor(p.name.length / 2), top);
        this.drawText(p.status, 38, top);
        this.drawText(`${p.sex}${p.race}${p.classLetter}`, 25, top + 1);
        this.drawText(`M:${pad(p.mana, 2)}`, 29, top + 1);
        this.drawText(`L:${pad(p.level, 2)}`, 34, top + 1);
        this.drawText(`H:${pad(p.hitPoints, 4)}`, 25, top + 2);
        this.drawText(`F:${pad(p.food, 4)}`, 32, top + 2);
      }
      if (this.highlighted.has(m)) this.invert(24, top, 15, 3);
    }
  }

  async flashMember(member: number): Promise<void> {
    const top = member * 4 + 1;
    this.invert(24, top, 15, 3);
    await this.pause(100);
    this.invert(24, top, 15, 3);
  }

  highlightMember(member: number, on: boolean): void {
    if (this.highlighted.has(member) === on) return;
    if (on) this.highlighted.add(member);
    else this.highlighted.delete(member);
    this.invert(24, member * 4 + 1, 15, 3);
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

  /** Moon phases on the top border, or the dungeon level. (`DrawMoonGateStuff`, `DngInfo`) */
  showMoons(): void {
    const w = this.world;
    this.piece(Piece.CapLeft, 8, 0);
    if (w.party.location === Location.Dungeon) {
      // MoreMessages 48 is "Lvl:0"; the digit is replaced.
      this.drawText(`Lvl:${w.dungeon.level + 1}`.padEnd(6), 9, 0);
    } else {
      this.drawText(`(${w.moonPhase[0]})(${w.moonPhase[1]})`, 9, 0);
    }
    this.piece(Piece.CapRight, 15, 0);
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
