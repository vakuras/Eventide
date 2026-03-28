/**
 * Cleanup script — removes Electron-specific files after Tauri migration is complete.
 *
 * Run this ONLY after verifying the Tauri build works end-to-end.
 *   node scripts/cleanup-electron.js
 *
 * Files removed:
 *   - src/main.js              (Electron main process)
 *   - src/preload.js           (Electron IPC bridge — replaced by tauri-bridge.js)
 *   - src/notification-popup.html  (Electron BrowserWindow popup)
 *   - src/notification-popup-preload.js
 *   - src/update-service.js    (electron-updater — replaced by Tauri updater)
 *   - launch.vbs               (Windows Electron launcher)
 *
 * Dependencies removed from package.json:
 *   - electron, electron-builder, electron-updater, node-pty
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES_TO_REMOVE = [
  'src/main.js',
  'src/preload.js',
  'src/notification-popup.html',
  'src/notification-popup-preload.js',
  'src/update-service.js',
  'launch.vbs',
];

console.log('[cleanup] Removing Electron-specific files...');
for (const file of FILES_TO_REMOVE) {
  const filePath = path.join(ROOT, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`  Removed ${file}`);
  } else {
    console.log(`  Skipped ${file} (not found)`);
  }
}

// Remove Electron deps from package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const ELECTRON_DEPS = ['electron-updater', 'node-pty'];
const ELECTRON_DEV_DEPS = ['electron', 'electron-builder'];

let changed = false;
for (const dep of ELECTRON_DEPS) {
  if (pkg.dependencies && pkg.dependencies[dep]) {
    delete pkg.dependencies[dep];
    console.log(`  Removed dependency: ${dep}`);
    changed = true;
  }
}
for (const dep of ELECTRON_DEV_DEPS) {
  if (pkg.devDependencies && pkg.devDependencies[dep]) {
    delete pkg.devDependencies[dep];
    console.log(`  Removed devDependency: ${dep}`);
    changed = true;
  }
}

// Remove Electron-only scripts
const ELECTRON_SCRIPTS = ['start', 'launch', 'dist'];
for (const script of ELECTRON_SCRIPTS) {
  if (pkg.scripts && pkg.scripts[script]) {
    delete pkg.scripts[script];
    console.log(`  Removed script: ${script}`);
    changed = true;
  }
}

// Remove electron-builder "build" config
if (pkg.build) {
  delete pkg.build;
  console.log('  Removed electron-builder "build" config');
  changed = true;
}

if (changed) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('[cleanup] Updated package.json');
}

console.log('[cleanup] Done. Run `npm install` to update node_modules.');
