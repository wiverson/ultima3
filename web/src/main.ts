/**
 * main.ts
 *
 * Browser entry point: load the data and graphics, build the world, wire up
 * the screen and keyboard, then run the title menu, which starts the game.
 *
 * Settings live in the game's own Settings menu (Escape, or the last entry
 * of the controller command menu); this file only remembers them between
 * visits, in localStorage.
 */

import { loadResources } from './data/resources.ts';
import { World } from './game/world.ts';
import { Game } from './game/game.ts';
import { localSave } from './game/save.ts';
import { mainMenu } from './game/menu.ts';
import { GraphicsSet, loadImages } from './ui/graphics.ts';
import { Keyboard } from './ui/input.ts';
import { SoundPlayer } from './ui/sound.ts';
import { MusicPlayer } from './ui/music.ts';
import { Screen } from './ui/screen.ts';
import { TILE_SETS } from './ui/help.ts';

const PREFS_KEY = 'ultima3.settings';

/** What the Settings menu can change, as remembered between visits. */
interface Prefs {
  inputMode: 'keyboard' | 'controller';
  tiles: string;
  diagonalMoves: boolean;
  autoCombat: boolean;
  sound: boolean;
  music: boolean;
}

const DEFAULT_PREFS: Prefs = { inputMode: 'keyboard', tiles: 'Standard', diagonalMoves: false, autoCombat: false, sound: true, music: true };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Prefs> & { classicMoves?: boolean }) : {};
    const prefs = { ...DEFAULT_PREFS, ...saved };
    // The setting was "classic moves" (the inverse) until September 2026.
    if (saved.classicMoves !== undefined && saved.diagonalMoves === undefined) prefs.diagonalMoves = !saved.classicMoves;
    if (!TILE_SETS.includes(prefs.tiles)) prefs.tiles = DEFAULT_PREFS.tiles;
    if (prefs.inputMode !== 'controller') prefs.inputMode = 'keyboard';
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();

  const [resources, gfx, images] = await Promise.all([loadResources(), GraphicsSet.load(prefs.tiles), loadImages()]);

  // Diagonal moves must be known before the map loads (it shapes the land by Exodus' castle).
  const world = new World(resources);
  world.setDiagonalMoves(prefs.diagonalMoves);
  world.autoCombat = prefs.autoCombat;
  world.soundEnabled = prefs.sound;

  // Resume the saved game unless the URL asks for a new one (?new).
  if (params.has('new') || !localSave.read(world)) world.newGame();

  const sounds = new SoundPlayer();
  const music = new MusicPlayer();
  music.enabled = prefs.music;
  const keyboard = new Keyboard();
  // Audio may only start after a user gesture; the first key press is one.
  window.addEventListener(
    'keydown',
    () => {
      sounds.unlock();
      music.unlock();
    },
    { once: true },
  );

  const screen = new Screen(canvas, gfx, images, keyboard, sounds, music, world);
  screen.inputMode = prefs.inputMode;
  screen.tileSetName = prefs.tiles;
  canvas.focus();

  // Whatever changes a setting (the menu, a gamepad press, Escape in a fight), remember it.
  const remember = () => {
    savePrefs({
      inputMode: screen.inputMode,
      tiles: screen.tileSetName,
      diagonalMoves: world.diagonalMoves,
      autoCombat: world.autoCombat,
      sound: world.soundEnabled,
      music: music.enabled,
    });
  };
  screen.onSettingsChange = remember;
  screen.onModeChange = remember;
  world.onAutoCombatChange = remember;

  status.textContent = '';

  const game = new Game(world, screen, { save: (w) => localSave.write(w) });
  // Debug hook: lets the console (and the browser tests) inspect and poke the game.
  (window as unknown as { u3: unknown }).u3 = { world, screen, game };
  await mainMenu(world, screen, () => game.run(), { save: (w) => localSave.write(w) });
}

start().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
