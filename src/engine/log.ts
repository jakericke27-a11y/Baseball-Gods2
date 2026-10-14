/**
 * Growable byte buffer for the pitch-by-pitch event log.
 * Text (play-by-play, box scores, splits) is derived from these bytes on demand —
 * nothing is stored as prose.
 */
export class ByteLog {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(initialBytes = 1 << 20) {
    this.buf = new Uint8Array(initialBytes);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): void { this.ensure(1); this.buf[this.length++] = v & 0xff; }
  i8(v: number): void { this.ensure(1); this.view.setInt8(this.length++, Math.max(-128, Math.min(127, Math.round(v)))); }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.length, v, true); this.length += 2; }
  bytes(src: Uint8Array, count: number): void {
    this.ensure(count);
    this.buf.set(src.subarray(0, count), this.length);
    this.length += count;
  }

  /** A copy of the written bytes. */
  toBytes(): Uint8Array { return this.buf.slice(0, this.length); }
}
