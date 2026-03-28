/**
 * Build script for Tauri frontend.
 *
 * Assembles all frontend assets into dist-tauri/ — a flat directory that
 * Tauri bundles into the binary. This avoids path issues with node_modules
 * and dist/ being outside the frontendDist root.
 *
 * Steps:
 *   1. Bundle renderer.js via esbuild
 *   2. Copy index.html (rewritten for flat paths + tauri bridge)
 *   3. Copy styles.css, tauri-bridge.js
 *   4. Copy xterm.css from node_modules
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-tauri');

// 1. Ensure output dir
fs.mkdirSync(OUT, { recursive: true });

// 2. Bundle renderer
console.log('[tauri] Bundling renderer.js...');
execSync('npx esbuild src/renderer.js --bundle --outfile=dist-tauri/renderer.js --platform=browser --format=iife', {
  cwd: ROOT,
  stdio: 'inherit',
});

// 3. Copy static assets
const copies = [
  ['src/styles.css', 'styles.css'],
  ['src/tauri-bridge.js', 'tauri-bridge.js'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['eventide.png', 'eventide.png'],
];

for (const [src, dest] of copies) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(OUT, dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`[tauri] Copied ${src} -> dist-tauri/${dest}`);
  } else {
    console.warn(`[tauri] Warning: ${src} not found, skipping`);
  }
}

// 4. Generate index.html with flat paths and Tauri bridge
console.log('[tauri] Generating index.html...');
let html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');

// Rewrite asset paths to flat structure
html = html.replace('../node_modules/@xterm/xterm/css/xterm.css', 'xterm.css');
html = html.replace('"styles.css"', '"styles.css"'); // already flat — no-op
html = html.replace('../dist/renderer.js', 'renderer.js');

// Inject Tauri bridge script before renderer
html = html.replace(
  '<script src="renderer.js"></script>',
  '<script src="tauri-bridge.js"></script>\n  <script src="renderer.js"></script>'
);

// Update CSP to allow Tauri IPC
html = html.replace(
  /content="default-src 'self';[^"]*"/,
  'content="default-src \'self\' ipc: tauri:; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; img-src \'self\' data: asset: tauri:; connect-src ipc: tauri: https:"'
);

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log('[tauri] Frontend build complete -> dist-tauri/');
