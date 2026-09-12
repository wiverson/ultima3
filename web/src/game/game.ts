/**
 * game.ts
 *
 * The main game loop: a port of `Game()` in UltimaMain.c.
 *
 * Each iteration redraws the map, waits for a key (or times out and passes
 * the turn), dispatches the command, then runs the end-of-turn processing.
 * Because the browser cannot block, the loop is an `async` function that
 * awaits the keyboard; while it waits the renderer keeps animating.
 */

import { World } from './world.ts';
import { Location } from './party.ts';
import { MapValue } from './tiles.ts';
import { type GameIO, Key, Sound } from './io.ts';
import { endTurn, whirlpoolTick, type TurnHooks } from './turn.ts';
import { VIEW_CENTRE } from './viewport.ts';
import * as cmd from './commands.ts';

/** How long the game waits for a key before passing the turn automatically (the original: ~5 seconds). */
export const IDLE_PASS_MS = 5000;
/** The original polled the whirlpool roughly every twelfth of a second. */
const WHIRLPOOL_TICK_MS = 83;

export interface GameOptions {
  /** Called when the player presses Q. Return true if the game was saved. (`QuitSave`) */
  save?: (world: World) => boolean;
}

export class Game {
  private readonly hooks: TurnHooks;

  constructor(
    public readonly world: World,
    public readonly io: GameIO,
    private readonly options: GameOptions = {},
  ) {
    this.hooks = {
      attack: (i) => this.attack(i),
      bombTrap: () => this.bombTrap(),
      showBall: (vx, vy, background) => this.showBall(vx, vy, background),
      goWhirlpool: () => this.goWhirlpool(),
      dungeonTurn: async () => {
        /* dungeons are a later phase */
      },
    };
  }

  /** Run until `world.done` is set (Quit). Mirrors the `while (!gDone)` loop in `Game()`. */
  async run(): Promise<void> {
    const { world, io } = this;
    io.updateStats(true);
    io.showWind();
    io.showMoons();

    while (!world.done) {
      io.redrawMap();
      io.updateStats();
      await this.checkAllDead();
      if (world.done) return;
      io.prompt();

      const key = await this.waitForCommand();
      if (world.done) return;
      await this.dispatch(key);
      await endTurn(world, io, this.hooks);
    }
  }

  /**
   * Wait for a key while the whirlpool keeps moving. After IDLE_PASS_MS with
   * no input the turn passes by itself, as on the Apple II.
   */
  private async waitForCommand(): Promise<string> {
    const deadline = performance.now() + IDLE_PASS_MS;
    for (;;) {
      await whirlpoolTick(this.world, this.io, this.hooks);
      const remaining = deadline - performance.now();
      if (remaining <= 0) return Key.Space;
      const key = await this.io.waitKeyOrTimeout(Math.min(WHIRLPOOL_TICK_MS, remaining));
      if (key !== null) return key;
    }
  }

