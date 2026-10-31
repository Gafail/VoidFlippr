/**
 * Static file serving.
 *
 * Every request path is resolved against a fixed root and verified to stay
 * inside it, so "../" traversal can never escape the web root. Files are sent
 * with ETag / Last-Modified so clients can revalidate cheaply.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = new Map(Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.xml': 'application/xml; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
}));

function contentTypeFor(filePath) {
    return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

/**
 * Resolve a URL path to a file inside root.
 * @returns {Promise<string|null>} absolute path, or null if unsafe/missing
 */
export async function resolveSafePath(root, urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        return null; // malformed percent-encoding
    }

    // Strip query/fragment, normalise separators, drop null bytes.
    const clean = decoded.split('?')[0].split('#')[0].replace(/\\/g, '/').replace(/\0/g, '');
    const relative = clean.replace(/^\/+/, '');

    const target = path.resolve(root, relative);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

    // Must be inside root. path.resolve already removed any "..", but this
    // double-checks the containment rule explicitly.
    if (target !== root && !target.startsWith(rootWithSep)) return null;

    try {
        const info = await stat(target);
        if (!info.isFile()) return null;
        return target;
    } catch {
        return null;
    }
}

/**
 * Send a file with caching headers and conditional-request support.
 * @returns {Promise<boolean>} true if the file was sent
 */
export async function sendFile(req, res, filePath, { cacheControl = 'no-cache' } = {}) {
    let info;
    try {
        info = await stat(filePath);
    } catch {
        return false;
    }
    if (!info.isFile()) return false;

    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;

    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
        res.end();
        return true;
    }

    res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': info.size,
        'Cache-Control': cacheControl,
        ETag: etag,
        'Last-Modified': info.mtime.toUTCString(),
    });

    if (req.method === 'HEAD') {
        res.end();
        return true;
    }

    await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.pipe(res);
    });

    return true;
}