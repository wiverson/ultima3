/**
 * party.ts
 *
 * A typed view over the 64-byte party record (PRTY resource).
 *
 * NOTE ON INDEXING: the C code read the resource into `Party[byte + 1]`, so
 * its comments and constants are 1-based (`Party[3]` is the location).
 * This file uses the resource's own 0-based offsets; each accessor's
 * doc comment gives the original 1-based index for cross reference.
 *
 *   offset  (C index)  meaning
 *   ------  ---------  -----------------------------------------------------
 *    0      Party[1]   shape drawn for the party: 0x7E ranger, 0x14 horse,
 *                      0x16 frigate, 0x18 whirlpool (while being sucked in)
 *    1      Party[2]   number of members (1-4); moves advance by this much
 *    2      Party[3]   location type, see Location below
 *    3      Party[4]   surface X (saved when entering a town/castle/dungeon)
 *    4      Party[5]   surface Y
 *    5      Party[6]   always 0xFF in saved games; unused
 *    6-9    Party[7..10] roster slot (1-based, 0 = empty) of members 1-4
 *   10-13   Party[11..14] move counter, four base-100 digits, least significant first
 *   15      Party[16]  1 once Exodus has been destroyed
 */

export const PARTY_RECORD_SIZE = 64;

/** Values of the location byte (`Party[3]` in the C source). */
export const Location = {
  Sosaria: 0x00,
  Dungeon: 0x01,
  Town: 0x02,
  Castle: 0x03,
  Combat: 0x80,
  Ambrosia: 0xff,
} as const;
export type LocationType = (typeof Location)[keyof typeof Location];

export class Party {
  constructor(public readonly bytes: Uint8Array) {
    if (bytes.length !== PARTY_RECORD_SIZE) throw new Error(`party record must be ${PARTY_RECORD_SIZE} bytes`);
  }

  /** `Party[1]`: the shape drawn at the centre of the viewport. */
  get shape(): number {
    return this.bytes[0];
  }
  set shape(v: number) {
    this.bytes[0] = v;
  }

  /** `Party[2]`: number of members, 1-4. */
  get size(): number {
    return this.bytes[1];
  }
  set size(v: number) {
    this.bytes[1] = v;
  }

  /** `Party[3]`. */
  get location(): number {
    return this.bytes[2];
  }
  set location(v: number) {
    this.bytes[2] = v;
  }

  /** `Party[4]`, `Party[5]`: where on Sosaria the party stood when it entered somewhere. */
  get surfaceX(): number {
    return this.bytes[3];
  }
  set surfaceX(v: number) {
    this.bytes[3] = v;
  }
  get surfaceY(): number {
    return this.bytes[4];
  }
  set surfaceY(v: number) {
    this.bytes[4] = v;
  }

  /**
   * `Party[7 + member]`: the 1-based roster slot of member 0..3, or 0 when
   * the position is empty. Use `memberSlot()` for the 0-based slot.
   */
  memberRosterNumber(member: number): number {
    return this.bytes[6 + member];
  }
  setMemberRosterNumber(member: number, rosterNumber: number): void {
    this.bytes[6 + member] = rosterNumber;
  }

  /** 0-based roster slot of member 0..3, or -1 when empty. */
  memberSlot(member: number): number {
    return this.memberRosterNumber(member) - 1;
  }

  /** True when at least one member has been assigned (`Party[7] != 0`). */
  get formed(): boolean {
    return this.bytes[6] !== 0;
  }

  /** `Party[11..14]`: total moves, kept as four base-100 digits. */
  get moves(): number {
    return this.bytes[10] + this.bytes[11] * 100 + this.bytes[12] * 10000 + this.bytes[13] * 1000000;
  }

  /**
   * Mirrors `IncMoves()`: add the party size to the move counter, carrying
   * between the base-100 digits and saturating at 99,999,999.
   */
  incrementMoves(): void {
    const b = this.bytes;
    b[10] += this.size;
    if (b[10] > 99) {
      b[10] -= 100;
      b[11]++;
      if (b[11] > 99) {
        b[11] -= 100;
        b[12]++;
        if (b[12] > 99) {
          b[12] -= 100;
          b[13]++;
          if (b[13] > 99) b[10] = b[11] = b[12] = b[13] = 99;
        }
      }
    }
  }

  /** `Party[16]`: set once Exodus is destroyed. */
  get exodusDestroyed(): boolean {
    return this.bytes[15] === 1;
  }
}
