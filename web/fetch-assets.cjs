// Downloads the large game asset bundles (web/shell_login.data, ~220 MB).
//
// Needed when the repo was downloaded as a ZIP archive or cloned without
// git-lfs: in both cases web/shell_login.data is only a ~130-byte Git LFS
// pointer file, and the game client boots to a black 3D world.
//
// Usage:
//   node web/fetch-assets.cjs            (download what is missing)
//   node web/fetch-assets.cjs --force    (re-download even if the file looks valid)
//
// Sources are tried in order: GitHub Release asset first, live GitHub Pages
// copy as fallback. Partial downloads are kept in *.part files and resumed
// on the next run.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WEB_DIR = process.env.MU_FETCH_DIR || __dirname;

const LFS_MAGIC = 'version https://git-lfs.github.com/spec';
const MIN_ASSET_SIZE = 1024 * 1024; // real bundles are tens/hundreds of MB

const ASSETS = [
    {
        name: 'shell_login.data',
        urls: [
            'https://github.com/andvolodko/mu-online-solo-classic/releases/download/game-assets/shell_login.data',
            'https://andvolodko.github.io/mu-online-solo-classic/shell_login.data'
        ]
    }
];

const force = process.argv.includes('--force') || process.argv.includes('-f');

function isLfsPointer(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(64);
        const n = fs.readSync(fd, buf, 0, 64, 0);
        fs.closeSync(fd);
        return buf.subarray(0, n).toString('utf8').startsWith(LFS_MAGIC);
    } catch {
        return false;
    }
}

function needsDownload(filePath) {
    if (force) return true;
    if (!fs.existsSync(filePath)) return true;
    if (isLfsPointer(filePath)) return true;
    return fs.statSync(filePath).size < MIN_ASSET_SIZE;
}

// Performs a GET, following redirects. Resolves with the final response object.
function request(url, headers, redirectsLeft) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https:') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'mu-solo-fetch-assets', ...headers } }, (res) => {
            const code = res.statusCode || 0;
            if (code >= 300 && code < 400 && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                resolve(request(new URL(res.headers.location, url).href, headers, redirectsLeft - 1));
                return;
            }
            resolve(res);
        });
        req.setTimeout(60000, () => req.destroy(new Error('Connection timed out')));
        req.on('error', reject);
    });
}

function parseContentRangeTotal(header) {
    const match = /\/(\d+)\s*$/.exec(header || '');
    return match ? Number(match[1]) : 0;
}

function pipeToDisk(res, partPath, startBytes, totalBytes, flag) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(partPath, { flags: flag });
        let received = startBytes;
        let lastRender = 0;
        const render = () => {
            const mb = (received / 1048576).toFixed(1);
            const tmb = totalBytes ? (totalBytes / 1048576).toFixed(1) : '?';
            const pct = totalBytes ? ((received / totalBytes) * 100).toFixed(1) : '?';
            process.stdout.write(`\r  ${pct}%  ${mb} / ${tmb} MB   `);
        };
        if (res.socket && res.socket.setTimeout) {
            res.socket.setTimeout(120000, () => res.destroy(new Error('Download stalled (no data for 120s)')));
        }
        res.on('data', (chunk) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastRender > 200) {
                lastRender = now;
                render();
            }
        });
        res.on('error', (err) => { out.destroy(); reject(err); });
        out.on('error', reject);
        out.on('finish', () => {
            render();
            process.stdout.write('\n');
            resolve(received);
        });
        res.pipe(out);
    });
}

// Downloads url into partPath, resuming an existing partial download.
async function downloadWithResume(url, partPath) {
    let existing = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
    const res = await request(url, headers, 5);
    const code = res.statusCode || 0;

    if (code === 416 && existing > 0) {
        // Server says our offset is past the end: the part file may already be
        // complete. Verify against the total size reported in Content-Range.
        res.resume();
        const total = parseContentRangeTotal(res.headers['content-range']);
        if (total && existing === total) return;
        fs.unlinkSync(partPath);
        existing = 0;
        return downloadWithResume(url, partPath);
    }

    if (code === 206) {
        const total = parseContentRangeTotal(res.headers['content-range']);
        await pipeToDisk(res, partPath, existing, total, 'a');
        return;
    }

    if (code === 200) {
        const total = Number(res.headers['content-length']) || 0;
        if (existing > 0 && existing === total) {
            res.resume();
            return;
        }
        // Server ignored our Range header (or no partial file): start fresh.
        await pipeToDisk(res, partPath, 0, total, 'w');
        return;
    }

    res.resume();
    throw new Error(`HTTP ${code}`);
}

function finalize(partPath, destPath) {
    const size = fs.statSync(partPath).size;
    if (size < MIN_ASSET_SIZE || isLfsPointer(partPath)) {
        fs.unlinkSync(partPath);
        throw new Error(`Downloaded file is too small (${size} bytes) - source likely returned an LFS pointer`);
    }
    fs.renameSync(partPath, destPath);
    console.log(`  [fetch-assets] OK: ${path.basename(destPath)} (${(size / 1048576).toFixed(1)} MB)`);
}

async function main() {
    let failures = 0;
    for (const asset of ASSETS) {
        const dest = path.join(WEB_DIR, asset.name);
        const part = dest + '.part';

        if (!needsDownload(dest)) {
            console.log(`[fetch-assets] ${asset.name} already present, skipping (use --force to re-download)`);
            continue;
        }
        if (fs.existsSync(dest) && isLfsPointer(dest)) {
            console.log(`[fetch-assets] ${asset.name} is a Git LFS pointer file - downloading the real asset...`);
        } else {
            console.log(`[fetch-assets] ${asset.name} is missing - downloading (~220 MB, may take a few minutes)...`);
        }

        let done = false;
        for (const url of asset.urls) {
            try {
                console.log(`  From: ${url}`);
                await downloadWithResume(url, part);
                finalize(part, dest);
                done = true;
                break;
            } catch (err) {
                console.error(`  Failed: ${err.message}`);
            }
        }
        if (!done) {
            failures++;
            console.error(`[fetch-assets] Could not download ${asset.name}`);
        }
    }

    if (failures > 0) {
        console.error('');
        console.error('[fetch-assets] Alternatives:');
        console.error('  - install git-lfs, then run:  git lfs pull');
        console.error('  - download shell_login.data manually from the live site:');
        console.error('    https://andvolodko.github.io/mu-online-solo-classic/shell_login.data');
        console.error('    and place it in the web/ folder');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[fetch-assets]', err.message);
    process.exit(1);
});
