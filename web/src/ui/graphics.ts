/**
 * graphics.ts
 *
 * Loads a tile set and knows how to find any tile in it. A tile set is a
 * family of images in public/graphics named "<Set>-Tiles", "-Font" and
 * "-UI" (after LairWare's layout, `Resources/Graphics/_About This Folder_.rtf`):
 *
 *   Tiles  12 columns x 16 rows. Column pairs hold the two animation frames
 *          of a tile: tile index i is at row i % 16, column (i / 16) * 2, and
 *          its alternate frame is one column to the right. The sheet's own
 *          alpha channel is the transparency used when drawing creatures and
 *          objects over terrain; the Mac kept it in a separate "-Mask" image
 *          (black opaque, white clear), which this port baked into the sheets
 *          that had one. A "-Mask" file is still honoured if a set ships one.
 *          Sets with neither draw creatures opaque, as their machines did.
 *   Font   96 glyphs in one row, starting at ASCII 0x20 (space).
 *   UI     16 columns x 3 rows of border pieces, cursor frames, moon phases.
 *
 * Images may be any resolution; everything is scaled to the screen's cell
 * size when drawn. This module also owns the tile animation state that
 * `FullUpdate()` advanced every idle tick in the original.
 */

import { DUNGEON_STYLES, paintDungeonSheet, type DungeonStyle } from './dungeonArt.ts';
import { Shape } from '../game/tiles.ts';

export const TILE_COLUMNS = 12;
export const TILE_ROWS = 16;
export const FONT_GLYPHS = 96;
export const UI_COLUMNS = 16;
export const UI_ROWS = 3;

export interface SourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

/** The pictures in public/images, by file name without extension. */
export type ImageMap = Map<string, HTMLImageElement>;

/** Load the pictures used in play (title, dungeon walls, shrines, fountains ...). */
export async function loadImages(baseUrl = 'images/'): Promise<ImageMap> {
  const files = ['Exodus.png', 'Fountain.jpg', 'Rod.jpg', 'Shrine.jpg', 'TimeLord.jpg', 'SosariaMap.jpg'];
  const images: ImageMap = new Map();
  await Promise.all(
    files.map(async (file) => {
      images.set(file.replace(/\.[a-z]+$/, ''), await loadImage(baseUrl + file));
    }),
  );
  return images;
}

/**
 * Combine a tile sheet with its mask into one RGBA canvas whose alpha
 * channel comes from the mask (black = opaque). Drawing from this canvas
 * gives transparent creatures for free.
 */
function applyMask(tiles: HTMLImageElement, mask: HTMLImageElement | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = tiles.width;
  canvas.height = tiles.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(tiles, 0, 0);
  if (!mask) return canvas; // the sheet's own alpha (if any) is the mask

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = tiles.width;
  maskCanvas.height = tiles.height;
  const mctx = maskCanvas.getContext('2d')!;
  mctx.drawImage(mask, 0, 0, tiles.width, tiles.height);

  const rgba = ctx.getImageData(0, 0, tiles.width, tiles.height);
  const m = mctx.getImageData(0, 0, tiles.width, tiles.height).data;
  for (let i = 0; i < rgba.data.length; i += 4) {
    // Luminance of the mask pixel: 0 (black) means fully opaque.
    rgba.data[i + 3] = 255 - Math.round((m[i] + m[i + 1] + m[i + 2]) / 3);
  }
  ctx.putImageData(rgba, 0, 0);
  return canvas;
}

export class GraphicsSet {
  /** Pixel size of one tile in the tile sheet. */
  readonly tileSize: number;
  /** Pixel size of one glyph in the font sheet. */
  /** Width of a glyph in the font sheet; glyphs are `fontHeight` tall (the Apple II fonts are 7:8). */
  readonly fontSize: number;
  readonly fontHeight: number;
  /** Pixel size of one UI piece. */
  readonly uiSize: number;

  /** Which tiles are currently showing their alternate frame. (`gShapeSwapped`) */
  private swapped = new Uint8Array(TILE_COLUMNS * TILE_ROWS);
  /** Vertical scroll offset in tile pixels for water, lava, forcefield and moongate. */
  private scroll = new Map<number, number>();

  // Animation counters, with the original's initial values. (`twiddleFlag`, `animFlag`)
  private twiddle = [3, 2, 1];
  private animPhase = 16;
  private animSkip = 5;

  /** The sheet over black: what terrain is drawn from, so a transparent pixel never shows the last frame. */
  private readonly opaqueTiles: HTMLCanvasElement;

