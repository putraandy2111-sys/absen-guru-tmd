const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

assert.ok(html.includes('id="backFromHistory"'), 'History harus punya tombol kembali dengan id backFromHistory');
assert.ok(html.includes('id="backFromMonitoring"'), 'Monitoring harus punya tombol kembali dengan id backFromMonitoring');
assert.ok(/class="home-menu-card[^\n]*data-section="home"/.test(html), 'Tombol Absen di home harus memakai class home-menu-card dan data-section="home"');
assert.ok(script.includes("document.querySelectorAll('.home-menu-card')"), 'Script harus mengikat listener ke tombol home-menu-card');
assert.match(script, /backFromHistory\?\.addEventListener\('click', \(\) => \{\s*showSection\('home'\);\s*loadHome\(\);\s*\}\);/s, 'Listener tombol kembali harus memanggil showSection(home) dan loadHome()');
assert.match(script, /backFromMonitoring\?\.addEventListener\('click', \(\) => \{\s*showSection\('home'\);\s*loadHome\(\);\s*\}\);/s, 'Listener monitoring harus memanggil showSection(home) dan loadHome()');

console.log('Semua verifikasi UI terpenuhi.');
