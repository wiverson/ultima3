import { describe, it, expect } from 'vitest';
import { newWorld, FakeIO } from './helpers.ts';
import { speech, transact, unlock, steal, otherCommand, fire, unlockToward, whoTransacts, transactToward } from '../src/game/interact.ts';
import { shop } from '../src/game/shops.ts';
import { cast } from '../src/game/spells.ts';
import { getChest, readyWeapon, wearArmour, stats, handEquipment } from '../src/game/actions.ts';
import { mainMenu, createCharacter, formParty } from '../src/game/menu.ts';
import { MapValue } from '../src/game/tiles.ts';
import { Location } from '../src/game/party.ts';
import { Key } from '../src/game/io.ts';
import { MapId } from '../src/data/resources.ts';
import { World } from '../src/game/world.ts';

function townWorld(): { world: World; io: FakeIO } {
  const world = newWorld(99);
  world.returnX = 46;
  world.returnY = 19;
  world.party.surfaceX = 46;
  world.party.surfaceY = 19;
  world.enterMap(MapId.FirstTown);
  world.party.location = Location.Town;
  world.current.tiles.fill(MapValue.Floor);
  world.monsters.bytes.fill(0);
  world.x = 20;
  world.y = 20;
  return { world, io: new FakeIO(world.resources) };
}

describe('talking', () => {
  it('decodes NPC dialogue from the talk table', () => {
    const world = newWorld();
    const talk = world.resources.talk.get(MapId.LordBritishCastle)!;
    expect(speech(talk, 1)).toContain('WEST');
    expect(speech(talk, 2)).toContain('COOKIE');
  });

  it('talks to a townsperson and to a merchant across a counter', async () => {
    const { world, io } = townWorld();
    const m = world.monsters;
    m.setType(0, MapValue.Jester);
    m.setTileUnder(0, MapValue.Floor);
    m.setPosition(0, 21, 20);
    m.setHp(0, 0x02); // stationary, says line 2
    world.putXYVal(MapValue.Jester, 21, 20);
    io.keys = ['1', Key.Right];
    await transact(world, io);
    expect(io.output).toContain(speech(world.current.talk, 2).slice(0, 8));

    // A counter (letter tile) with a merchant behind it, at a Y that selects the grocer.
    world.y = 17; // 17 & 7 = 1: grocer
    world.putXYVal(MapValue.LetterA, 21, 17);
    world.putXYVal(MapValue.Merchant, 22, 17);
    io.keys = ['1', Key.Right, 'N'];
    io.inputs = ['20'];
    const gold = world.member(0).gold;
    const food = world.member(0).food;
    await transact(world, io);
    expect(io.output).toContain('GROCER');
    expect(world.member(0).gold).toBe(gold - 20);
    expect(world.member(0).food).toBe(food + 20);
  });
});

describe('shops', () => {
  it('sells a weapon the class may use and buys it back', async () => {
    const { world, io } = townWorld();
    const p = world.member(1); // Roderic, a ranger
    p.gold = 500;
    world.party.surfaceX = 0; // a basic shop
    // No list; buy a mace; Escape leaves the shop (buying stays in buy mode, as in the original).
    io.keys = ['N', 'B', 'C', Key.Escape];
    await shop(world, io, 3, 1);
    expect(io.output).toContain('WEAPONS SHOP');
    expect(io.output).toContain('Here you are');
    expect(p.bytes[48 + 2]).toBe(1);
    expect(p.gold).toBe(470);
    // Sell it back.
    io.keys = ['N', 'S', 'C', Key.Escape];
    await shop(world, io, 3, 1);
    expect(io.output).toContain('Thank you');
    expect(p.bytes[48 + 2]).toBe(0);
    expect(p.gold).toBe(500);
  });

  it('the healer cures poison for 100 gold', async () => {
    const { world, io } = townWorld();
    const p = world.member(0);
    p.gold = 300;
    world.member(2).status = 'P';
    io.keys = ['1', 'Y', '3'];
    await shop(world, io, 2, 0);
    expect(world.member(2).status).toBe('G');
    expect(p.gold).toBe(200);
  });
});

describe('doors, chests and stealing', () => {
  it('unlocks a door the party walked into', async () => {
    const { world, io } = townWorld();
    world.putXYVal(MapValue.LetterI, 21, 20);
    world.member(0).bytes[38] = 1;
    io.keys = ['1'];
    await unlockToward(world, io, 1, 0);
    expect(world.getXYVal(21, 20)).toBe(MapValue.Floor);
    expect(world.member(0).keys).toBe(0);
  });

  it('shops at a counter the party walked into', async () => {
    const { world, io } = townWorld();
    world.y = 17; // 17 & 7 = 1: grocer
    world.putXYVal(MapValue.LetterA, 21, 17);
    world.putXYVal(MapValue.Merchant, 22, 17);
    io.keys = ['1', 'N'];
    io.inputs = ['10'];
    const food = world.member(0).food;
    const member = await whoTransacts(world, io);
    expect(member).toBe(0);
    await transactToward(world, io, member, 1, 0);
    expect(io.output).toContain('GROCER');
    expect(world.member(0).food).toBe(food + 10);
  });

  it('unlocks a door with a key', async () => {
    const { world, io } = townWorld();
    world.putXYVal(MapValue.LetterI, 21, 20);
    world.member(0).bytes[38] = 1;
    io.keys = [Key.Right, '1'];
    await unlock(world, io);
    expect(world.getXYVal(21, 20)).toBe(MapValue.Floor);
    expect(world.member(0).keys).toBe(0);
    expect(io.sounds).toContain('Creak');
  });

  it('opens a chest for gold and removes it', async () => {
    const { world, io } = townWorld();
    world.putXYVal(MapValue.Chest, world.x, world.y);
    world.member(0).bytes[19] = 99; // a dexterous thief always disarms the trap
    const gold = world.member(0).gold;
    io.keys = ['1'];
    await getChest(world, io, 0, 'command');
    expect(world.getXYVal(world.x, world.y)).toBe(MapValue.Floor);
    expect(world.member(0).gold).toBeGreaterThan(gold);
    expect(io.output).toContain('GOLD+');
  });

  it('a thief can steal the chest behind a counter', async () => {
    const { world, io } = townWorld();
    world.member(0).bytes[19] = 99; // a dexterous thief never fails
    world.putXYVal(MapValue.LetterA, 21, 20);
    world.putXYVal(MapValue.Chest, 22, 20);
    io.keys = ['1', Key.Right];
    await steal(world, io);
    expect(world.getXYVal(22, 20)).toBe(MapValue.Floor);
    expect(io.output).toContain('GOLD+');
  });
});

