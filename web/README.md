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
command menu). Settings holds the input mode, the tile set,
auto combat, poison kills, starvation, balanced XP, sound effects, music, and
Help, which shows these controls in the game in a box over the map. J (Journal
in the controller menu) opens the quest journal the same way; neither
takes a turn. Every setting is remembered by the browser.

### Keyboard mode (the Apple II commands)

    Arrows       walk; move in combat      Space   pass a turn
    Escape       settings                  J       journal

    A attack     B board      C cast      E enter     F fire
    G get chest  I ignite     L look      M modify    N negate
    O other      P peer gem   Q quit/save R ready     S steal
    T transact   U unlock     V volume    W wear      X exit craft
    Y yell       Z ztats

    O and Y are the same prompt: a member and a word (SEARCH, BRIBE,
    PRAY, EVOCARE, INSERT, DIG, PAXUM, SCREAM).

    Combat:   arrows move (into a monster attacks), A attack in a
              direction, C N R Z, Escape turns auto combat off
    V toggles sound effects, as Settings does; the controller menus
    leave it to Settings
    Dungeons: up/down advance or retreat, left/right turn, I K D
              ignite, klimb, descend, L cycle the auto-map

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

On the Help pages, Y (V on the keyboard in controller mode) opens a
cheat menu: full restore (everyone healed and alive), go home (back to
Lord British's gate, leaving any town, castle or dungeon), exit dungeon,
100 gold or 100 food for the party, and ten gems, five keys or five
torches for the leader. None of it existed in the original; it is there
for testing and for anyone who wants it.

## Differences from the original

Quality-of-life changes this port makes on top of the Apple II game. The
records written are still the Apple II's, so nothing here changes what a
save contains except the pooled gold and food.

- **Bumping into things** does what you would have typed next: a
  townsperson is talked to, a shop counter opens the shop, a locked door
  beside you asks whose key to use, and a monster, on the surface or in
  combat, is attacked.
- **Transact** asks the direction first and "who" only when it matters:
  the shops that hand something to a member, and Lord British, whose
  prompt lists only the members due a level (the blue names) when any
  are, whether you Transact or walk into him.
  The raise adds the hundred hit points as well as the room for them; the
  Apple II raised only the maximum.
- **Gold and food are pooled** for the whole party (the Apple II kept them
  per member, 0..9999 each). The pool lives in spare bytes of the party
  record and shows on the top border either side of the moons. Join gold
  is gone. Members eat a tenth of a
  ration a turn from the pool and go hungry together when it is empty; the
  Apple II's food-borrow quirk went with the per-member counters. Forming
  a party pools the members' purses; dispersing shares the pool out again.
- **Weapons and armour are pooled** as well: the party carries one bag
  (spare bytes of the party record again), and a member's record keeps
  only what they have readied and worn. Ready and Wear draw from the bag
  and return the old item to it, so one sword cannot arm two members;
  the lists mark the item in use and grey what the class may not use.
  Shops still ask who is at the counter: the member's readied weapon or
  worn armour is announced, stock they cannot use is greyed but still for
  sale, and after a purchase they can use, the shop offers to ready or
  wear it there and then. Selling takes from the bag only. Ztats lists the
  bag on every member's page, under the member's race and class, which
  the character boxes no longer show. Chest finds, dug exotics and thrown daggers
  come and go from the bag; a pilfering thief empties one kind from it.
  Forming a party pools the members' bags (each keeps what is in hand);
  dispersing deals the bag out, to members who can use each item first.
  The Hand command, which moved gear between members, is gone.
- **Character boxes** are two rows: the name, coloured by state (green
  poisoned, light grey dead, dark grey ashes, blue when Lord British would
  raise the member, white otherwise), then hit points over max, yellow
  under a quarter and red under a tenth, and mana (none for fighters,
  thieves and barbarians). A dead member's or ashes' whole box takes the
  name's grey. The message area gained four rows.
- **The party on foot** is drawn as its members in two ways. With the
  Standard tiles, on the overworld they are at half size in a 2x2 grid in
  marching order, to sell the scale of the map. In towns and castles with
  the Standard tiles, and everywhere with the Nintendo tiles, the leader
  stands at full size and the others follow in a line on the squares the
  leader walked through, as the NES version did; the line is only a
  drawing, the party's position is still one square, and townspeople and
  monsters walk over it. A poisoned
  member is all green, a dead one or ashes is not drawn. On a horse or
  frigate, and otherwise, the Apple II's single figure is used.
- **Hits** with the Standard tiles show a three-frame red burst on the
  16-pixel grid (a small disc, a larger one, then a ring) instead of the
  "HIT" tile; the other tile sets keep their HIT tile.
- **Combat marker**: the member whose turn it is gets a rounded outline,
  two game pixels wide, fading from white to grey over the four seconds
  before the turn passes by itself. The Apple II blinked the figure.
- **No diagonal moves**: as on the Apple II, the party cannot move, attack
  or fire diagonally while monsters always could. The Mac version let the
  party move diagonally and walled Exodus' castle with mountains to
  compensate (`BlockExodus()`); that code remains, behind
  `World.setDiagonalMoves`, but is no longer offered in Settings.
- **A new game asks "Choose Thine Adventure!"** when a party is formed,
  and at Journey onward while the question is still unanswered (the
  answer is kept with the party, so a reload does not lose it): Modern
  (recommended) sets poison to stop at one hit point, starvation to Mild
  and Balanced XP on; Classic (hardcore) sets poison and starvation to the
  Apple II's, to the death, and Balanced XP off. Any of them can be
  changed afterwards in Settings.
- **Poison kills** (off by default): the Apple II's poison took a hit
  point every ageing tick until the member died. Off, it stops at one hit
  point, so a poisoned member limps home rather than dying on the road;
  on restores the original.
- **Starvation** has three settings. Classic is the Apple II's: an empty
  larder costs every member 5 hit points an ageing tick, to the death.
  Mild (the default) stops at half of maximum hit points. None only says
  so. With food pooled, "STARVING!" prints once a tick rather than once a
  member.
- **Balanced XP** (on by default): a kill's experience is shared among the
  living members, the killer then the others in marching order taking any
  odd points, so an orc's 3 points go one each to three of four. Off, the
  killer takes it all, as on the Apple II, where a bow-armed member who
  finished off wounded foes out-levelled the rest.
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
  when someone is under 60% and down at least 20, not at a flat 75.
  A monster's square counts as occupied, which the original did not check.
- **Menus for the title and party screens** in both input modes (the
  Apple II typed entry numbers and attribute values): the roster is a
  pick list, the party a multi-select list in marching order, attributes a
  screen where left and right adjust each value until all 50 points are
  spent, and a random name is offered from a stock list (`names.ts`).
  Terminate asks for confirmation.
- **Controller mode** with pop-up menus, and a command menu ordered by
  what the surroundings call for (`context.ts`). In combat the menu reads
  the member's turn: a ranged weapon in hand (sling, bow, or a dagger with
  a spare in the bag) puts "Attack (Bow)" first, and a caster gets "Cast
  (spell)", their last spell or Magic bolt (Heal for the cleric classes),
  ahead of the plain Cast: first of all without a ranged weapon, second
  with one. Melee needs no entry, since walking into a foe attacks it.
  Outside combat, when a member is hurt and a cleric-spell caster can pay
  for it, "Cast (Heal)" or "Cast (Great heal)" leads the menu and casts
  at once, no prompts: the member missing the most hit points is the
  target, a wound over twenty calls for Great heal and a smaller one for
  Heal, the other standing in when it alone can be afforded, and the
  caster is whoever with cleric spells has the most mana. Once nobody
  can pay, the entry goes.
