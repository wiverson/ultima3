# Ultima III in the browser

A TypeScript port of LairWare's Macintosh remake of Ultima III (the C sources
in `../Sources`). It renders with plain Canvas 2D, plays sound and music with
Web Audio, and needs no game engine.

## Running it

```sh
cd web
npm install
npm run extract   # converts ../Resources and ../Images into public/
npm run dev       # http://localhost:5173
npm test          # unit tests (Vitest, run in Node)
npm run build     # typecheck + production build into dist/
```

`npm run extract` only needs to run again if the original resources change.
Its output is committed so the game runs straight after `npm install`.

There are two input modes, chosen with the selector under the game (a
gamepad button press also switches to controller mode):

- **Keyboard**: the Apple II commands below, exactly as the original.
- **Controller**: d-pad movement and pop-up menus, in the spirit of the NES
  version. A opens the command menu or confirms, B cancels or passes the
  turn, X shows Ztats, Y looks (attacks in combat). Prompts for a member,
  a direction, a spell, an item, a shop choice, a number or a word all
  become menus. A real gamepad works through the Gamepad API; on a keyboard
  WASD or the arrows are the d-pad and Enter/Escape/Z/X/C/V are A/B/X/Y.

In either mode, walking into a townsperson talks to them (a convenience this
port adds; the original needed T, a member and a direction, by which time
the person had often wandered off).

The title menu offers `J` (journey onward) and `O` (organize a party: create,
form, disperse, terminate). In play the keys are the Apple II ones: arrow
keys or the numeric keypad move, and every letter is a command:

    A attack     B board      C cast       D descend    E enter
    F fire       G get chest  H hand       I ignite     J join gold
    K klimb      L look       M modify     N negate     O other
    P peer gem   Q quit/save  R ready      S steal      T transact
    U unlock     V volume     W wear       X exit       Y yell
    Z ztats      space passes

URL options: `?new` starts a fresh game (the last game is otherwise
resumed from the browser's storage), `?tiles=PC EGA` (or any set in
`public/graphics`) changes the graphics, `?music=0` silences the music.

## What is ported

Everything the Apple II game had:

- Sosaria and Ambrosia: walking, wrap-around, line of sight, horse and
  frigate, wind, moongates and moon phases, the whirlpool, lava and
  forcefields, food, poison, healing, wandering monsters, pirates and
  dragons shooting, the Exodus castle traps.
- Towns and castles: NPCs and their dialogue, guards, doors and keys,
  signs, the eight shop types (pub, grocer, healer, weapons, armour,
  guild, oracle, horses), stealing, bribing, Lord British raising levels.
- Combat on the terrain arenas: melee, thrown daggers, bows and slings,
  monster movement, breath attacks, monster spells, thieves pilfering,
  poison, experience.
- All 35 spells, including the three post-Exodus wizard spells.
- Dungeons: first-person view, ladders, torches, chests and traps,
  fountains, the Time Lord, marks, gremlins, misty writing, random
  encounters.
- The shrines of Ambrosia, the cards and marks, the exotics, EVOCARE, the
  four cards in Exodus and the ending.
- Party management: creation, forming, marching order, handing equipment,
  joining gold, ztats, death and resurrection, save and resume.
- Music: the original QuickTime music files are decoded and played on a
  small Web Audio synthesizer (`src/ui/music.ts`).
- Classic moves (ticked by default): the party cannot move, attack or fire
  diagonally, as on the Apple II, while monsters always could. Untick it
  for the Mac version's party diagonals; the land beside Exodus' castle
  changes to match (see below).
- Walking into things does what you would have typed next, a convenience
  this port adds: a townsperson is talked to, a shop counter opens the
  shop (after "Who will Transact"), a locked door beside you asks whose
  key to use, and a monster, on the surface or in combat, is attacked.
- In controller mode the command menu puts the commands the surroundings
  call for at the top (`src/game/context.ts`): Enter on a town, Board on a
  horse, Klimb on a ladder, Attack beside a monster, and so on.
- Auto-combat (a LairWare addition): tick "Auto combat" above the screen
  and the party fights by itself. As in the Mac version the AI decides a
  member's turn and "types" it: it queues the keys a player would press
  (`GameIO.queueKeys`), and the ordinary combat prompts read them. Escape
  during a fight turns it off, as Cmd-. did.

Left out on purpose, all additions LairWare made for the Mac rather than
parts of the game: the animated intro and attract mode, auto-heal, the
"modern" stats dialog, the Diorama map and random map generator,
text-to-speech, mouse control, and the Mac dialogs (the Apple II text flow
is used instead).

