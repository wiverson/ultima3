/**
 * main.ts
 *
 * Browser entry point: load the data and graphics, build the world, wire up
 * the screen and keyboard, and start the game loop.
 *
 * For now the game starts directly on Sosaria with the shipped default
 * party. The title screen, attract mode and party organisation menus are
 * later phases of the port.
 */

import { loadResources } from './data/resources.ts';
import { World } from './game/world.ts';
import { Game } from './game/game.ts';
import { localSave } from './game/save.ts';
import { GraphicsSet } from './ui/graphics.ts';
import { Keyboard } from './ui/input.ts';
import { SoundPlayer } from './ui/sound.ts';
import { Screen } from './ui/screen.ts';

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('screen') as HTMLCanvasElement;

  const params = new URLSearchParams(location.search);
  const tileSet = params.get('tiles') ?? 'Standard';

  const [resources, gfx] = await Promise.all([loadResources(), GraphicsSet.load(tileSet)]);

  // Resume the saved game unless the URL asks for a new one (?new).
  const world = new World(resources);
  if (params.has('new') || !localSave.read(world)) world.newGame();

  const sounds = new SoundPlayer();
  const keyboard = new Keyboard();
  // Audio may only start after a user gesture; the first key press is one.
  window.addEventListener('keydown', () => sounds.unlock(), { once: true });

  const screen = new Screen(canvas, gfx, keyboard, sounds, world);
  screen.drawGameFrame();
  canvas.focus();

  status.textContent =
    'Arrows move. B board, X exit, E enter, L look, Q quit & save. ' +
    'URL options: ?new (fresh game), ?tiles=<set> (e.g. "PC EGA", "Commodore 64").';

  const game = new Game(world, screen, { save: (w) => localSave.write(w) });
  await game.run();
  status.textContent = 'Game over. Reload to continue from the last save, or add ?new for a fresh game.';
}

start().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
