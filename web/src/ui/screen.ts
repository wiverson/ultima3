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
 */

import { GraphicsSet } from './graphics.ts';
import { Keyboard } from './input.ts';
import { SoundPlayer } from './sound.ts';
import { World } from '../game/world.ts';
import { Location } from '../game/party.ts';
import { buildViewport, VIEW_SIZE, type Viewport } from '../game/viewport.ts';
import type { GameIO } from '../game/io.ts';

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

export class Screen implements GameIO {
  private readonly ctx: CanvasRenderingContext2D;
  /** Pixel size of one cell. */
  readonly cell: number;

  private view: Viewport | null = null;
  private viewDirty = true;
  private lastFrame = 0;

  /** Text cursor in the message area. (`wx`, `wy`) */
  private cursorX = TEXT_LEFT + 1;
  private cursorY = ROWS - 1;
  /** Characters currently shown in the message area, so it can be scrolled. */
  private textRows: string[][] = [];

  /** Last values drawn in each stats box, to avoid redrawing every turn. */
  private statsCache: string[] = ['', '', '', ''];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gfx: GraphicsSet,
    private readonly keyboard: Keyboard,
    private readonly sounds: SoundPlayer,
    private readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.cell = Math.floor(canvas.width / COLUMNS);
    for (let r = 0; r < TEXT_BOTTOM - TEXT_TOP; r++) this.textRows.push(new Array(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------------------
  // Frame / border
  // -------------------------------------------------------------------------

  /** Draw the in-game border. (`DrawFrame(1)`) */
  drawGameFrame(): void {
    const { ctx, cell } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const piece = (n: number, x: number, y: number) => this.gfx.drawUiPiece(ctx, n - 1, 0, x * cell, y * cell, cell);
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
    this.showWind();
    this.showMoons();
    this.statsCache = ['', '', '', ''];
    this.updateStats(true);
    this.viewDirty = true;
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

  /** Draw a string centred on column x. (`UCenterAt`) */
  drawTextCentred(text: string, x: number, y: number): void {
    this.drawText(text, x - Math.floor(text.length / 2), y);
  }

  private redrawTextArea(): void {
    for (let r = 0; r < this.textRows.length; r++) this.drawText(this.textRows[r].join(''), TEXT_LEFT, TEXT_TOP + r);
  }

  /** Scroll the message area up one line. (`UTextScroll`) */
  private scrollText(): void {
    this.textRows.shift();
    this.textRows.push(new Array(TEXT_RIGHT - TEXT_LEFT).fill(' '));
    this.redrawTextArea();
    // The prompt corner piece is part of the border, redraw it after scrolling.
    this.gfx.drawUiPiece(this.ctx, Piece.BottomRight - 1, 0, 23 * this.cell, 23 * this.cell, this.cell);
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
    this.gfx.drawUiPiece(this.ctx, Piece.BottomTee - 1, 0, 23 * this.cell, 23 * this.cell, this.cell);
    this.gfx.drawUiPiece(this.ctx, Piece.CapLeft - 1, 0, 24 * this.cell, 23 * this.cell, this.cell);
    this.textRows[TEXT_BOTTOM - 1 - TEXT_TOP][0] = ' ';
    this.cursorX = TEXT_LEFT + 1;
    this.cursorY = TEXT_BOTTOM - 1;
  }

  // -------------------------------------------------------------------------
  // Keyboard and sound
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

  sound(name: string): void {
    this.sounds.play(name);
  }

  pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------------
  // Map viewport
  // -------------------------------------------------------------------------

  redrawMap(): void {
    this.view = buildViewport(this.world);
    this.viewDirty = true;
  }

  clearTiles(): void {
    this.view = null;
    const { ctx, cell } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(cell, cell, cell * 22, cell * 22);
  }

  /** Paint the cached viewport. Called from the animation loop. */
  private paintViewport(): void {
    if (!this.view) return;
    const { ctx, cell, gfx } = this;
    const tile = cell * 2;
    for (let i = 0; i < this.view.cells.length; i++) {
      const c = this.view.cells[i];
      const dx = cell + (i % VIEW_SIZE) * tile;
      const dy = cell + Math.floor(i / VIEW_SIZE) * tile;
      gfx.drawShape(ctx, c.base, dx, dy, tile);
      if (c.overlay !== undefined) gfx.drawShape(ctx, c.overlay, dx, dy, tile, { masked: true, flip: c.flip });
    }
  }

  async flashTiles(): Promise<void> {
    const { ctx, cell } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(cell, cell, cell * 22, cell * 22);
    ctx.restore();
    await this.pause(100);
    this.viewDirty = true;
  }

  private frame(time: number): void {
    if (time - this.lastFrame >= ANIMATION_INTERVAL_MS) {
      this.lastFrame = time;
      this.gfx.tick();
      this.viewDirty = true;
    }
    if (this.viewDirty && this.view) {
      this.paintViewport();
      this.viewDirty = false;
    }
    requestAnimationFrame((t) => this.frame(t));
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
      const { ctx, cell } = this;
      ctx.fillStyle = '#000';
      ctx.fillRect(24 * cell, top * cell, 15 * cell, 3 * cell);
      if (!p) continue;
      this.drawTextCentred(p.name, 24 + 7, top);
      this.drawText(p.status, 38, top);
      this.drawText(`${p.sex}${p.race}${p.classLetter}`, 25, top + 1);
      this.drawText(`M:${pad(p.mana, 2)}`, 29, top + 1);
      this.drawText(`L:${pad(p.level, 2)}`, 34, top + 1);
      this.drawText(`H:${pad(p.hitPoints, 4)}`, 25, top + 2);
      this.drawText(`F:${pad(p.food, 4)}`, 32, top + 2);
    }
  }

  async flashMember(member: number): Promise<void> {
    const { ctx, cell } = this;
    const top = member * 4 + 1;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(24 * cell, top * cell, 15 * cell, 3 * cell);
    ctx.restore();
    await this.pause(100);
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(24 * cell, top * cell, 15 * cell, 3 * cell);
    ctx.restore();
  }

  /** Wind indicator on the bottom border. (`ShowWind`) */
  showWind(): void {
    const w = this.world;
    const piece = (n: number, x: number, y: number) =>
      this.gfx.drawUiPiece(this.ctx, n - 1, 0, x * this.cell, y * this.cell, this.cell);
    if (w.party.location === Location.Dungeon) return;
    if (w.party.location === Location.Combat || !w.windEnabled) {
      for (let x = 6; x <= 17; x++) piece(Piece.Horizontal, x, 23);
      return;
    }
    piece(Piece.CapLeft, 6, 23);
    piece(Piece.CapRight, 17, 23);
    // MoreMessages 43..47 (1-based) are CALM WINDS, NORTH WIND ... WEST WIND.
    const label = w.resources.strings.MoreMessages[42 + w.windDirection] ?? '';
    this.drawText(label.padEnd(10), 7, 23);
  }

  /** Moon phases on the top border: "(t)(f)" for Trammel and Felucca. (`DrawMoonGateStuff`) */
  showMoons(): void {
    const w = this.world;
    const piece = (n: number, x: number, y: number) =>
      this.gfx.drawUiPiece(this.ctx, n - 1, 0, x * this.cell, y * this.cell, this.cell);
    piece(Piece.CapLeft, 8, 0);
    this.drawText(`(${w.moonPhase[0]})(${w.moonPhase[1]})`, 9, 0);
    piece(Piece.CapRight, 15, 0);
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