## How the code is organised

The port keeps the original module boundaries and function names so that
the C source can be read alongside it. Every function that ports a C routine
names it in its doc comment.

```
tools/extract-resources.ts   Mac resource fork + plists + images -> public/
src/data/resources.ts        typed access to the extracted data

src/game/   pure game logic, no DOM, unit tested
  tiles.ts        the three tile numbering schemes (map value, shape, tile index)
  player.ts       64-byte character record, with the byte layout documented
  party.ts        64-byte party record
  monsterTable.ts 256-byte monster/NPC table
  world.ts        map, monsters, position, moons, wind, dungeon and combat state
  viewport.ts     DrawMap: the 11x11 window with line of sight and overlays
  monsters.ts     SpawnMonster / MoveMonsters
  turn.ts         end-of-turn processing (the C code's Routine6E35)
  commands.ts     movement and the world commands (Board, Enter, Look ...)
  actions.ts      the party's own records (Get, Hand, Ready, Wear, Ztats ...)
  interact.ts     other creatures (Transact, Attack, Fire, Steal, Unlock, Other)
  shops.ts        the eight shops
  context.ts      which commands fit the surroundings (controller menu order)
  combat.ts       tactical combat
  autocombat.ts   the auto-combat planner (returns the keys to press)
  spells.ts       Cast and the spell effects
  dungeon.ts      the dungeon loop and what is visible in first person
  death.ts        party wipe and resurrection
  menu.ts         title screen and party organisation
  game.ts         the main loop (Game) and command dispatch
  io.ts           the GameIO interface: how logic talks to screen/keys/sound
  save.ts         save-game serialisation
  random.ts       seedable RNG (RandNum)

src/ui/     browser only
  graphics.ts     tile sheet, mask, font and UI sheet; tile animation
  screen.ts       Canvas renderer and the GameIO implementation
  dungeonView.ts  the first-person dungeon renderer
  input.ts        keyboard as an awaitable queue
  menus.ts        controller mode: menu windows, command lists, gamepad reader
  sound.ts        Web Audio effects
  music.ts        QuickTime music decoder and synthesizer
src/main.ts       bootstrap
```

### Semantic prompts

Game logic never reads raw keys for a decision. It asks the `GameIO` for a
*member*, a *direction*, an *option* from a list, a *number* or a *word*
(`chooseMember`, `chooseDirection`, `chooseOption`, `inputText`, and
`waitCommand` for the top-level command). The keyboard implementation
answers each the way the Apple II did; the controller implementation
(`ui/menus.ts` and the Screen) answers with a menu window. Tests use a fake
that answers from a key queue.

### The blocking-input problem

The C code waits for keys deep inside call stacks (`WaitKeyMouse()` spins on
the Mac event loop). A browser cannot block, so every routine that may wait
is `async` and awaits `io.waitKey()`. The control flow is otherwise the same
as the original, which keeps the port easy to compare against the C.

### Data formats

The byte layouts of the character record, party record, monster table,
combat arenas, map and dungeon resources are documented at the top of
`player.ts`, `party.ts`, `monsterTable.ts`, `combat.ts`, `world.ts` and
`resources.ts`. The tile numbering (map value, shape, tile index) is
explained in `tiles.ts`, and the music event format in `ui/music.ts`.

### Deliberate differences from the C source

- `monsters.ts` `heading()` uses true 8-bit wrap-around, as the Apple II
  did. The C port tested for negative values first, which sent monsters the
  long way round when the party was far to their west.
- Resurrection after a party wipe is automatic; the original showed a dialog.
- The Mac's "no diagonals" preference is the "Classic moves" checkbox,
  on by default. With it off, the lava either side of Exodus' castle
  becomes mountains as on the Mac (`blockExodusApproach`), so the castle
  is reached by sea only.
- When auto-combat lines up a ranged attacker with diagonals on, it steps
  onto the diagonal square it checked; the C code stepped toward the
  monster instead.
- The Mac version's "modern" appearance (portraits, bars, proportional
  text) is not reproduced; the classic bitmap-font layout is used throughout.

### Testing

`npm test` runs 68 Vitest tests against the real extracted data: records,
viewport line of sight, movement, monsters, turn processing, combat,
spells, shops, dialogue, doors and chests, dungeons, menus, save
round-trips and the music decoder. The renderer is exercised in headless
Chromium (Playwright is preinstalled in the development environment) by
driving the keyboard and taking screenshots.
