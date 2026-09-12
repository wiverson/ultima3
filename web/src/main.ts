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
  const keyboard = new Keyboard();
  // Audio may only start after a user gesture; the first key press is one.
  window.addEventListener('keydown', () => sounds.unlock(), { once: true });

  const screen = new Screen(canvas, gfx, images, keyboard, sounds, world);
  canvas.focus();

  status.textContent =
    'Menu: J journey onward, O organize. In play: arrows move, letters are commands (A attack, C cast, ' +
    'E enter, T transact, Z stats, Q quit & save). URL options: ?new (fresh game), ?tiles=<set> (e.g. "PC EGA").';

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
