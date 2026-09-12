# Ultima III in the browser

A TypeScript port of LairWare's Macintosh remake of Ultima III (the C sources
in `../Sources`). It renders with plain Canvas 2D, plays sound with Web Audio,
and needs no game engine.

## Running it

```sh
cd web
npm install
npm run extract   # converts ../Resources into public/data and public/graphics
npm run dev       # http://localhost:5173
npm test          # unit tests (Vitest, run in Node)
npm run build     # typecheck + production build into dist/
```

`npm run extract` only needs to run again if the original resources change.
Its output is committed so the game runs straight after `npm install`.

Keys: arrow keys or the numeric keypad move (diagonals on 1/3/7/9),
`B` board, `X` exit, `E` enter, `L` look, `Q` quit and save.
URL options: `?new` starts a fresh game; `?tiles=PC EGA` (or any set in
`public/graphics`) changes the graphics.

## Status

Done in this first slice:

- Resource extraction from the Mac resource fork and plist string tables.
- Overworld: walking, wrap-around, line of sight, horse and frigate, wind,
  moongates and moon phases, the whirlpool (including the trip to Ambrosia),
  lava and forcefields, food and poison, natural healing, monster spawning,
  monster movement and pursuit, pirates and dragons shooting.
- Towns and castles: entering, walking about, NPC movement, doors and signs,
  leaving by the edge.
- Character stats panel, scrolling message area, sound effects, save/restore.

Not yet ported (the key prints "Not yet ported"):

- Combat, spells, Attack/Cast/Fire.
- Transact (shops, talking to NPCs), Steal, Unlock, Get chest, Peer at gem.
- Dungeons.
- Ztats, Ready, Wear, Hand, Join gold, Modify order, Negate time, Other.
- Title screen, attract mode, character creation and party organisation.
- Music. The original tracks are QuickTime Music Architecture files
  (`../Resources/Music/*.mov`), which browsers cannot play; they need a
  one-time conversion to MIDI and then OGG/MP3.

## How the code is organised

The port keeps the original module boundaries and function names so that
the C source can be read alongside it. Every function that ports a C routine
names it in its doc comment.

```
tools/extract-resources.ts   Mac resource fork + plist -> public/data/resources.json
src/data/resources.ts        typed access to the extracted data

src/game/   pure game logic, no DOM, unit tested
  tiles.ts        the three tile numbering schemes (map value, shape, tile index)
  player.ts       64-byte character record, with the byte layout documented
  party.ts        64-byte party record
  monsterTable.ts 256-byte monster/NPC table
  world.ts        map, monsters, position, moons, wind, timers; map loading
  viewport.ts     DrawMap: the 11x11 window with line of sight and overlays
  monsters.ts     SpawnMonster / MoveMonsters
  turn.ts         end-of-turn processing (the C code's Routine6E35)
  commands.ts     the player's commands (North, Board, Enter, Look ...)
  game.ts         the main loop (Game) and the hooks for combat and traps
  io.ts           the GameIO interface: how logic talks to screen/keys/sound
  save.ts         save-game serialisation
  random.ts       seedable RNG (RandNum)

src/ui/     browser only
  graphics.ts     tile sheet, mask, font and UI sheet; tile animation
  screen.ts       Canvas renderer and the GameIO implementation
  input.ts        keyboard as an awaitable queue
  sound.ts        Web Audio effects
src/main.ts       bootstrap
```

### The blocking-input problem

The C code waits for keys deep inside call stacks (`WaitKeyMouse()` spins on
the Mac event loop). A browser cannot block, so every routine that may wait
is `async` and awaits `io.waitKey()`. The control flow is otherwise the same
as the original, which keeps the port easy to compare against the C.

### Data formats

The byte layouts of the character record, party record, monster table and
map resources are documented at the top of `player.ts`, `party.ts`,
`monsterTable.ts` and `resources.ts`. The tile numbering (map value, shape,
tile index) is explained in `tiles.ts`.

### Deliberate differences from the C source

- `monsters.ts` `heading()` uses true 8-bit wrap-around, as the Apple II
  did. The C port tested for negative values first, which sent monsters the
  long way round when the party was far to their west.
- Combat, when a monster reaches the party, disperses the monster instead.
  This placeholder is in `Game.attack()` and goes away when combat is ported.
- Resurrection after a party wipe is automatic; the original showed a dialog.
