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
import { AutoMap, MAP_MODES, type MapMode } from './game/automap.ts';
import { mainMenu } from './game/menu.ts';
import { GraphicsSet, loadImages } from './ui/graphics.ts';
import { Keyboard } from './ui/input.ts';
import { SoundPlayer } from './ui/sound.ts';
import { MusicPlayer } from './ui/music.ts';
import { Screen } from './ui/screen.ts';
import { TILE_SETS } from './ui/help.ts';

const PREFS_KEY = 'ultima3.settings';
const AUTOMAP_KEY = 'ultima3.automap';

/** What the Settings menu can change, as remembered between visits. */
interface Prefs {
  inputMode: 'keyboard' | 'controller';
  tiles: string;
  diagonalMoves: boolean;
  autoCombat: boolean;
  poisonKills: boolean;
  sound: boolean;
  music: boolean;
  dungeonMap: MapMode;
}

const DEFAULT_PREFS: Prefs = { inputMode: 'keyboard', tiles: 'Standard', diagonalMoves: false, autoCombat: false, poisonKills: false, sound: true, music: true, dungeonMap: 'off' };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Prefs> & { classicMoves?: boolean }) : {};
    const prefs = { ...DEFAULT_PREFS, ...saved };
    // The setting was "classic moves" (the inverse) until September 2026.
    if (saved.classicMoves !== undefined && saved.diagonalMoves === undefined) prefs.diagonalMoves = !saved.classicMoves;
    if (!TILE_SETS.includes(prefs.tiles)) prefs.tiles = DEFAULT_PREFS.tiles;
    if (prefs.inputMode !== 'controller') prefs.inputMode = 'keyboard';
    if (!MAP_MODES.includes(prefs.dungeonMap)) prefs.dungeonMap = 'off';
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

/** Text on the bare canvas before the game (or instead of it, on failure). */
function canvasNotice(text: string): void {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c8c8c8';
  ctx.font = `${canvas.height / 24}px monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 40, canvas.height / 2);
}

async function start(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  canvasNotice('Loading...');
  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();

  const [resources, gfx, images] = await Promise.all([loadResources(), GraphicsSet.load(prefs.tiles), loadImages()]);

  // Diagonal moves must be known before the map loads (it shapes the land by Exodus' castle).
  const world = new World(resources);
  world.setDiagonalMoves(prefs.diagonalMoves);
  world.autoCombat = prefs.autoCombat;
  world.poisonKills = prefs.poisonKills;
  world.soundEnabled = prefs.sound;
  world.mapMode = prefs.dungeonMap;
  // The dungeon auto-map keeps its own store; a new game starts it blank.
  world.autoMap = new AutoMap({ read: () => localStorage.getItem(AUTOMAP_KEY), write: (text) => localStorage.setItem(AUTOMAP_KEY, text) });

  // Resume the saved game unless the URL asks for a new one (?new).
  if (params.has('new') || !localSave.read(world)) {
    world.newGame();
    world.autoMap.clear();
  }

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
      poisonKills: world.poisonKills,
      sound: world.soundEnabled,
      music: music.enabled,
      dungeonMap: world.mapMode,
    });
  };
  screen.onSettingsChange = remember;
  world.onMapModeChange = remember;
  screen.onModeChange = remember;
  world.onAutoCombatChange = remember;

  const game = new Game(world, screen, { save: (w) => localSave.write(w), load: (w) => localSave.read(w) });
  // Debug hook: lets the console (and the browser tests) inspect and poke the game.
  (window as unknown as { u3: unknown }).u3 = { world, screen, game };
  await mainMenu(world, screen, () => game.run(), { save: (w) => localSave.write(w) });
}

start().catch((err) => {
  console.error(err);
  canvasNotice(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
