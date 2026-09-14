/**
 * touch.ts
 *
 * A virtual controller for touch screens (and the mouse): a d-pad at the
 * lower left, A and B at the lower right in the Xbox arrangement (A low,
 * B up and to its right), a close button at the upper left and, at the
 * upper right, a full-screen button where the browser allows it with a Y
 * button below it (Y opens the cheats from the help pages, and is Look,
 * Attack or Ignite in play). Everything
 * is drawn as one-pixel lines at three-quarter white with nothing inside,
 * so the game shows through. Sizes are in millimetres, which CSS scales
 * by the device's pixel ratio, so the pad is about the size of an NES
 * controller's on any screen.
 *
 * The pad feeds the same Keyboard the game reads, as a gamepad does, and
 * switches the game to controller mode. A tap anywhere shows it; only its
 * close button hides it (or a physical key or gamepad press, so a mouse
 * user who clicked once is not stuck with it). Whether it is shown is
 * remembered between visits.
 */

import { Key } from '../game/io.ts';
import type { Keyboard } from './input.ts';

/** Sizes in millimetres: the NES d-pad is about 24 across and its buttons about 10; thumbs on glass want a little more. */
const DPAD_MM = 28;
const BUTTON_MM = 14;
const SMALL_MM = 10;
const MARGIN_MM = 8;
/** Holding a d-pad direction repeats it, as a held key does. */
const REPEAT_FIRST_MS = 250;
const REPEAT_MS = 120;

const STROKE = 'rgba(255,255,255,0.75)';
const SVG = 'http://www.w3.org/2000/svg';

export interface TouchPadOptions {
  keyboard: Keyboard;
  /** Called on every press: the game switches to controller mode. */
  onPress: () => void;
  /** Called when the pad is shown or hidden, to remember it. */
  onToggle: (shown: boolean) => void;
  shown: boolean;
}

export class TouchPad {
  private readonly root: HTMLDivElement;
  private repeat: ReturnType<typeof setTimeout> | null = null;
  private fullscreenButton: SVGSVGElement | null = null;
  private _shown = false;

  constructor(private readonly options: TouchPadOptions) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none;z-index:10;';
    document.body.appendChild(this.root);

    this.root.appendChild(this.dpad());
    // A low and B up to its right, each a button's width and a little more apart on the diagonal.
    this.root.appendChild(this.button('A', Key.A, `right:${MARGIN_MM + BUTTON_MM + 1}mm;bottom:${MARGIN_MM}mm`));
    this.root.appendChild(this.button('B', Key.B, `right:${MARGIN_MM}mm;bottom:${MARGIN_MM + BUTTON_MM + 1}mm`));
    this.root.appendChild(this.closeButton());
    this.root.appendChild(this.button('Y', Key.Y, `right:${MARGIN_MM}mm;top:${MARGIN_MM + SMALL_MM + 4}mm`));
    if (document.fullscreenEnabled) {
      this.fullscreenButton = this.fullscreenToggle();
      this.root.appendChild(this.fullscreenButton);
      document.addEventListener('fullscreenchange', () => this.showFullscreenButton());
      this.showFullscreenButton();
    }

