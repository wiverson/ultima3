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

There are two input modes, keyboard and controller, chosen in the game's
Settings menu (Escape; a gamepad button press also switches to controller
mode). The Controls section below lists the keys and buttons; the same
text is in the game under Settings > Help. `?new` on the URL starts a
fresh game instead of resuming the last one from the browser's storage.

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
  ztats, death and resurrection, save and resume.
- Music: the original QuickTime music files are decoded and played on a
  small Web Audio synthesizer (`src/ui/music.ts`).
- Auto-combat, a LairWare addition: see Settings below.

Left out on purpose, all additions LairWare made for the Mac rather than
parts of the game: the animated intro and attract mode, auto-heal, the
"modern" stats dialog, the Diorama map and random map generator,
text-to-speech, mouse control, and the Mac dialogs (the Apple II text flow
is used instead).

## Controls

Escape opens the Settings menu anywhere (on the title screen it is the
third entry under Options; in controller mode it is the last entry of the
command menu). Settings holds the input mode, the tile set, diagonal moves,
auto combat, sound effects, music, and Help, which shows these controls in
the game. Every setting is remembered by the browser.

### Keyboard mode (the Apple II commands)

    Arrows       walk; move in combat      Space   pass a turn
    1 3 7 9      walk diagonally (only with diagonal moves on)

    A attack     B board      C cast      E enter     F fire
    G get chest  H hand       I ignite    L look      M modify order
    N negate     O other      P peer gem  Q quit/save R ready weapon
    S steal      T transact   U unlock    V volume    W wear armour
    X exit craft Y yell       Z ztats

    O and Y are the same prompt: a member and a word (SEARCH, BRIBE,
    PRAY, EVOCARE, INSERT, DIG, PAXUM, SCREAM).

    Combat:   arrows move (into a monster attacks), A attack in a
              direction, C N R Z, Escape turns auto combat off
    V toggles sound effects, as Settings does; the controller menus
    leave it to Settings
    Dungeons: up/down advance or retreat, left/right turn, I K D
              ignite, klimb, descend

Prompts for "whom" take a member number 1-4; a direction is an arrow key.
Q on the surface saves the game in this browser; it resumes on the next
visit. The game also saves itself when the journey starts and at every
town, castle and dungeon door, going in and coming out, and prints
"(saved)" under the door message when it does. `?new` on the URL starts a
fresh game.

### Controller mode (in the spirit of the NES version)

    D-pad   move, or move the cursor in a menu
    A       open the command menu; choose
    B       cancel, or pass a turn
    X       ztats
    Y       look; attack in combat; ignite a torch in dungeons

Keyboard stand-ins: WASD or arrows for the d-pad, Enter or Z for A, Escape
or X for B, C for X, V for Y. Pressing a gamepad button switches to
controller mode. The command menu lists the commands the surroundings call
for first (Enter on a town, Board on a horse, Get on a chest, Attack
beside a monster), leaves out commands that make no sense where you stand
(no craft to board, no chest to get), and greys out ones with nothing on
hand (no gem to peer through, no torch to light, no caster left alive).
Numbers use a spinner and names an on-screen keyboard.

The game pauses its idle timers, including the combat turn timer, while
the browser window is not focused, and shows PAUSED in the middle of the
screen until focus returns. Everything, loading and error messages
included, is drawn on the canvas; the page has nothing else on it.

### Cheats

