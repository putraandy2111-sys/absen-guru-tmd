const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'db.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.ok(db.settings && db.settings.jamMasukStandar === '08:30', 'db.json harus punya settings.jamMasukStandar default 08:30');
assert.ok(server.includes('getJamMasukStandar(db)'), 'server.js harus menggunakan getJamMasukStandar(db)');
assert.ok(server.includes("app.get('/api/admin/settings'"), 'server.js harus punya endpoint GET /api/admin/settings');
assert.ok(server.includes("app.post('/api/admin/settings'"), 'server.js harus punya endpoint POST /api/admin/settings');

console.log('Settings test OK');
