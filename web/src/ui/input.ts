/**
 * input.ts
 *
 * Keyboard input as an awaitable queue. The game loop calls `nextKey()`;
 * key presses that arrive while nobody is waiting are queued (up to a small
 * limit) so fast typing is not lost, matching the original's event queue.
 *
 * Keys are normalised to the single-character codes in `Key` (game/io.ts):
 * arrows map to the Mac arrow codes 28..31; letters keep their case.
 */

import { Key } from '../game/io.ts';

const MAX_QUEUED = 8;

export class Keyboard {
  private queue: string[] = [];
  private waiter: ((key: string) => void) | null = null;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Leave browser shortcuts alone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = translate(e);
    if (key === null) return;
    e.preventDefault();
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(key);
    } else if (this.queue.length < MAX_QUEUED) {
      this.queue.push(key);
    }
  }

  /** Resolve with the next key press. */
  nextKey(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Resolve with the next key press, or `null` after `ms` milliseconds. */
  nextKeyOrTimeout(ms: number): Promise<string | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter === waiter) this.waiter = null;
        resolve(null);
      }, ms);
      const waiter = (key: string) => {
        clearTimeout(timer);
        resolve(key);
      };
      this.waiter = waiter;
    });
  }

  /** Drop queued presses (used after "INVALID MOVE!" so a held key does not repeat the bump). */
  flush(): void {
    this.queue.length = 0;
  }

  /** Inject a key from another source, such as a gamepad button. */
  push(key: string): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(key);
    } else if (this.queue.length < MAX_QUEUED) {
      this.queue.push(key);
    }
  }
}

/** Convert a DOM key event to a game key, or null if the game does not use it. */
export function translate(e: KeyboardEvent): string | null {
  switch (e.key) {
    case 'ArrowLeft':
      return Key.Left;
    case 'ArrowRight':
      return Key.Right;
    case 'ArrowUp':
      return Key.Up;
    case 'ArrowDown':
      return Key.Down;
    case 'Enter':
      return Key.Enter;
    case 'Backspace':
      return Key.Backspace;
    case 'Escape':
      return Key.Escape;
    default:
      break;
  }
  // Letters keep their case; game code upper-cases commands itself, so
  // names typed at the character creation screen keep mixed case.
  if (e.key.length === 1) return e.key;
  return null;
}
