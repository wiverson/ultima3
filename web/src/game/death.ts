/**
 * death.ts
 *
 * What happens when the whole party is dead. A port of `CheckAllDead()`
 * from UltimaMain.c. The original offered a dialog to stay dead; this port
 * always resurrects the party at Lord British's castle with starting
 * equipment, as the Apple II did.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { type GameIO, Sound, Music } from './io.ts';

const Msg = {
  AllOut: 109,
  Resurrecting: 249,
};

/**
 * If nobody in the party is alive, announce it, wait for a key, and rebuild
 * the party on Sosaria. Sets `world.resurrecting` so that combat and the
 * dungeon loops unwind back to the main loop.
 */
export async function checkAllDead(world: World, io: GameIO): Promise<void> {
  if ([0, 1, 2, 3].some((m) => world.memberAlive(m))) return;

  io.printMessage(Msg.AllOut);
  world.music = Music.None;
  io.music(Music.None);
  io.flushKeys();
  await io.waitKey();
  io.printMessage(Msg.Resurrecting);
  io.sound(Sound.BigDeath);
  await io.pause(1500);

  for (let m = 0; m < 4; m++) {
    if (world.party.memberSlot(m) < 0) continue;
    const p = world.member(m);
    p.bytes.fill(0, 35, 64); // gold, gems, keys, powders, armour, weapons
    p.torches = 0;
    if (p.bytes[32] < 1) p.bytes[32] = 1; // at least 100 food
    p.gold = 150;
    p.bytes[41] = 1; // cloth armour
    p.bytes[40] = 1; //   in use
    p.bytes[49] = 1; // dagger
    p.bytes[48] = 1; //   in use
    p.status = 'G';
    p.hitPoints = 100;
  }
  world.combat = null;
  world.party.location = Location.Sosaria;
  world.party.shape = 0x7e;
  world.x = world.returnX = world.party.surfaceX = 42;
  world.y = world.returnY = world.party.surfaceY = 20;
  world.resetSosaria();
  world.timeNegate = 0;
  world.music = Music.Sosaria;
  io.music(Music.Sosaria);
  io.updateStats(true);
  io.print('\n\n\n\n\n\n\n\n');
  io.sound(Sound.BigDeath);
  world.resurrecting = true;
}