  private constructor(
    readonly tiles: HTMLImageElement,
    readonly maskedTiles: HTMLCanvasElement,
    readonly font: HTMLImageElement,
    readonly ui: HTMLImageElement,
    /**
     * The first-person dungeon art: a 3000x512 sheet of wall pieces and
     * corridor background (see dungeonView.ts) and the mask for its angled
     * side walls. Per set, so a wireframe set can have wireframe dungeons;
     * a set without its own falls back to Standard's.
     */
    readonly dungeonShapes: HTMLImageElement | HTMLCanvasElement | null,
    readonly dungeonMasks: HTMLImageElement | null,
    /** The style the sheet was painted from at run time (null for a sheet loaded from a file). */
    readonly dungeonStyle: DungeonStyle | null,
  ) {
    this.tileSize = tiles.width / TILE_COLUMNS;
    this.opaqueTiles = document.createElement('canvas');
    this.opaqueTiles.width = tiles.width;
    this.opaqueTiles.height = tiles.height;
    const octx = this.opaqueTiles.getContext('2d')!;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, tiles.width, tiles.height);
    octx.drawImage(tiles, 0, 0);
    this.fontSize = font.width / FONT_GLYPHS;
    this.fontHeight = font.height;
    this.uiSize = ui.width / UI_COLUMNS;
  }

  /**
   * Load the named set (default "Standard"). Missing optional files fall
   * back to the Standard set's, as the original did.
   */
  static async load(name = 'Standard', baseUrl = 'graphics/'): Promise<GraphicsSet> {
    const tryLoad = async (suffix: string, exts: string[], fallback = true): Promise<HTMLImageElement | null> => {
      for (const set of fallback ? [name, 'Standard'] : [name]) {
        for (const ext of exts) {
          try {
            return await loadImage(`${baseUrl}${encodeURIComponent(set)}-${suffix}.${ext}`);
          } catch {
            /* try the next candidate */
          }
        }
      }
      return null;
    };
    const tiles = await tryLoad('Tiles', ['png', 'gif']);
    if (!tiles) throw new Error('No tile sheet could be loaded');
    const mask = await tryLoad('Mask', ['gif', 'png'], false); // only a set's own: Standard's would not fit another sheet
    const font = await tryLoad('Font', ['gif', 'png']);
    const ui = await tryLoad('UI', ['png', 'gif']);
    if (!font || !ui) throw new Error('Font or UI sheet missing');
    // Dungeon art: the set's own sheet if it has one, else painted from its style, else Standard's sheet.
    const dungeonMasks = await tryLoad('DungeonMasks', ['png', 'gif']);
    const ownShapes = await tryLoad('DungeonShapes', ['png', 'jpg'], false);
    const style = ownShapes ? null : (DUNGEON_STYLES[name] ?? null);
    const dungeonShapes =
      ownShapes ?? (style && dungeonMasks ? paintDungeonSheet(style, dungeonMasks) : await tryLoad('DungeonShapes', ['png', 'jpg']));
    return new GraphicsSet(tiles, applyMask(tiles, mask), font, ui, dungeonShapes, dungeonMasks, style);
  }

  /** Source rectangle of a tile index, honouring the animation frame. (`GetTileRectForIndex`) */
  tileRect(index: number, frameOverride?: boolean): SourceRect {
    const s = this.tileSize;
    const swapped = frameOverride ?? this.swapped[index] === 1;
    return {
      x: (Math.floor(index / TILE_ROWS) * 2 + (swapped ? 1 : 0)) * s,
      y: (index % TILE_ROWS) * s,
      w: s,
      h: s,
    };
  }

  /**
   * Draw a shape (tile index * 2, or 0x5D for a door) at pixel (dx, dy) with
   * the given on-screen size. Water and friends scroll vertically; shapes
   * drawn `masked` use the transparency mask.
   */
  drawShape(
    ctx: CanvasRenderingContext2D,
    shape: number,
    dx: number,
    dy: number,
    size: number,
    opts: { masked?: boolean; flip?: boolean; altFrame?: boolean } = {},
  ): void {
    const src: CanvasImageSource = opts.masked ? this.maskedTiles : this.opaqueTiles;
    // Doors are the alternate frame of the letter "I"; `altFrame` forces the
    // second frame (used for the "HIT" balls).
    const rect = shape === Shape.Door ? this.tileRect(Shape.Door >> 1, true) : this.tileRect(shape >> 1, opts.altFrame ? true : undefined);
    const scrollPx = this.scroll.get(shape) ?? 0;
    const flip = opts.flip ?? false;
    if (flip) {
      ctx.save();
      ctx.translate(dx + size, dy);
      ctx.scale(-1, 1);
      dx = 0;
      dy = 0;
    }
    if (scrollPx === 0) {
      ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, dx, dy, size, size);
    } else {
      // Scrolling: draw the bottom part of the tile at the top and vice versa.
      const scale = size / rect.h;
      const topH = rect.h - scrollPx;
      ctx.drawImage(src, rect.x, rect.y + scrollPx, rect.w, topH, dx, dy, size, topH * scale);
      ctx.drawImage(src, rect.x, rect.y, rect.w, scrollPx, dx, dy + topH * scale, size, scrollPx * scale);
    }
    if (flip) ctx.restore();
  }

  /** Draw a glyph of the classic bitmap font. */
  drawGlyph(ctx: CanvasRenderingContext2D, ch: string, dx: number, dy: number, size: number): void {
    let code = ch.charCodeAt(0) - 0x20;
    if (code < 0 || code >= FONT_GLYPHS) code = 0;
    // The whole glyph, however tall, fits the square cell.
    ctx.drawImage(this.font, code * this.fontSize, 0, this.fontSize, this.fontHeight, dx, dy, size, size);
  }

  /** Draw a moon's phase (0..7) from the UI sheet's third row: Trammel's eight, then Felucca's. */
  drawMoon(ctx: CanvasRenderingContext2D, moon: 0 | 1, phase: number, dx: number, dy: number, size: number): void {
    this.drawUiPiece(ctx, moon * 8 + (phase & 7), 2, dx, dy, size);
  }

  /** Draw piece (column, row) of the UI sheet. */
  drawUiPiece(ctx: CanvasRenderingContext2D, column: number, row: number, dx: number, dy: number, size: number): void {
    const s = this.uiSize;
    ctx.drawImage(this.ui, column * s, row * s, s, s, dx, dy, size, size);
  }

  /**
   * Advance the tile animations by one idle tick. Ports `ScrollThings()`,
   * `TwiddleFlags()` and `AnimateTiles()` from UltimaMain.c: water and lava
   * scroll slowly, forcefields and moongates twice as fast; town, castle and
   * ship flags flap on their own periods; creatures cycle through their two
   * frames one type at a time.
   */
  tick(): void {
    // Scrolling terrain. The original scrolled by tileSize/16 pixels.
    const step = Math.max(1, Math.round(this.tileSize / 32));
    const scrollBy = (shape: number, amount: number) => {
      this.scroll.set(shape, ((this.scroll.get(shape) ?? 0) + amount) % this.tileSize);
    };
    scrollBy(Shape.ForceField, step * 2);
    scrollBy(Shape.MoonGate, step * 2);
    scrollBy(Shape.Water, step);
    scrollBy(Shape.Lava, step);

    // Flags: castle every 4th tick, town every 3rd, ship every 2nd.
    const flagShapes = [Shape.Castle, Shape.Town, Shape.Frigate];
    const flagPeriods = [3, 2, 1];
    for (let i = 0; i < 3; i++) {
      if (--this.twiddle[i] < 1) {
        this.twiddle[i] = flagPeriods[i];
        this.swap(flagShapes[i]);
      }
    }

    // Creatures: every tick but the 5th, advance one creature type.
    for (;;) {
      if (--this.animSkip < 1) {
        this.animSkip = 5;
        return;
      }
      if (--this.animPhase < 0) this.animPhase = 19;
      let shape = this.animPhase * 2 + 32; // 0x20 .. 0x46
      if (shape >= 0x44) this.swap(shape - 0x2a); // also Serpent, Man-O-War, Pirate
      if (shape === 0x20) this.swap(Shape.Ranger); // the party symbol
      if (shape === 62) shape = 24;
      if (shape > 62) shape += 64;
      this.swap(shape);
      if (shape >= 0x2e && shape <= 0x3c) {
        // Monster types with variants: swap the variant tiles too.
        const v = ((shape >> 1) - 23) * 2 + 80;
        this.swap(v * 2);
        this.swap((v + 1) * 2);
      }
    }
  }

  /** Toggle a shape's animation frame. (`SwapShape`) */
  private swap(shape: number): void {
    const index = shape >> 1;
    if (index < this.swapped.length) this.swapped[index] ^= 1;
  }
}
