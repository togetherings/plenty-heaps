/**
 * bitpack.js
 * ==========
 * Low-level tools for squeezing the save into SCORM 1.2's 4096-character limit.
 *
 *   BitWriter / BitReader  write and read numbers using an exact number of bits
 *                          (e.g. a value from 0-99 only needs 7 bits, not a
 *                          whole 64-bit number or a 2-character JSON string).
 *   base64url              turns the bytes into safe text characters
 *                          (A-Z a-z 0-9 - _). Every 3 bytes -> 4 characters,
 *                          so 4096 characters hold 3072 bytes = 24,576 bits.
 *   crc16                  a checksum stored with the save, so a damaged or
 *                          cut-off save is detected instead of loading garbage.
 *
 * Nothing here knows about the game. The save layout lives in saveCodec.js.
 */
(function (FS) {
  'use strict';

  /** Writes unsigned integers of a given bit width into a growing byte array. */
  class BitWriter {
    constructor() {
      this.bytes = [];   // finished bytes
      this.cur = 0;      // byte being filled
      this.nbits = 0;    // how many bits of `cur` are used (0-7)
      this.totalBits = 0;
    }

    /**
     * Write `value` using exactly `bits` bits (1-32). Throws if the value
     * doesn't fit - that's a bug in the save schema and we want to know.
     */
    write(value, bits) {
      value = Math.floor(value);
      if (value < 0 || value >= Math.pow(2, bits)) {
        throw new Error('BitWriter: value ' + value + ' does not fit in ' + bits + ' bits');
      }
      // Write most-significant bit first. Division (not >>) keeps this correct
      // for 32-bit values, which JavaScript bit operators treat as negative.
      for (let i = bits - 1; i >= 0; i--) {
        const bit = Math.floor(value / Math.pow(2, i)) % 2;
        this.cur = (this.cur << 1) | bit;
        this.nbits++;
        this.totalBits++;
        if (this.nbits === 8) {
          this.bytes.push(this.cur);
          this.cur = 0;
          this.nbits = 0;
        }
      }
    }

    writeBool(b) { this.write(b ? 1 : 0, 1); }

    /** Finish the last partial byte (padded with zeros) and return all bytes. */
    finish() {
      const out = this.bytes.slice();
      if (this.nbits > 0) out.push(this.cur << (8 - this.nbits));
      return out;
    }
  }

  /** Reads values back in the same order and widths they were written. */
  class BitReader {
    constructor(bytes) {
      this.bytes = bytes;
      this.pos = 0; // bit position
    }

    read(bits) {
      let value = 0;
      for (let i = 0; i < bits; i++) {
        const byteIndex = this.pos >> 3;
        if (byteIndex >= this.bytes.length) throw new Error('BitReader: read past end of save data');
        const bit = (this.bytes[byteIndex] >> (7 - (this.pos & 7))) & 1;
        value = value * 2 + bit;
        this.pos++;
      }
      return value;
    }

    readBool() { return this.read(1) === 1; }
  }

  // ---------------------------------------------------------------------------
  // base64url: URL- and LMS-safe text encoding (no '+', '/', '=' characters).
  // ---------------------------------------------------------------------------
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LOOKUP = {};
  for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;

  function bytesToBase64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      const n = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
      out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += ALPHABET[n & 63];
    }
    return out;
  }

  function base64urlToBytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 4) {
      const chunk = str.substr(i, 4);
      let n = 0;
      for (let j = 0; j < 4; j++) {
        const c = chunk[j];
        let v = 0;
        if (c !== undefined) {
          v = LOOKUP[c];
          if (v === undefined) throw new Error('base64url: invalid character "' + c + '"');
        }
        n = (n << 6) | v;
      }
      out.push((n >> 16) & 255);
      if (chunk.length > 2) out.push((n >> 8) & 255);
      if (chunk.length > 3) out.push(n & 255);
    }
    return out;
  }

  /** CRC-16/CCITT-FALSE checksum over an array of bytes. */
  function crc16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc;
  }

  /** Number of bits needed to store values 0..maxValue. */
  function bitsFor(maxValue) {
    let bits = 1;
    while (Math.pow(2, bits) <= maxValue) bits++;
    return bits;
  }

  FS.BitPack = {
    BitWriter: BitWriter,
    BitReader: BitReader,
    bytesToBase64url: bytesToBase64url,
    base64urlToBytes: base64urlToBytes,
    crc16: crc16,
    bitsFor: bitsFor
  };
})(FarmSim);
