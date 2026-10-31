/**
 * Generates the icon set: favicon.ico, favicon-16/32.png, apple-touch-icon.png,
 * icon-192.png and icon-512.png.
 *
 * The artwork is a 3x3 tile grid matching the game board, drawn in the
 * project's colours. Run with: node tools/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'public');

const BG = [26, 26, 46, 255];       // #1a1a2e
const TILE = [255, 255, 255, 255];  // front colour
const ACCENT = [74, 144, 217, 255]; // #4a90d9

/**
 * Draw the icon into an RGBA pixel buffer.
 * @param {number} size
 * @returns {Buffer}
 */
function draw(size) {
    const pixels = Buffer.alloc(size * size * 4);

    const put = (x, y, [r, g, b, a]) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const i = (y * size + x) * 4;
        const alpha = a / 255;
        pixels[i] = Math.round(r * alpha + pixels[i] * (1 - alpha));
        pixels[i + 1] = Math.round(g * alpha + pixels[i + 1] * (1 - alpha));
        pixels[i + 2] = Math.round(b * alpha + pixels[i + 2] * (1 - alpha));
        pixels[i + 3] = Math.max(pixels[i + 3], a);
    };

    // Background with rounded corners.
    const radius = Math.round(size * 0.22);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cx = Math.min(x, size - 1 - x);
            const cy = Math.min(y, size - 1 - y);
            if (cx < radius && cy < radius) {
                const dx = radius - cx;
                const dy = radius - cy;
                if (Math.hypot(dx, dy) > radius) continue;
            }
            put(x, y, BG);
        }
    }

    // A 3x3 grid of tiles; the centre and one corner are flipped, echoing
    // the game's board.
    const grid = 3;
    const margin = Math.round(size * 0.16);
    const gap = Math.round(size * 0.05);
    const cell = Math.floor((size - margin * 2 - gap * (grid - 1)) / grid);
    const gridSize = cell * grid + gap * (grid - 1);
    const origin = Math.round((size - gridSize) / 2);
    const tileRadius = Math.max(1, Math.round(cell * 0.22));

    const flipped = new Set(['1,1', '0,2']);

    for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
            const x0 = origin + gx * (cell + gap);
            const y0 = origin + gy * (cell + gap);
            const isBack = flipped.has(`${gx},${gy}`);
            const colour = isBack ? BG : TILE;

            for (let y = y0; y < y0 + cell; y++) {
                for (let x = x0; x < x0 + cell; x++) {
                    const cx = Math.min(x - x0, x0 + cell - 1 - x);
                    const cy = Math.min(y - y0, y0 + cell - 1 - y);
                    if (cx < tileRadius && cy < tileRadius) {
                        const dx = tileRadius - cx;
                        const dy = tileRadius - cy;
                        if (Math.hypot(dx, dy) > tileRadius) continue;
                    }
                    put(x, y, colour);
                }
            }

            // Back tiles need a visible outline against the background.
            if (isBack) {
                for (let y = y0; y < y0 + cell; y++) {
                    for (let x = x0; x < x0 + cell; x++) {
                        const onEdge = x === x0 || y === y0 || x === x0 + cell - 1 || y === y0 + cell - 1;
                        if (onEdge) put(x, y, ACCENT);
                    }
                }
            }
        }
    }

    return pixels;
}

/** CRC32, needed for PNG chunks. */
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
}

/** Encode an RGBA buffer as a PNG. */
function encodePng(pixels, size) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // colour type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }

    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Build an ICO containing PNG-encoded images. */
function encodeIco(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);

    const entries = Buffer.alloc(16 * images.length);
    let offset = 6 + 16 * images.length;

    images.forEach((img, i) => {
        const base = i * 16;
        entries[base] = img.size >= 256 ? 0 : img.size;
        entries[base + 1] = img.size >= 256 ? 0 : img.size;
        entries[base + 2] = 0;
        entries[base + 3] = 0;
        entries.writeUInt16LE(1, base + 4);
        entries.writeUInt16LE(32, base + 6);
        entries.writeUInt32LE(img.data.length, base + 8);
        entries.writeUInt32LE(offset, base + 12);
        offset += img.data.length;
    });

    return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

mkdirSync(ICON_DIR, { recursive: true });

const png16 = encodePng(draw(16), 16);
const png32 = encodePng(draw(32), 32);
const png48 = encodePng(draw(48), 48);

writeFileSync(join(ICON_DIR, 'favicon-16.png'), png16);
writeFileSync(join(ICON_DIR, 'favicon-32.png'), png32);
writeFileSync(join(ICON_DIR, 'favicon.ico'), encodeIco([
    { size: 16, data: png16 },
    { size: 32, data: png32 },
    { size: 48, data: png48 },
]));

writeFileSync(join(ICON_DIR, 'apple-touch-icon.png'), encodePng(draw(180), 180));
writeFileSync(join(ICON_DIR, 'icon-192.png'), encodePng(draw(192), 192));
writeFileSync(join(ICON_DIR, 'icon-512.png'), encodePng(draw(512), 512));

console.log('Icons written to public/');