/**
 * save.ts
 *
 * Saving and restoring a game. The original wrote the party, roster and
 * "current Sosaria" back into its resource file. Here the same data becomes
 * a JSON object (binary fields base64-encoded) that the browser keeps in
 * localStorage.
 *
 * As in the original, a game saved inside a town or castle resumes on
 * Sosaria at the square the party entered from: towns are never persisted.
 */

import { World blockExodusApproach } from './world.ts';
import { Location } from './party.ts';
import { MapId } from '../data/resources.ts';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'ultima3.save';

export interface SaveData {
  version: number;
  party: string;
  roster: string;
  surfaceTiles: string;
  surfaceMonsters: string;
  whirlpool: { x: number; y: number; dx: number; dy: number };
  x: number;
  y: number;
  moonPhase: [number, number];
  moonTimer: [number, number];
  windDirection: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Capture the world. Position is the surface position even when in a town. */
export function serialize(world: World): SaveData {
  const onSurface = world.party.location === Location.Sosaria;
  return {
    version: SAVE_VERSION,
    party: toBase64(world.party.bytes),
    roster: toBase64(world.roster.bytes),
    surfaceTiles: toBase64(world.surface.tiles),
    surfaceMonsters: toBase64(world.surface.monsters.bytes),
    whirlpool: { ...world.whirlpool },
    x: onSurface ? world.x : world.returnX,
    y: onSurface ? world.y : world.returnY,
    moonPhase: [...world.moonPhase],
    moonTimer: [...world.moonTimer],
    windDirection: world.windDirection,
  };
}

/** Restore a world from `data`. Returns false (leaving the world untouched) if the data is unusable. */
export function restore(world: World, data: SaveData): boolean {
  if (data.version !== SAVE_VERSION) return false;
  try {
    const party = fromBase64(data.party);
    const roster = fromBase64(data.roster);
    const tiles = fromBase64(data.surfaceTiles);
    const monsters = fromBase64(data.surfaceMonsters);
    if (party.length !== 64 || roster.length !== 1280 || monsters.length !== 256) return false;
    const surface = world.loadMapState(MapId.Sosaria);
    if (tiles.length !== surface.tiles.length) return false;

    world.party.bytes.set(party);
    world.roster.bytes.set(roster);
    surface.tiles.set(tiles);
    blockExodusApproach(surface); // older saves still carry the force fields
    surface.monsters.bytes.set(monsters);
    world.surface = surface;
    world.current = surface;
    world.whirlpool = { ...data.whirlpool };
    world.party.location = Location.Sosaria;
    world.x = world.returnX = world.party.surfaceX = data.x;
    world.y = world.returnY = world.party.surfaceY = data.y;
    world.moonPhase = [data.moonPhase[0], data.moonPhase[1]];
    world.moonTimer = [data.moonTimer[0], data.moonTimer[1]];
    world.windDirection = data.windDirection;
    return true;
  } catch {
    return false;
  }
}

/** localStorage wrapper. Every call is guarded: storage may be unavailable or full. */
export const localSave = {
  write(world: World): boolean {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(world)));
      return true;
    } catch {
      return false;
    }
  },
  read(world: World): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      return restore(world, JSON.parse(raw) as SaveData);
    } catch {
      return false;
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  },
};
