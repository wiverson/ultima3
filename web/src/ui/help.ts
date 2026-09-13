/**
 * help.ts
 *
 * The in-game help pages and the list of tile sets, for the Settings menu.
 * Each page is up to 21 lines of at most 38 characters, drawn full screen
 * in the bitmap font. Which set of pages shows depends on the input mode.
 */

/**
 * Tile sets shipped in public/graphics, as the Settings menu lists them:
 * best first. Standard is LairWare's 64-pixel art, drawn at native size;
 * then the 32-pixel colour sets, the tripled Apple II colour sets, the
 * monochrome sets, and the 16-pixel 8-bit and early PC sets.
 */
export const TILE_SETS = [
  'Standard',
  'Lairware',
  'PC VGA',
  'Nintendo',
  'PC Ultima V',
  'PC MCGA',
  'Apple II Color',
  'Apple II Color TV',
  'Apple II Mono',
  'Macintosh B&W',
  'PC EGA',
  'PC CGA',
  'Commodore 64',
];

export const KEYBOARD_HELP: string[][] = [
  [
    'KEYBOARD COMMANDS            page 1/3',
    '',
    'Arrows     walk / move in combat',
    '1 3 7 9    walk diagonally (if enabled)',
    'Space      pass a turn',
    'Escape     settings (this menu)',
    '',
    'A  attack an adjacent monster',
    'B  board a horse or frigate',
    'X  exit the horse or frigate',
    'E  enter a town, castle, dungeon',
    'F  fire the frigate cannons',
    'L  look at an adjacent square',
    'T  transact: talk, shop, the king',
    'U  unlock a door (needs a key)',
    'S  steal from a shop chest',
    'G  get a chest',
    'P  peer at a gem (map)',
    'O  other command: say a word',
    'Y  yell: the same as Other',
  ],
  [
    'KEYBOARD COMMANDS            page 2/3',
    '',
    'Z  ztats: a member\'s full record',
    'C  cast a spell',
    'R  ready a weapon',
    'W  wear armour',
    'M  modify the marching order',
    'N  negate time (needs a powder)',
    'Q  quit and save (on the surface)',
    '',
    'COMBAT',
    'Arrows     move; into a monster attacks',
    'A          attack in a direction',
    'C N R Z    cast, negate, ready, ztats',
    'Escape     auto combat off (if on)',
    '',
    'DUNGEONS',
    'Up / Down  advance or retreat',
    'Left/Right turn',
    'I  K  D    ignite torch, klimb, descend',
    'L          map: off, 5x5, whole level',
  ],
  [
    'HOW THINGS WORK              page 3/3',
    '',
    'Walking into a townsperson talks,',
    'into a shop counter shops, into a',
    'locked door unlocks it, into a',
    'monster attacks it.',
    '',
    'Gold and food belong to the party;',
    'they show above the map.',
    '',
    'Names show a member\'s state: green',
    'poisoned, light grey dead, dark grey',
    'ashes, blue when Lord British will',
    'raise them. Hit points go yellow',
    'under a quarter and red under a tenth.',
    '',
    'Prompts for "whom" take 1-4; a',
    'direction is an arrow key.',
    '',
    'Q on the surface saves the game in',
    'this browser; it resumes next visit.',
  ],
];

export const CONTROLLER_HELP: string[][] = [
  [
    'CONTROLLER                   page 1/2',
    '',
    'D-pad  move, or move a menu cursor',
    'A      open the command menu; choose',
    'B      cancel, or pass a turn',
    'X      ztats',
    'Y      look (attack in combat,',
    '       ignite a torch in dungeons)',
    '',
    'Keyboard stand-ins:',
    'WASD or arrows = d-pad',
    'Enter or Z = A    Escape or X = B',
    'C = X             V = Y',
    '',
    'Pressing a gamepad button switches',
    'to controller mode.',
  ],
  [
    'HOW THINGS WORK              page 2/2',
    '',
    'Gold and food belong to the party;',
    'they show above the map.',
    '',
    'Names show a member\'s state: green',
    'poisoned, light grey dead, dark grey',
    'ashes, blue when Lord British will',
    'raise them. Hit points go yellow',
    'under a quarter and red under a tenth.',
    '',
    'Quit (in the command menu) on the',
    'surface saves the game in this',
    'browser; it resumes next visit.',
  ],
];
