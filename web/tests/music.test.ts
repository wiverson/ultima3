import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuickTimeMusic } from '../src/ui/music.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadSong(name: string): ArrayBuffer {
  const buf = readFileSync(join(HERE, '..', '..', 'Resources', 'Music', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('QuickTime music parser', () => {
  it('decodes the notes of the Sosaria theme', () => {
    const tune = parseQuickTimeMusic(loadSong('Song_1.mov'));
    expect(tune.notes.length).toBeGreaterThan(100);
    // The first note: C3 for one second at volume 64, after a 425-unit rest.
    const first = tune.notes[0];
    expect(first.pitch).toBe(48);
    expect(first.volume).toBe(64);
    expect(first.duration).toBeCloseTo(1, 3);
    expect(first.time).toBeCloseTo(425 / 600, 3);
    // Notes are in time order and the tune has a sensible length.
    for (let i = 1; i < tune.notes.length; i++) expect(tune.notes[i].time).toBeGreaterThanOrEqual(tune.notes[i - 1].time);
    expect(tune.length).toBeGreaterThan(30);
    expect(tune.length).toBeLessThan(300);
    // The one extended (long) note in this tune: G3 held for 5097 units.
    const long = tune.notes.find((n) => n.duration > 5);
    expect(long?.pitch).toBe(55);
    expect(long?.duration).toBeCloseTo(5097 / 600, 3);
  });

  it('decodes every shipped song', () => {
    for (const file of [
      'Song_1.mov',
      'Song_2.mov',
      'Song_3.mov',
      'Song_4.mov',
      'Song_5.mov',
      'Song_6.mov',
      'Song_7.mov',
      'Song_8.mov',
      'Song_A.mov',
      'Song_B.mov',
    ]) {
      const tune = parseQuickTimeMusic(loadSong(file));
      expect(tune.notes.length, file).toBeGreaterThan(10);
      expect(
        tune.notes.every((n) => n.volume > 0 && n.volume <= 127),
        file,
      ).toBe(true);
      for (const n of tune.notes) {
        expect(n.pitch, file).toBeGreaterThan(20);
        expect(n.pitch, file).toBeLessThan(110);
      }
    }
  });
});
