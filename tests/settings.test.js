const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'db.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260930_snapshot_attendance_standard.sql'), 'utf8');

assert.ok(db.settings && db.settings.jamMasukStandar === '07:30', 'db.json harus punya settings.jamMasukStandar default 07:30');
assert.match(server, /async function getJamMasukStandar\(\)/, 'server.js harus menyediakan getJamMasukStandar tanpa argumen');
assert.ok(server.includes("select: 'value'"), 'getJamMasukStandar harus membaca kolom value');
assert.ok(server.includes("app.get('/api/admin/settings'"), 'server.js harus punya endpoint GET /api/admin/settings');
assert.ok(server.includes("app.post('/api/admin/settings'"), 'server.js harus punya endpoint POST /api/admin/settings');
assert.ok(schema.includes('key text primary key'), 'Schema settings harus memakai key sebagai primary key');
assert.ok(schema.includes('value text not null'), 'Schema settings harus memakai value sebagai teks wajib');
assert.ok(!schema.includes('jam_masuk_standar text not null'), 'Schema lama settings jam_masuk_standar tidak boleh tetap dipakai');
assert.ok(!migration.includes('08:30'), 'Migration tidak boleh mempertahankan default lama 08:30');

console.log('Settings test OK');
