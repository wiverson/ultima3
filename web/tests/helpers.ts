/**
 * Shared test helpers: load the extracted resources from disk and provide a
 * fake GameIO that records what the game printed and played.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resourcesFromBundle, type GameResources } from '../src/data/resources.ts';
import { World } from '../src/game/world.ts';
import type { GameIO } from '../src/game/io.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

let cached: GameResources | null = null;

/** Load public/data/resources.json once per test run. */
export function loadTestResources(): GameResources {
  if (!cached) {
    const json = readFileSync(join(HERE, '..', 'public', 'data', 'resources.json'), 'utf8');
    cached = resourcesFromBundle(JSON.parse(json));
  }
  return cached;
}

/** A fresh world on Sosaria with the default party, using a fixed RNG seed. */
export function newWorld(seed = 1234): World {
  const world = new World(loadTestResources(), seed);
  world.newGame();
  return world;
}

/** GameIO that records output instead of drawing. Keys are fed from `keys`. */
export class FakeIO implements GameIO {
  output = '';
  sounds: string[] = [];
  keys: string[] = [];
  redraws = 0;

  constructor(private readonly resources: GameResources) {}

  print(text: string): void {
    this.output += text;
  }
  printMessage(n: number): void {
    this.output += this.resources.strings.Messages[n - 1] ?? `[msg ${n}]`;
  }
  prompt(): void {
    this.output += '\n>';
  }
  async waitKey(): Promise<string> {
    const k = this.keys.shift();
    if (k === undefined) throw new Error('FakeIO: no more keys');
    return k;
  }
  async waitKeyOrTimeout(): Promise<string | null> {
    return this.keys.shift() ?? null;
  }
  flushKeys(): void {}
  sound(name: string): void {
    this.sounds.push(name);
  }
  redrawMap(): void {
    this.redraws++;
  }
  async flashTiles(): Promise<void> {}
  async flashMember(): Promise<void> {}
  updateStats(): void {}
  showWind(): void {}
  showMoons(): void {}
  clearTiles(): void {}
  async pause(): Promise<void> {}
}