describe('equipment and stats', () => {
  it('readies a weapon only if owned and allowed', async () => {
    const { world, io } = townWorld();
    const p = world.member(0); // a thief may use a sword but not a two-handed sword
    p.bytes[55] = 1; // owns a 2-H-Swd
    io.keys = ['1', 'H'];
    await readyWeapon(world, io);
    expect(io.output).toContain('Not allowed');
    io.keys = ['1', 'B'];
    await readyWeapon(world, io);
    expect(io.output).toContain('Dagger Ready');
    io.keys = ['1', 'C'];
    await wearArmour(world, io);
    expect(io.output).toContain('Not owned');
  });

  it('hands gold between members', async () => {
    const { world, io } = townWorld();
    io.keys = ['1', '2', 'G'];
    io.inputs = ['100'];
    const a = world.member(0).gold;
    const b = world.member(1).gold;
    await handEquipment(world, io);
    expect(world.member(0).gold).toBe(a - 100);
    expect(world.member(1).gold).toBe(b + 100);
  });

  it('prints the stats screen and stops on escape', async () => {
    const { world, io } = townWorld();
    io.keys = ['1', Key.Enter, Key.Escape];
    await stats(world, io);
    expect(io.output).toContain('STR...');
    expect(io.output).toContain('H.P...');
  });
});

describe('spells', () => {
  it('a thief is not a mage; a cleric heals', async () => {
    const { world, io } = townWorld();
    io.keys = ['1'];
    await cast(world, io);
    expect(io.output).toContain('Not a mage');

    const cleric = world.member(2); // Norric, a cleric
    cleric.mana = 20;
    cleric.hitPoints = 10;
    io.keys = ['3', 'C', '3']; // Sanctu (cleric C), heal member 3
    await cast(world, io);
    expect(io.output).toContain('SANCTU');
    expect(cleric.hitPoints).toBeGreaterThan(10);
    expect(cleric.mana).toBe(10);
  });
});

describe('other commands', () => {
  it('bribes a guard away', async () => {
    const { world, io } = townWorld();
    const m = world.monsters;
    m.setType(0, MapValue.Guard);
    m.setTileUnder(0, MapValue.Floor);
    m.setPosition(0, 21, 20);
    world.putXYVal(MapValue.Guard, 21, 20);
    io.keys = ['1', Key.Right];
    io.inputs = ['BRIBE'];
    world.member(0).gold = 150;
    await otherCommand(world, io);
    expect(m.type(0)).toBe(0);
    expect(world.member(0).gold).toBe(50);
  });

  it('cannons sink a pirate ship', async () => {
    const world = newWorld(5);
    const io = new FakeIO(world.resources);
    world.current.tiles.fill(MapValue.Water);
    world.monsters.bytes.fill(0);
    world.party.shape = 0x16;
    world.x = 32;
    world.y = 32;
    const m = world.monsters;
    m.setType(0, MapValue.Pirate);
    m.setTileUnder(0, MapValue.Water);
    m.setPosition(0, 34, 32);
    world.putXYVal(MapValue.Pirate, 34, 32);
    let destroyed = false;
    for (let i = 0; i < 20 && !destroyed; i++) {
      io.keys = [Key.Right];
      await fire(world, io);
      destroyed = m.type(0) === 0;
    }
    expect(destroyed).toBe(true);
    expect(io.output).toContain('destroyed!');
    expect(world.getXYVal(34, 32)).toBe(MapValue.Water);
  });
});

describe('menus', () => {
  it('creates a character and forms a party', async () => {
    const world = new World(newWorld().resources, 3);
    const io = new FakeIO(world.resources);
    // Entry 5: name, sex F, race Elf, class Wizard, 15/10/15/10 points, OK.
    io.inputs = ['5', 'Mira', '15', '10', '15', '10'];
    io.keys = ['F', 'E', 'W', 'Y', ' '];
    await createCharacter(world, io);
    const p = world.roster.get(4);
    expect(p.name).toBe('Mira');
    expect(p.classLetter).toBe('W');
    expect(p.race).toBe('E');
    expect(p.intelligence).toBe(15);
    expect(p.hitPoints).toBe(100);

    io.inputs = ['5', '0'];
    io.keys = [' '];
    await formParty(world, io);
    expect(world.party.formed).toBe(true);
    expect(world.party.size).toBe(1);
    expect(world.party.memberSlot(0)).toBe(4);
    expect(p.inParty).toBe(true);
    expect(world.x).toBe(42);
  });

  it('refuses to journey without a party', async () => {
    const world = new World(newWorld().resources, 3);
    const io = new FakeIO(world.resources);
    let played = false;
    io.keys = ['J', ' '];
    await expect(
      mainMenu(world, io, async () => {
        played = true;
      }),
    ).rejects.toThrow('no more keys');
    expect(played).toBe(false);
    expect(io.output).toContain('(Not formed)');
  });
});