- **A quest journal** (`journal.ts`), the Apple II had none. J opens it
  over the map. The main line is ten entries, revealed one at a time as
  the one before is done: speak to the king, the Mark of Kings, lost
  Ambrosia, the four cards, exotic arms, the Marks of Fire and Force, the
  silver snake, the order of the cards, Exodus. Each is open, heard or
  done: heard once a townsperson, the king, the prayer in Yew or the Time
  Lord has said something about it, and their words are kept as spoken,
  with the town's name, and shown on the entry's page; done is read from
  the party (who bears a mark, cards found "2 of 4", exotics in the bag,
  Exodus destroyed) or flagged as it happens (the audience, the shore of
  Ambrosia, the word learned, the serpent parted, the Time Lord). Every
  entry also has a hint written for this port, shown only when asked for
  (H, or Y on a controller), and the asking is remembered. "Journal
  updated" prints when a revealed entry changes state, and only then; a
  clue for an entry not yet revealed waits quietly. The journal lives in
  the save file (version 5); older saves start it empty.
- **Other and Yell are one command.** The Apple II's Yell was Other under
  another name, with one difference: EVOCARE parted the great serpent only
  when yelled, and said "No effect" when typed at Other. EVOCARE now works
  from Other too, so the controller menus list Other alone; Y still works
  on the keyboard.
