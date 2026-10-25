/**
 * Builds dist/ from src/.
 *
 *   node build.mjs            dev build (readable output)
 *   node build.mjs --minify   production build (minified)
 *
 * esbuild is used when it is installed. If it is not, the build falls back to
 * copying the source tree so the server can still run straight from src/.
 */

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const MINIFY = process.argv.includes('--minify') || process.env.NODE_ENV === 'production';

const CSS_ORDER = [
    'theme.css', 'base.css', 'screens.css', 'board.css', 'modals.css',
    'tutorial.css', 'identity.css', 'leaderboard.css', 'submit.css', 'toast.css',
];

function log(message) {
    console.log(message);
}

/** Build with esbuild when available. Returns true if the bundle was created. */
async function bundleWithEsbuild() {
    let esbuild;
    try {
        esbuild = await import('esbuild');
    } catch {
        return false;
    }

    await esbuild.build({
        entryPoints: [join(SRC, 'js', 'main.js')],
        bundle: true,
        target: 'es2020',
        format: 'esm',
        minify: MINIFY,
        outfile: join(DIST, 'js', 'main.js'),
        logLevel: 'warning',
    });
    return true;
}

/** Concatenate the CSS files in dependency order into one stylesheet. */
function buildCss() {
    const parts = ['/* VoidFlippr - bundled CSS. Source: src/css/*.css */'];
    for (const name of CSS_ORDER) {
        const file = join(SRC, 'css', name);
        if (!existsSync(file)) {
            throw new Error(`Missing CSS file: ${file}`);
        }
        parts.push(`\n/* --- ${name} --- */\n${readFileSync(file, 'utf8')}`);
    }
    writeFileSync(join(DIST, 'css', 'style.css'), parts.join('\n'));
    log(`  css/style.css`);
}

/** Rewrite index.html to point at the bundled assets. */
function buildHtml() {
    let html = readFileSync(join(SRC, 'index.html'), 'utf8');

    // Replace the per-file stylesheet links with the single bundled one.
    html = html.replace(/[ \t]*<link rel="stylesheet" href="\/css\/[^"]+">\n?/g, '');
    html = html.replace('</head>', '    <link rel="stylesheet" href="/css/style.css">\n</head>');

    // Point the module entry at the bundle.
    html = html.replace(
        /<script type="module" src="\/js\/[^"]+"><\/script>/,
        '<script type="module" src="/js/main.js"></script>',
    );

    writeFileSync(join(DIST, 'index.html'), html);
    log(`  index.html`);
}

/**
 * Remove the individual source modules and stylesheets from dist/.
 * Only the bundled js/main.js and css/style.css should be shipped.
 */
function pruneSourceAssets() {
    for (const name of readdirSync(join(DIST, 'js'))) {
        if (name !== 'main.js') rmSync(join(DIST, 'js', name), { force: true });
    }
    for (const name of readdirSync(join(DIST, 'css'))) {
        if (name !== 'style.css') rmSync(join(DIST, 'css', name), { force: true });
    }
}

async function main() {
    if (!existsSync(SRC)) {
        console.error(`No src/ directory at ${SRC}`);
        process.exit(1);
    }

    // Clean slate so removed source files do not linger in dist/.
    cpSync(SRC, DIST, { recursive: true, force: true });

    const bundled = await bundleWithEsbuild();
    if (bundled) {
        log(`  js/main.js (${MINIFY ? 'minified' : 'readable'})`);
        buildCss();
        buildHtml();
        pruneSourceAssets();
    } else {
        log('  esbuild not installed - copied src/ as-is (run `npm install` to bundle).');
    }

    // The branded 404 page lives at the project root; ship a copy inside
    // dist/ so the folder can be deployed on its own.
    const notFound = join(ROOT, '404.html');
    if (existsSync(notFound)) {
        cpSync(notFound, join(DIST, '404.html'));
    }

    log(`\nBuild complete -> ${DIST}`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});