  /** Mirrors the key switch in `Game()` and `LetterCommand()`. */
  async dispatch(key: string): Promise<void> {
    const { world, io } = this;
    const moveName = cmd.moveForKey(key);
    if (moveName) {
      await cmd.move(world, io, moveName);
      return;
    }
    switch (key.toUpperCase()) {
      case ' ':
        cmd.pass(io);
        break;
      case 'A':
        cmd.notYetPorted(io, 'Attack');
        break;
      case 'B':
        cmd.board(world, io);
        break;
      case 'C':
        cmd.notYetPorted(io, 'Cast');
        break;
      case 'D':
        cmd.notYetPorted(io, 'Descend');
        break;
      case 'E':
        cmd.enter(world, io);
        break;
      case 'F':
        cmd.notYetPorted(io, 'Fire');
        break;
      case 'G':
        cmd.notYetPorted(io, 'Get chest');
        break;
      case 'H':
        cmd.notYetPorted(io, 'Hand equipment');
        break;
      case 'I':
        io.printMessage(64); // "Ignite torch"
        cmd.notHere(io);
        break;
      case 'J':
        cmd.notYetPorted(io, 'Join gold');
        break;
      case 'K':
        io.printMessage(cmd.Msg.Klimb);
        cmd.what2(io);
        break;
      case 'L':
        await cmd.look(world, io);
        break;
      case 'M':
        cmd.notYetPorted(io, 'Modify order');
        break;
      case 'N':
        cmd.notYetPorted(io, 'Negate time');
        break;
      case 'O':
        cmd.notYetPorted(io, 'Other command');
        break;
      case 'P':
        cmd.notYetPorted(io, 'Peer at gem');
        break;
      case 'Q': {
        // The original's `QuitSave()` wrote the party, roster and Sosaria back to disk.
        const saved = this.options.save?.(world) ?? false;
        io.print(saved ? 'Quit & save\n' : 'Quit\n(not saved)\n');
        world.done = true;
        break;
      }
      case 'R':
        cmd.notYetPorted(io, 'Ready weapon');
        break;
      case 'S':
        cmd.notYetPorted(io, 'Steal');
        break;
      case 'T':
        cmd.notYetPorted(io, 'Transact');
        break;
      case 'U':
        cmd.notYetPorted(io, 'Unlock');
        break;
      case 'V':
        cmd.notYetPorted(io, 'Volume');
        break;
      case 'W':
        cmd.notYetPorted(io, 'Wear armour');
        break;
      case 'X':
        cmd.exit(world, io);
        break;
      case 'Y':
        cmd.notYetPorted(io, 'Yell');
        break;
      case 'Z':
        cmd.notYetPorted(io, 'Ztats');
        break;
      default:
        // Unknown keys are ignored but still cost a turn, as in the original.
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Hooks called from the turn and monster code
  // -------------------------------------------------------------------------

  /**
   * A monster reached the party. Combat is a later phase; until then the
   * monster is dispersed so the game stays playable. (`AttackCode`)
   */
  private async attack(monsterIndex: number): Promise<void> {
    const { world, io } = this;
    const m = world.monsters;
    const name = world.resources.strings.TilesPlural[m.type(monsterIndex) >> 2] ?? 'Monsters';
    io.print(`\n${name} attack!\n(combat not yet ported)\n`);
    io.sound(Sound.Attack);
    world.putXYVal(m.tileUnder(monsterIndex), m.x(monsterIndex), m.y(monsterIndex));
    m.clear(monsterIndex);
    io.redrawMap();
  }

  /** A fireball or trap hit the party. (`BombTrap`, simplified: every member takes damage.) */
  private async bombTrap(): Promise<void> {
    const { world, io } = this;
    io.sound(Sound.Hit);
    for (let m = 0; m < 4; m++) {
      if (!world.memberAlive(m)) continue;
      const p = world.member(m);
      if (p.subtractHitPoints(world.rng.range(1, 20))) io.sound(p.sex === 'F' ? Sound.DeathFemale : Sound.DeathMale);
      await io.flashMember(m);
    }
    io.updateStats();
  }

  /** Draw a fireball at viewport cell (vx, vy) for one frame. */
  private async showBall(vx: number, vy: number, _background: number): Promise<void> {
    const { world, io } = this;
    const x = world.constrain(world.x - VIEW_CENTRE + vx);
    const y = world.constrain(world.y - VIEW_CENTRE + vy);
    const saved = world.getXYVal(x, y);
    world.putXYVal(MapValue.FireBall, x, y);
    io.redrawMap();
    await io.pause(80);
    world.putXYVal(saved, x, y);
    io.redrawMap();
  }

  /**
   * The whirlpool caught the party. On Sosaria it carries them to Ambrosia;
   * on Ambrosia it brings them home. Mirrors `GoWhirlPool()`.
   */
  private async goWhirlpool(): Promise<void> {
    const { world, io } = this;
    world.party.shape = cmd.PartyShape.Whirlpool;
    io.redrawMap();
    io.printMessage(256);
    io.sound(Sound.Sink);
    await io.pause(3000);

    if (world.onSurface) {
      world.party.surfaceX = world.x;
      world.party.surfaceY = world.y;
      world.putXYVal(MapValue.Water, world.x, world.y);
      world.whirlpool.x = 2;
      world.whirlpool.y = 0x3e;
      world.party.shape = cmd.PartyShape.Frigate;
      io.clearTiles();
      io.printMessage(257);
      world.enterMap(421);
      await io.pause(3000);
      world.party.shape = cmd.PartyShape.OnFoot;
      world.x = 32;
      world.y = 54;
      world.party.location = Location.Ambrosia;
      io.printMessage(258);
    } else if (world.party.location === Location.Ambrosia) {
      world.returnToSurface();
      io.printMessage(114);
      io.clearTiles();
      io.printMessage(115);
      world.x = world.party.surfaceX;
      world.y = world.party.surfaceY;
      world.party.location = Location.Sosaria;
      world.party.shape = cmd.PartyShape.Frigate;
    } else {
      // In a town or castle: dropped on a random water square.
      let value = 0xff;
      while (value !== MapValue.Water) {
        world.x = world.rng.range(0, world.mapSize - 1);
        world.y = world.rng.range(0, world.mapSize - 1);
        value = world.getXYVal(world.x, world.y);
      }
    }
    io.redrawMap();
    io.prompt();
  }

  /**
   * Mirrors `CheckAllDead()`: if nobody is alive, announce it and resurrect
   * the party at Lord British's castle with starting equipment. The original
   * offered a dialog to stay dead; this port always resurrects.
   */
  private async checkAllDead(): Promise<void> {
    const { world, io } = this;
    if ([0, 1, 2, 3].some((m) => world.memberAlive(m))) return;

    io.printMessage(109); // ALL PLAYERS OUT!
    io.flushKeys();
    await io.waitKey();
    io.printMessage(249); // Resurrecting!
    io.sound(Sound.BigDeath);
    await io.pause(1500);

    for (let m = 0; m < 4; m++) {
      if (world.party.memberSlot(m) < 0) continue;
      const p = world.member(m);
      p.bytes.fill(0, 35, 64);
      p.torches = 0;
      if (p.bytes[32] < 1) p.bytes[32] = 1; // some food
      p.gold = 150;
      p.bytes[41] = 1; // cloth armour
      p.bytes[40] = 1; //   in use
      p.bytes[49] = 1; // dagger
      p.bytes[48] = 1; //   in use
      p.status = 'G';
      p.hitPoints = 100;
    }
    world.party.location = Location.Sosaria;
    world.party.shape = cmd.PartyShape.OnFoot;
    world.x = world.returnX = world.party.surfaceX = 42;
    world.y = world.returnY = world.party.surfaceY = 20;
    world.resetSosaria();
    world.timeNegate = 0;
    io.updateStats(true);
    io.print('\n\n\n\n\n\n\n\n');
    io.sound(Sound.BigDeath);
  }
}
