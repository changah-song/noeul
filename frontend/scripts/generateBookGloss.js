// Generates assets/book-gloss.png — a semi-transparent lighting overlay that,
// stretched over any book cover, fakes a cloth-bound hardcover: a soft spine
// groove near the left edge, a matte linen weave, a gentle corner vignette,
// and faint light rims on the outline. Deliberately low-contrast so it reads
// as paper/fabric rather than gloss.
//
// Run: node scripts/generateBookGloss.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 384;
const HEIGHT = 576;
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'book-gloss.png');

const gaussian = (value, center, sigma) => (
    Math.exp(-((value - center) ** 2) / (2 * sigma * sigma))
);

// Deterministic PRNG so the texture is identical on every regeneration.
const mulberry32 = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Random values in [-1, 1], lightly smoothed so threads read as fibers
// rather than single-pixel static.
const makeThreadNoise = (length, seed, smoothing = 2) => {
    const rand = mulberry32(seed);
    const raw = Array.from({ length }, () => rand() * 2 - 1);
    const smoothed = new Array(length);

    for (let i = 0; i < length; i += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -smoothing; k <= smoothing; k += 1) {
            const j = i + k;
            if (j >= 0 && j < length) {
                sum += raw[j];
                count += 1;
            }
        }
        smoothed[i] = sum / count;
    }

    return smoothed;
};

// Low-frequency value noise (bilinear over a coarse random grid) for the
// broad mottling cloth gets from uneven dye/wear.
const makeValueNoise = (cols, rows, seed) => {
    const rand = mulberry32(seed);
    const grid = Array.from({ length: (rows + 1) * (cols + 1) }, () => rand() * 2 - 1);

    return (x, y) => {
        const gx = x * cols;
        const gy = y * rows;
        const x0 = Math.min(Math.floor(gx), cols - 1);
        const y0 = Math.min(Math.floor(gy), rows - 1);
        const fx = gx - x0;
        const fy = gy - y0;
        const idx = (row, col) => grid[row * (cols + 1) + col];
        const top = idx(y0, x0) * (1 - fx) + idx(y0, x0 + 1) * fx;
        const bottom = idx(y0 + 1, x0) * (1 - fx) + idx(y0 + 1, x0 + 1) * fx;
        return top * (1 - fy) + bottom * fy;
    };
};

const warpThreads = makeThreadNoise(WIDTH, 101, 0);   // vertical threads
const weftThreads = makeThreadNoise(HEIGHT, 202, 0);  // horizontal threads
const mottle = makeValueNoise(9, 13, 303);
const grainRand = mulberry32(404);

// Returns { white, black } light/shade contributions for a pixel, each 0..1.
const lightAt = (x, y, px, py) => {
    let white = 0;
    let black = 0;

    // The spine face turns away from the light along the far left strip.
    black += 0.03 * Math.exp(-x / 0.03);
    // Spine groove where the cover board meets the spine — narrow and soft.
    black += 0.13 * gaussian(x, 0.05, 0.018);
    // The board rises out of the groove: a broad, faint matte lift (no
    // narrow specular band — that read as metal).
    white += 0.05 * gaussian(x, 0.14, 0.07);
    // Left rim light on the very edge of the spine — the only bright edge.
    white += 0.14 * gaussian(x, 0.003, 0.006);
    // Thin dark board edge on the other three sides, defining the book
    // against the background the way the reference photo does.
    const boardEdge = Math.min(1 - x, y, 1 - y);
    black += 0.10 * Math.exp(-boardEdge / 0.004);
    // Corner vignette: light falls off toward the edges of the board.
    const cx = (x - 0.53) / 0.5;
    const cy = (y - 0.48) / 0.5;
    const radial = Math.min(1, Math.sqrt(cx * cx + cy * cy));
    black += 0.09 * radial ** 3;
    // Whisper of light from above, a touch of shade pooling at the bottom.
    white += 0.035 * Math.exp(-y / 0.3);
    black += 0.05 * Math.exp(-(1 - y) / 0.08);

    // Linen weave: crossed thread streaks + fine grain + broad mottling.
    const weave = (warpThreads[px] * 0.55) + (weftThreads[py] * 0.45);
    const grain = grainRand() * 2 - 1;
    const cloth = (weave * 0.024) + (grain * 0.02) + (mottle(x, y) * 0.015);
    if (cloth > 0) {
        white += cloth;
    } else {
        black -= cloth;
    }

    return { white, black };
};

const buildPixels = () => {
    const rows = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
    let offset = 0;

    for (let py = 0; py < HEIGHT; py += 1) {
        rows[offset] = 0; // filter: none
        offset += 1;
        const y = py / (HEIGHT - 1);

        for (let px = 0; px < WIDTH; px += 1) {
            const x = px / (WIDTH - 1);
            const { white, black } = lightAt(x, y, px, py);
            const total = white + black;
            const alpha = Math.min(1, total);
            // Quantize tone/alpha slightly: invisible at these low opacities,
            // but it lets deflate compress the noise far better.
            const tone = total > 0
                ? Math.min(255, Math.round((255 * (white / total)) / 8) * 8)
                : 0;

            rows[offset] = tone;
            rows[offset + 1] = tone;
            rows[offset + 2] = tone;
            rows[offset + 3] = Math.round((alpha * 255) / 2) * 2;
            offset += 4;
        }
    }

    return rows;
};

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};

const buildPng = () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(WIDTH, 0);
    ihdr.writeUInt32BE(HEIGHT, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    const idat = zlib.deflateSync(buildPixels(), { level: 9 });

    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};

fs.writeFileSync(OUTPUT_PATH, buildPng());
console.log(`Wrote ${OUTPUT_PATH} (${WIDTH}x${HEIGHT})`);
