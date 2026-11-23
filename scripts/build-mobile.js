const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'www');
const files = [
  'index.html',
  'styles.css',
  'script.js',
  'manifest.json',
  'sw.js'
];

const apiBaseUrl = new URL(process.env.CAPACITOR_API_URL || 'https://absen.tmd.com');
if (apiBaseUrl.protocol !== 'https:' || apiBaseUrl.pathname !== '/' || apiBaseUrl.search || apiBaseUrl.hash) {
  throw new Error('CAPACITOR_API_URL harus berupa URL origin HTTPS, misalnya https://absen.tmd.com');
}

fs.mkdirSync(webDir, { recursive: true });

files.forEach((file) => {
  fs.copyFileSync(path.join(root, file), path.join(webDir, file));
});

fs.writeFileSync(
  path.join(webDir, 'app-config.js'),
  `window.APP_CONFIG = ${JSON.stringify({ apiBaseUrl: apiBaseUrl.origin, isNative: true })};\n`
);
fs.cpSync(path.join(root, 'public'), path.join(webDir, 'public'), { recursive: true });
console.log(`Mobile web assets copied to ${webDir}`);