On the Help screen, Y (V on the keyboard in controller mode) opens a
cheat menu: full restore (everyone healed and alive), go home (back to
Lord British's gate, leaving any town, castle or dungeon), exit dungeon,
100 gold, and ten gems, five keys or five torches for the leader. None of it existed in the
original; it is there for testing and for anyone who wants it.

## Differences from the original

Quality-of-life changes this port makes on top of the Apple II game. The
records written are still the Apple II's, so nothing here changes what a
save contains except the pooled gold and food.

- **Bumping into things** does what you would have typed next: a
  townsperson is talked to, a shop counter opens the shop, a locked door
  beside you asks whose key to use, and a monster, on the surface or in
  combat, is attacked.
- **Transact** asks the direction first and "who" only when it matters:
  Lord British, and the shops that hand something to a member.
- **Gold and food are pooled** for the whole party (the Apple II kept them
  per member, 0..9999 each). The pool lives in spare bytes of the party
  record and shows on the top border either side of the moons. Join gold
  is gone and Hand no longer moves food or gold. Members eat a tenth of a
  ration a turn from the pool and go hungry together when it is empty; the
  Apple II's food-borrow quirk went with the per-member counters. Forming
  a party pools the members' purses; dispersing shares the pool out again.
- **Character boxes** are two rows: the name, coloured by state (green
  poisoned, light grey dead, dark grey ashes, blue when Lord British would
  raise the member, white otherwise), then hit points over max, yellow
  under a quarter and red under a tenth, and mana (none for fighters,
  thieves and barbarians). The message area gained four rows.
- **The party on foot**, with the Standard tiles, is drawn as its members.
  On the overworld they are at half size in a 2x2 grid in marching order,
  to sell the scale of the map. In towns and castles the leader stands at
  full size and the others follow in a line on the squares the leader
  walked through, as the NES version did; the line is only a drawing, the
  party's position is still one square, and townspeople walk over it. A
  poisoned member is all green, a dead one or ashes is not drawn. On a
  horse or frigate, and in the other tile sets, the Apple II's single
  figure is used.
- **Hits** with the Standard tiles show a three-frame red burst on the
  16-pixel grid (a small disc, a larger one, then a ring) instead of the
  "HIT" tile; the other tile sets keep their HIT tile.
- **Combat marker**: the member whose turn it is gets a rounded outline,
  two game pixels wide, fading from white to grey over the four seconds
  before the turn passes by itself. The Apple II blinked the figure.
- **Diagonal moves** (off by default): as on the Apple II, the party cannot
  move, attack or fire diagonally while monsters always could. On gives
  the Mac version's party diagonals; the lava either side of Exodus'
  castle then becomes mountains as the Mac's `BlockExodus()` did, so the
  castle is reached by sea only.
- **Auto combat** (off by default), a LairWare addition: the party fights
  by itself. As in the Mac version the AI decides a member's turn and
  "types" it: it queues the keys a player would press (`GameIO.queueKeys`)
  and the ordinary combat prompts read them. Escape during a fight turns
  it off, as Cmd-. did. Four departures from the Mac's planner: a member
  closing to melee follows a breadth-first path to the nearest square
  they can strike from, round comrades and walls (the Mac headed at a
  guess of the monster's next step and sidestepped blindly when blocked,
  which left members milling about); "nearly dead" is a quarter of
  maximum hit points, at most 50, not a flat 50; a wounded member who
  cannot get away fights back instead of passing; and Sanctu is cast only
  when someone is under 60% and down at least 20, not at a flat 75. With diagonals on, lining up a ranged attacker steps onto the
  diagonal square checked; the C code stepped toward the monster instead.
  A monster's square counts as occupied, which the original did not check.
- **Menus for the title and party screens** in both input modes (the
  Apple II typed entry numbers and attribute values): the roster is a
  pick list, the party a multi-select list in marching order, attributes a
  screen where left and right adjust each value until all 50 points are
  spent, and a random name is offered from a stock list (`names.ts`).
  Terminate asks for confirmation.
- **Controller mode** with pop-up menus, and a command menu ordered by
  what the surroundings call for (`context.ts`).
- **Other and Yell are one command.** The Apple II's Yell was Other under
  another name, with one difference: EVOCARE parted the great serpent only
  when yelled, and said "No effect" when typed at Other. EVOCARE now works
  from Other too, so the controller menus list Other alone; Y still works
  on the keyboard.
- **Daggers** are thrown only when the member has a spare; with a single
  dagger an attack at a distant foe just misses. The Apple II let a new
  character throw away their only weapon.
- **Spell menus** name spells by what they do (Magic bolt, Heal, Up a
  level) with the spell-book name, cost and effect on the hint line
  beneath; the Apple II showed only the book names the manual explained.
- **Member pickers** ("Who?") colour each name by state the same way. A
  member brought back to life during a fight is placed on the nearest open
  square to where they fell.
- **A party wipe** offers a choice: try again from the last save (the
  autosave at the last door, with everything since undone) or flee to Lord
  British as the Apple II did, resurrected with daggers, cloth, 150 gold a
  head and a little food. The overworld is deliberately not autosaved
  between doors, so a long trek keeps its risk.
- **`heading()`** in `monsters.ts` uses true 8-bit wrap-around, as the
  Apple II did. The C port tested for negative values first, which sent
  monsters the long way round when the party was far to their west.
- **Appearance**: the classic bitmap-font layout is used throughout; any of
  the twelve tile sets (with their fonts and borders) can be chosen in
  Settings, Standard by default.

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
  menu.ts         title screen, character creation, party organisation (menus)
  names.ts        stock of names for the "random name" option
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

### Testing

`npm test` runs 68 Vitest tests against the real extracted data: records,
viewport line of sight, movement, monsters, turn processing, combat,
spells, shops, dialogue, doors and chests, dungeons, menus, save
round-trips and the music decoder. The renderer is exercised in headless
Chromium (Playwright is preinstalled in the development environment) by
driving the keyboard and taking screenshots.
