import { readFileSync } from 'node:fs';

/**
 * Width and height of a PNG, read from its IHDR chunk.
 *
 * Asset tests only ever need the grid a file declares - "is this sheet 8 rows of
 * the configured cell" - so they read the 8-byte signature and the IHDR rather
 * than decoding pixels. That keeps them independent of how the art was produced
 * and fast enough to run on every change.
 *
 * Throws on a file that is not a PNG, so a renamed `.jpg` cannot pass as art.
 */
export function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  const isPng = buffer.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) throw new Error(`${path} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
