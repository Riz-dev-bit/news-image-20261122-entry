import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import * as zlib from 'node:zlib';

const MAX_FILE_SIZE = 1_048_576; // 1 MB (1024 * 1024 bytes)
const REQUIRED_WIDTH = 1024;
const REQUIRED_HEIGHT = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function main(): void {
  const inputPath = path.resolve('entry.png');
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const outputPath = path.join(outputDir, 'entry.png');

  console.log(`Checking input file: ${inputPath}`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const stat = fs.statSync(inputPath);
  if (!stat.isFile()) {
    throw new Error(`Input path is not a file: ${inputPath}`);
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size (${stat.size} bytes) exceeds maximum limit of ${MAX_FILE_SIZE} bytes`
    );
  }

  const buffer = fs.readFileSync(inputPath);

  // Verify PNG signature (bytes 0-7)
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }

  // Iterate and verify all PNG chunks through to the IEND trailer chunk
  let offset = 8;
  let chunkIndex = 0;
  let seenIhdr = false;
  let seenIend = false;
  const chunkTypes: string[] = [];

  while (offset < buffer.length) {
    if (seenIend) {
      throw new Error(`Found trailing data after PNG IEND chunk at offset ${offset}`);
    }

    if (offset + 12 > buffer.length) {
      throw new Error(`Truncated chunk header at offset ${offset}`);
    }

    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkTotalLength = 12 + length;

    if (offset + chunkTotalLength > buffer.length) {
      throw new Error(`Truncated chunk data for ${type} at offset ${offset}`);
    }

    // Verify chunk CRC
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const computedCrc = zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (computedCrc !== expectedCrc) {
      throw new Error(
        `CRC mismatch in chunk ${type} at offset ${offset}: expected ${expectedCrc.toString(16)}, got ${computedCrc.toString(16)}`
      );
    }

    chunkTypes.push(type);

    if (chunkIndex === 0) {
      if (type !== 'IHDR') {
        throw new Error(`First PNG chunk must be IHDR, found ${type}`);
      }
      seenIhdr = true;

      if (length < 13) {
        throw new Error(`Invalid IHDR chunk length: ${length}`);
      }

      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      console.log(`PNG dimensions: ${width}x${height}, size: ${stat.size} bytes`);

      if (width !== REQUIRED_WIDTH || height !== REQUIRED_HEIGHT) {
        throw new Error(
          `Invalid dimensions: expected ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT}, got ${width}x${height}`
        );
      }
    }

    if (type === 'IEND') {
      seenIend = true;
      if (length !== 0) {
        throw new Error(`IEND chunk must have data length 0, got ${length}`);
      }
      if (offset + chunkTotalLength !== buffer.length) {
        throw new Error(
          `IEND chunk is not at the end of the file: trailing bytes detected`
        );
      }
    }

    offset += chunkTotalLength;
    chunkIndex++;
  }

  if (!seenIhdr) {
    throw new Error('PNG missing IHDR chunk');
  }

  if (!seenIend) {
    throw new Error('PNG missing IEND trailer chunk');
  }

  console.log(`Verified ${chunkIndex} chunks (${chunkTypes.join(', ')}) through to IEND trailer`);

  // Ensure output directory exists and copy entry.png
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(inputPath, outputPath);

  // Compute and log SHA-256 digest of the exported image
  const exportedBuffer = fs.readFileSync(outputPath);
  const sha256Digest = crypto.createHash('sha256').update(exportedBuffer).digest('hex');
  console.log(`Exported image SHA-256: ${sha256Digest}`);
  console.log(`Successfully verified and copied entry.png to ${outputPath}`);
}

main();