- **Repeated turns fold together.** A turn that prints exactly what the
  previous turn printed, "North" five times, "Pass" eight, or "North" over
  "POISON!" on a poisoned walk, shows as "North (x5)", "Pass (x8)", or
  "North (x5)" over "POISON! (x5)" rather than filling the message area;
  a turn that differs, even partly, is printed in full and starts afresh.
- **Fountains and the Time Lord** speak only when the party steps onto
  their cell. The Apple II asked "who will drink?" again on every turn
  spent standing there, turning on the spot included, and the idle pass
  timer made that a nag. Step off and back on to drink again.
- **A dungeon auto-map** (`automap.ts`), the graph paper of old. With a
  lit torch the 3x3 of cells around the party is recorded as seen; L (Map
  in the controller menu) cycles between no map, a 5x5 overlay in the top
  right of the message area with the party centred, and the whole level
  in place of the first-person view, which turns the dungeon into a
  top-down crawl: the arrows then move north, south, east and west as on
  the overworld, the party turns to face each move, and the first-person
  view shrinks into the corner the small map used. Only seen cells are drawn, with Peer's map pieces from
  the live level data, so an opened chest shows as opened; a secret door
  is drawn as a wall with one pixel out of place where Peer shows it
  plainly. In the dark nothing is recorded, but the 3x3 around the party
  is still shown so a party without torches can feel its way out. The
  seen cells live in their own browser store, not the save file: "try
  again from last save" keeps what was learned, a new game starts blank.
  The party is drawn as its first living member's figure; there is no
  facing arrow, the wind line's compass keeps that job. Peer keeps its
  blinking diamond.
- **Dungeon art per tile set** (`dungeonArt.ts`). LairWare's Mac version
  drew the first-person dungeon from one photographic sheet whatever tiles
  were chosen. Here that pairing is the "Lairware" set, and every other
  set paints its own dungeon at run time in the spirit of its machine:
  wireframe corridors for the Apple II, Commodore 64 and Macintosh sets,
  blue and cyan for CGA, flat bricks in each palette for the NES and the
  EGA, MCGA, VGA and Ultima V sets. Standard, the Mac tiles, takes the
  VGA stone. The pieces are painted into the Mac sheet's layout and cut
  by its mask, so the drawing code is unchanged (`docs/dungeon-sheet.md`).
- **Gems, keys, powders and torches are the party's** too (bytes 56-59
  of the party record), so Peer, Unlock, Negate time and Ignite never ask
  whose, the guild sells to the party without asking who is buying, and
  Ztats shows the same four counts on every page. Forming a party pools
  them, dispersing deals them out.
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
- **The Ranger's figure** in the Standard tiles has a second animation
  frame of its own, the sword arm raised, made by turning the arm of the
  Mac's single frame about the shoulder; the Mac sheet's two frames were
  the same picture, so the Ranger alone stood still. Lairware keeps the
  Mac sheet untouched, still Ranger and all.
- **Tile sheets carry their own transparency.** The Mac shipped a
  separate grey "Mask" image per set for creature transparency, since
  QuickDraw had no alpha channel; those masks are baked into the alpha of
  the five sheets that had one, and the loader reads a sheet's alpha
  directly. A set that ships a Mask file is still honoured; a set with
  neither draws creatures opaque, as its machine did. LairWare's original
  files remain in `Resources/Graphics` at the root of the repository.
- **Appearance**: the classic bitmap-font layout is used throughout; any of
  the thirteen tile sets (with their fonts, borders and dungeon art) can be chosen in
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
  actions.ts      the party's own records (Get, Ready, Wear, Ztats ...)
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
_member_, a _direction_, an _option_ from a list, a _number_ or a _word_
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

`npm test` runs the Vitest suite (157 tests) against the real extracted data: records,
viewport line of sight, movement, monsters, turn processing, combat,
spells, shops, dialogue, doors and chests, dungeons, menus, save
round-trips and the music decoder. The renderer is exercised in headless
Chromium (Playwright is preinstalled in the development environment) by
driving the keyboard and taking screenshots. `npm run format` applies
Prettier (single quotes, 140 columns; see `.prettierrc.json`) and
`npm run format:check` is the first step of the CI workflow, before the
tests and the build.
