import { describe, expect, it } from 'vitest';
import { Key } from '../src/game/io.ts';
import { controllerKeyFor } from '../src/ui/menus.ts';

describe('controller stand-ins on the keyboard', () => {
  it('map WASD to the d-pad and the button row and the pad letters to the buttons', () => {
    expect(['w', 'a', 's', 'd'].map(controllerKeyFor)).toEqual([Key.Up, Key.Left, Key.Down, Key.Right]);
    expect([Key.Enter, 'z', 'Z'].map(controllerKeyFor)).toEqual([Key.A, Key.A, Key.A]);
    expect([Key.Escape, 'x', 'X', 'b', 'B'].map(controllerKeyFor)).toEqual([Key.B, Key.B, Key.B, Key.B, Key.B]);
    expect(['c', 'C'].map(controllerKeyFor)).toEqual([Key.X, Key.X]);
    expect(['v', 'V', 'y', 'Y'].map(controllerKeyFor)).toEqual([Key.Y, Key.Y, Key.Y, Key.Y]);
  });

  it('pass every other key through', () => {
    expect(controllerKeyFor(Key.Up)).toBe(Key.Up);
    expect(controllerKeyFor('q')).toBe('q');
    expect(controllerKeyFor(' ')).toBe(' ');
  });
});