    // A tap or click anywhere shows the pad; a physical key hides it.
    window.addEventListener('pointerdown', () => {
      if (!this._shown) this.show(true);
    });
    window.addEventListener('keydown', (e) => {
      if (this._shown && !e.metaKey && !e.ctrlKey && !e.altKey) this.show(false);
    });
    this.show(options.shown, true);
  }

  get shown(): boolean {
    return this._shown;
  }

  /** Show or hide the pad. */
  show(on: boolean, quiet = false): void {
    this._shown = on;
    this.root.style.display = on ? 'block' : 'none';
    if (!on) this.release();
    if (!quiet) this.options.onToggle(on);
  }

  private showFullscreenButton(): void {
    if (this.fullscreenButton) this.fullscreenButton.style.display = document.fullscreenElement ? 'none' : 'block';
  }

  /** An SVG of `mm` millimetres square placed with the given CSS position, with a safe-area inset added. */
  private svg(mm: number, position: string): SVGSVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${mm} ${mm}`);
    svg.setAttribute('width', `${mm}mm`);
    svg.setAttribute('height', `${mm}mm`);
    svg.style.cssText = `position:absolute;${position};pointer-events:none;overflow:visible;touch-action:none;`;
    // Keep clear of notches and rounded corners.
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const m = position.match(new RegExp(`${side}:([0-9.]+)mm`));
      if (m) svg.style.setProperty(side, `calc(${m[1]}mm + env(safe-area-inset-${side}, 0px))`);
    }
    return svg;
  }

  /** A shape drawn as a line, with a transparent fill so taps inside it count. */
  private shape(kind: 'path' | 'circle' | 'rect', attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS(SVG, kind);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('fill', 'transparent');
    el.setAttribute('stroke', STROKE);
    el.setAttribute('stroke-width', '0.26'); // one CSS pixel in millimetres
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('stroke-linejoin', 'round');
    return el;
  }

  /** Make an element a button: pressing pushes `key`; the d-pad's repeat while held. */
  private pressable(el: SVGElement, key: string, repeats: boolean): void {
    el.style.pointerEvents = 'all';
    el.style.cursor = 'pointer';
    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      el.setAttribute('stroke', '#fff');
      el.setAttribute('stroke-width', '0.52');
      this.press(key);
      if (repeats) {
        this.release();
        this.repeat = setTimeout(() => {
          this.repeat = setInterval(() => this.press(key), REPEAT_MS);
        }, REPEAT_FIRST_MS);
      }
    };
    const up = () => {
      el.setAttribute('stroke', STROKE);
      el.setAttribute('stroke-width', '0.26');
      this.release();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  private press(key: string): void {
    this.options.onPress();
    this.options.keyboard.push(key);
  }

  private release(): void {
    if (this.repeat !== null) {
      clearTimeout(this.repeat);
      clearInterval(this.repeat);
      this.repeat = null;
    }
  }

  /** The d-pad: a cross outline, its four arms the buttons, with a small arrow in each. */
  private dpad(): SVGSVGElement {
    const svg = this.svg(DPAD_MM, `left:${MARGIN_MM}mm;bottom:${MARGIN_MM}mm`);
    const s = DPAD_MM;
    const a = s / 3; // arm width
    const c = s / 2;
    svg.appendChild(
      this.shape('path', {
        d: `M${a} 0 H${2 * a} V${a} H${s} V${2 * a} H${2 * a} V${s} H${a} V${2 * a} H0 V${a} H${a} Z`,
      }),
    );
    const arms: [string, string, string][] = [
      [Key.Up, `M${a} 0 H${2 * a} V${a} H${a} Z`, `M${c - 2} ${a * 0.65} L${c} ${a * 0.35} L${c + 2} ${a * 0.65}`],
      [Key.Down, `M${a} ${2 * a} H${2 * a} V${s} H${a} Z`, `M${c - 2} ${s - a * 0.65} L${c} ${s - a * 0.35} L${c + 2} ${s - a * 0.65}`],
      [Key.Left, `M0 ${a} H${a} V${2 * a} H0 Z`, `M${a * 0.65} ${c - 2} L${a * 0.35} ${c} L${a * 0.65} ${c + 2}`],
      [
        Key.Right,
        `M${2 * a} ${a} H${s} V${2 * a} H${2 * a} Z`,
        `M${s - a * 0.65} ${c - 2} L${s - a * 0.35} ${c} L${s - a * 0.65} ${c + 2}`,
      ],
    ];
    for (const [key, hit, arrow] of arms) {
      const mark = this.shape('path', { d: arrow });
      mark.setAttribute('stroke-linecap', 'round');
      svg.appendChild(mark);
      const zone = this.shape('path', { d: hit });
      zone.setAttribute('stroke', 'none');
      this.pressable(zone, key, true);
      // The zone brightens the arrow rather than itself.
      zone.addEventListener('pointerdown', () => mark.setAttribute('stroke', '#fff'));
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
        zone.addEventListener(ev, () => mark.setAttribute('stroke', STROKE));
      svg.appendChild(zone);
    }
    return svg;
  }

  /** A round button with its letter drawn as an outline. */
  private button(label: string, key: string, position: string): SVGSVGElement {
    const svg = this.svg(BUTTON_MM, position);
    const r = BUTTON_MM / 2;
    const circle = this.shape('circle', { cx: `${r}`, cy: `${r}`, r: `${r - 0.5}` });
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', `${r}`);
    text.setAttribute('y', `${r + 2}`);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('font-size', '6');
    text.setAttribute('fill', 'transparent');
    text.setAttribute('stroke', STROKE);
    text.setAttribute('stroke-width', '0.26');
    text.style.pointerEvents = 'none';
    text.textContent = label;
    svg.appendChild(circle);
    svg.appendChild(text);
    this.pressable(circle, key, false);
    return svg;
  }

  /** Upper left: a circled cross that hides the pad. */
  private closeButton(): SVGSVGElement {
    const svg = this.svg(SMALL_MM, `left:${MARGIN_MM}mm;top:${MARGIN_MM}mm`);
    const r = SMALL_MM / 2;
    const circle = this.shape('circle', { cx: `${r}`, cy: `${r}`, r: `${r - 0.5}` });
    const cross = this.shape('path', { d: `M${r - 2} ${r - 2} L${r + 2} ${r + 2} M${r + 2} ${r - 2} L${r - 2} ${r + 2}` });
    cross.style.pointerEvents = 'none';
    circle.style.pointerEvents = 'all';
    circle.style.cursor = 'pointer';
    circle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.show(false);
    });
    svg.appendChild(circle);
    svg.appendChild(cross);
    return svg;
  }

  /** Upper right: a square with corner marks that asks for full screen; hidden while in it. */
  private fullscreenToggle(): SVGSVGElement {
    const svg = this.svg(SMALL_MM, `right:${MARGIN_MM}mm;top:${MARGIN_MM}mm`);
    const s = SMALL_MM;
    const box = this.shape('rect', { x: '0.5', y: '0.5', width: `${s - 1}`, height: `${s - 1}`, rx: '1' });
    const corners = this.shape('path', {
      d: `M2.5 4.5 V2.5 H4.5 M${s - 4.5} 2.5 H${s - 2.5} V4.5 M${s - 2.5} ${s - 4.5} V${s - 2.5} H${s - 4.5} M4.5 ${s - 2.5} H2.5 V${s - 4.5}`,
    });
    corners.style.pointerEvents = 'none';
    box.style.pointerEvents = 'all';
    box.style.cursor = 'pointer';
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void document.documentElement.requestFullscreen().catch(() => {
        /* refused: nothing to do */
      });
    });
    svg.appendChild(box);
    svg.appendChild(corners);
    return svg;
  }
}
