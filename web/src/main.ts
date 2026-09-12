/**
 * main.ts
 *
 * Browser entry point: load the data and graphics, build the world, wire up
 * the screen and keyboard, then run the title menu, which starts the game.
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

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('screen') as HTMLCanvasElement;

  const params = new URLSearchParams(location.search);

  // The tile set (graphics, font and border) is chosen with a selector and remembered.
  const tilesSelect = document.getElementById('tiles') as HTMLSelectElement;
  let tileSet = 'Standard';
  try {
    const saved = localStorage.getItem('ultima3.tiles');
    if (saved && [...tilesSelect.options].some((o) => o.value === saved)) tileSet = saved;
  } catch {
    /* storage unavailable */
  }
  tilesSelect.value = tileSet;

  const [resources, gfx, images] = await Promise.all([loadResources(), GraphicsSet.load(tileSet), loadImages()]);

  const setting = (key: string, fallback: boolean): boolean => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  };
  const remember = (key: string, on: boolean) => {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  // Classic moves (no party diagonals) must be known before the map loads.
  const world = new World(resources);
  world.setClassicMoves(setting('ultima3.classicMoves', true));

  // Resume the saved game unless the URL asks for a new one (?new).
  if (params.has('new') || !localSave.read(world)) world.newGame();

  const sounds = new SoundPlayer();
  const music = new MusicPlayer();
  music.enabled = params.get('music') !== '0';
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
  canvas.focus();

  // Input mode: keyboard (the Apple II letter commands) or controller (menus).
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  const savedMode = (() => {
    try {
      return localStorage.getItem('ultima3.inputMode');
    } catch {
      return null;
    }
  })();
  screen.inputMode = savedMode === 'controller' ? 'controller' : 'keyboard';
  modeSelect.value = screen.inputMode;
  const rememberMode = () => {
    modeSelect.value = screen.inputMode;
    try {
      localStorage.setItem('ultima3.inputMode', screen.inputMode);
    } catch {
      /* storage unavailable */
    }
  };
  modeSelect.addEventListener('change', () => {
    screen.inputMode = modeSelect.value === 'controller' ? 'controller' : 'keyboard';
    rememberMode();
    canvas.focus();
  });
  screen.onModeChange = rememberMode;

  tilesSelect.addEventListener('change', async () => {
    const name = tilesSelect.value;
    try {
      screen.setGraphics(await GraphicsSet.load(name));
      localStorage.setItem('ultima3.tiles', name);
    } catch (err) {
      status.textContent = `Could not load the ${name} tiles: ${err instanceof Error ? err.message : String(err)}`;
    }
    canvas.focus();
  });

  // Auto-combat: the party fights by itself (a LairWare addition). Escape in
  // a fight turns it off, so the checkbox follows the game as well.
  const autoCheck = document.getElementById('auto') as HTMLInputElement;
  world.autoCombat = setting('ultima3.autoCombat', false);
  autoCheck.checked = world.autoCombat;
  const rememberAuto = () => {
    autoCheck.checked = world.autoCombat;
    remember('ultima3.autoCombat', world.autoCombat);
  };
  autoCheck.addEventListener('change', () => {
    world.autoCombat = autoCheck.checked;
    rememberAuto();
    canvas.focus();
  });
  world.onAutoCombatChange = rememberAuto;

  // Classic moves: the party has no diagonals, as on the Apple II.
  const classicCheck = document.getElementById('classic') as HTMLInputElement;
  classicCheck.checked = world.classicMoves;
  classicCheck.addEventListener('change', () => {
    world.setClassicMoves(classicCheck.checked);
    remember('ultima3.classicMoves', world.classicMoves);
    canvas.focus();
  });

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
