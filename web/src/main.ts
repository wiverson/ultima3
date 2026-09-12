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
  const tileSet = params.get('tiles') ?? 'Standard';

  const [resources, gfx, images] = await Promise.all([loadResources(), GraphicsSet.load(tileSet), loadImages()]);

  // Resume the saved game unless the URL asks for a new one (?new).
  const world = new World(resources);
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
