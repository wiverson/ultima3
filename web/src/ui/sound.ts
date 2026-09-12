/**
 * sound.ts
 *
 * Sound effects through the Web Audio API. Effects are the original WAV
 * files in public/sounds, decoded once and cached.
 *
 * Browsers refuse to start audio until the user has interacted with the
 * page, so the AudioContext is created lazily on the first key press.
 *
 * Music is not handled here: the original tracks are QuickTime Music
 * Architecture files (a MIDI-like format) that browsers cannot play. They
 * need a one-time conversion to MIDI and then to OGG/MP3 before a music
 * player can be added.
 */

export class SoundPlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  enabled = true;

  constructor(private readonly baseUrl = 'sounds/') {}

  /** Create the AudioContext. Call from a user-gesture handler. */
  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(`${this.baseUrl}${name}.wav`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => this.context!.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** Play a named effect. Missing files fail silently. */
  play(name: string): void {
    if (!this.enabled || !this.context) return;
    void this.load(name).then((buffer) => {
      if (!buffer || !this.context) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start();
    });
  }
}
