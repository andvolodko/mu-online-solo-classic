const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const PORT = 8088;
const WEB_DIR = __dirname;

// In-memory cache for compressed static assets (matches CDN/GitHub Pages gzip behavior)
const gzipCache = new Map();

function getGzipBuffer(filePath) {
    if (gzipCache.has(filePath)) {
        return gzipCache.get(filePath);
    }
    try {
        const raw = fs.readFileSync(filePath);
        const compressed = zlib.gzipSync(raw, { level: 6 });
        gzipCache.set(filePath, compressed);
        return compressed;
    } catch (e) {
        return null;
    }
}

// Git LFS pointer files start with this header; they are ~130 bytes instead of ~220 MB
function isLfsPointer(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(64);
        const n = fs.readSync(fd, buf, 0, 64, 0);
        fs.closeSync(fd);
        return buf.subarray(0, n).toString('utf8').startsWith('version https://git-lfs.github.com/spec');
    } catch (e) {
        return false;
    }
}

// Background pre-compression of shell_login.data so local startup has 0 latency
setImmediate(() => {
    const dataPath = path.join(WEB_DIR, 'shell_login.data');
    if (!fs.existsSync(dataPath) || isLfsPointer(dataPath)) {
        console.warn('  [ASSETS] web/shell_login.data is missing or is a Git LFS pointer file.');
        console.warn('  [ASSETS] The game client will boot to a black screen. Fix with one of:');
        console.warn('  [ASSETS]   - node web/fetch-assets.cjs   (downloads ~220 MB)');
        console.warn('  [ASSETS]   - git lfs pull                (requires git-lfs installed)');
        return;
    }
    console.log('  [GZIP] Pre-compressing shell_login.data in background...');
    const gz = getGzipBuffer(dataPath);
    if (gz) {
        console.log(`  [GZIP] Ready: ${(gz.length / (1024 * 1024)).toFixed(1)} MB (CDN gzip simulation)`);
    }
});

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.data': 'application/octet-stream',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.musav': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
};

const server = http.createServer((req, res) => {
    // Strip query string
    const cleanUrl = req.url.split('?')[0];

    let filePath = path.join(WEB_DIR, cleanUrl === '/' ? 'index.html' : cleanUrl);
    const isHead = req.method === 'HEAD';

    // Cross-Origin Isolation headers for WebAssembly & SharedArrayBuffer
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Access-Control-Allow-Origin', '*');

    fs.stat(filePath, (err, stats) => {
        if (err) {
            console.warn('[HTTP 404]', req.url);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        // Handle directory index
        if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            return fs.stat(filePath, (subErr, subStats) => {
                if (subErr) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 Not Found (Directory has no index.html)');
                    return;
                }
                serveFileStream(filePath, subStats, res, isHead, req);
            });
        }

        serveFileStream(filePath, stats, res, isHead, req);
    });
});

function serveFileStream(filePath, stats, res, isHead, req) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const acceptGzip = (req && req.headers && req.headers['accept-encoding'] || '').includes('gzip');

    // Compress large assets (.data, .wasm, .js) with gzip if client supports it
    if (acceptGzip && (ext === '.data' || ext === '.wasm' || ext === '.js') && stats.size > 2048) {
        const gzBuffer = getGzipBuffer(filePath);
        if (gzBuffer) {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Encoding': 'gzip',
                'Content-Length': gzBuffer.length,
                'Cache-Control': 'no-cache'
            });
            if (isHead) {
                res.end();
                return;
            }
            res.end(gzBuffer);
            return;
        }
    }

    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache'
    });

    if (isHead) {
        res.end();
        return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        console.error(`Stream error for ${filePath}:`, err.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end();
    });
    stream.pipe(res);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`MU Online Solo Classic live at:`);
    console.log(`  > Local:   http://localhost:${PORT}/`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`  > Network: http://${net.address}:${PORT}/ (${name})`);
            }
        }
    }
});

