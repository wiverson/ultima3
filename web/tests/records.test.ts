import { describe, it, expect } from 'vitest';
import { loadTestResources } from './helpers.ts';
import { Roster, PlayerRecord } from '../src/game/player.ts';
import { Party } from '../src/game/party.ts';

describe('player records', () => {
  const res = loadTestResources();
  const roster = new Roster(res.defaultRoster.slice());

  it('reads the shipped characters', () => {
    const t = roster.get(0);
    expect(t.exists).toBe(true);
    expect(t.name).toBe('Tatiana');
    expect(t.sex).toBe('F');
    expect(t.race).toBe('E');
    expect(t.classLetter).toBe('T');
    expect(t.status).toBe('G');
    expect(t.hitPoints).toBe(100);
    expect(t.maxHitPoints).toBe(100);
    expect(t.food).toBe(150);
    expect(t.gold).toBe(150);
    expect(t.level).toBe(1);
    expect(roster.get(1).name).toBe('Roderic');
  });

  it('handles hit points across the byte boundary', () => {
    const p = new PlayerRecord(new Uint8Array(64));
    p.bytes[28] = 1; // max 256 + 44 = 300
    p.bytes[29] = 44;
    p.hitPoints = 255;
    p.addHitPoints(10);
    expect(p.hitPoints).toBe(265);
    p.addHitPoints(1000);
    expect(p.hitPoints).toBe(300);
    expect(p.subtractHitPoints(299)).toBe(false);
    expect(p.hitPoints).toBe(1);
    p.status = 'G';
    expect(p.subtractHitPoints(1)).toBe(true);
    expect(p.status).toBe('D');
    expect(p.alive).toBe(false);
  });

  it('borrows between the base-100 food digits and reports starvation', () => {
    const p = new PlayerRecord(new Uint8Array(64));
    p.bytes[32] = 1; // 100
    p.bytes[33] = 0; // + 0
    p.bytes[34] = 5; // fraction
    expect(p.eatFood(10)).toBe(false);
    // The Mac port borrows by adding 99 rather than 100 (it subtracts 157
    // from a byte that wrapped by 256), so each borrow loses one extra unit.
    // 100.05 - 0.10 therefore gives 98.94, not 99.95. Kept for fidelity.
    expect(p.food).toBe(98);
    expect(p.bytes[34]).toBe(94);
    // Eat everything.
    let starved = false;
    for (let i = 0; i < 2000 && !starved; i++) starved = p.eatFood(10);
    expect(starved).toBe(true);
    expect(p.food).toBe(0);
  });
});

describe('party record', () => {
  it('reads the default party', () => {
    const res = loadTestResources();
    const party = new Party(res.defaultParty.slice());
    expect(party.shape).toBe(0x7e);
    expect(party.size).toBe(4);
    expect(party.location).toBe(0);
    expect(party.surfaceX).toBe(42);
    expect(party.surfaceY).toBe(20);
    expect(party.memberSlot(0)).toBe(0);
    expect(party.memberSlot(3)).toBe(3);
    expect(party.formed).toBe(true);
    expect(party.exodusDestroyed).toBe(false);
  });

  it('carries the move counter across base-100 digits', () => {
    const party = new Party(new Uint8Array(64));
    party.size = 4;
    for (let i = 0; i < 30; i++) party.incrementMoves();
    expect(party.moves).toBe(120);
    expect(party.bytes[10]).toBe(20);
    expect(party.bytes[11]).toBe(1);
  });
});
