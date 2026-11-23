const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const app = express();
const PORT = process.env.PORT || 8001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://localhost,capacitor://localhost')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

const SCHOOL_LOCATION = {
  lat: -6.4012717,
  lng: 106.8089054
};

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOAD_DIR));

function getJakartaDate() {
  const now = new Date();
  return new Date(now.getTime() + 7 * 60 * 60 * 1000);
}

function getToday() {
  const jakartaNow = getJakartaDate();
  const year = jakartaNow.getUTCFullYear();
  const month = String(jakartaNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jakartaNow.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function countWorkdays(startDate, endDate) {
  let count = 0;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function isWeekday(dateString) {
  try {
    const d = new Date(dateString + 'T00:00:00');
    const day = d.getDay();
    return day !== 0 && day !== 6;
  } catch (err) {
    return false;
  }
}

function getAttendanceStatus(checkIn, jamMasukStandar = '07:30') {
  if (!checkIn) return 'Belum absen';
  const [inHour, inMinute] = checkIn.split(':').map(Number);
  const [stdHour, stdMinute] = jamMasukStandar.split(':').map(Number);
  if (inHour < stdHour || (inHour === stdHour && inMinute <= stdMinute)) return 'Hadir';
  return 'Terlambat';
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY || '',
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(path, { method = 'GET', body, query = {}, headers = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Konfigurasi server Supabase belum lengkap.');
    error.statusCode = 500;
    throw error;
  }

  const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path.replace(/^\/+/, '')}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const requestHeaders = getSupabaseHeaders({
    ...(method === 'GET' ? {} : { Prefer: 'return=representation' }),
    ...headers
  });

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    let errorMessage = `Supabase request failed (${response.status})`;
    try {
      const payload = JSON.parse(text);
      errorMessage = payload?.message || payload?.error || errorMessage;
    } catch (error) {
      // ignore parse issues and fall back to generic message
    }
    const error = new Error(errorMessage);
    error.statusCode = response.status;
    throw error;
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function mapProfileRecord(record) {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    username: record.username,
    school: record.school
  };
}

function mapAttendanceRecord(record) {
  return {
    id: record.id,
    userId: record.user_id,
    date: record.date,
    checkIn: record.check_in,
    checkOut: record.check_out,
    distanceMeters: record.distance_meters == null ? null : Number(record.distance_meters),
    jamMasukStandar: record.jam_masuk_standar || null
  };
}

function mapLeaveRecord(record) {
  return {
    id: record.id,
    userId: record.user_id,
    type: record.type,
    reason: record.reason,
    date: record.date,
    attachment: record.attachment || null,
    status: record.status,
    submittedAt: record.submitted_at
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (!storedPassword.startsWith('scrypt$')) {
    const providedHash = crypto.createHash('sha256').update(password).digest();
    const storedHash = crypto.createHash('sha256').update(storedPassword).digest();
    return crypto.timingSafeEqual(providedHash, storedHash);
  }

  const parts = storedPassword.split('$');
  if (parts.length !== 3) return false;

  const salt = parts[1];
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function getSessionUser(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = hashToken(match[1]);
  const sessionRows = await supabaseRequest('sessions', {
    query: {
      token_hash: `eq.${tokenHash}`,
      revoked_at: 'is.null',
      select: 'user_id'
    }
  });
  const session = Array.isArray(sessionRows) ? sessionRows[0] : sessionRows;
  if (!session?.user_id) return null;

  const userRows = await supabaseRequest('users', {
    query: {
      id: `eq.${session.user_id}`,
      select: 'id,username,name,role,school'
    }
  });
  const user = Array.isArray(userRows) ? userRows[0] : userRows;
  return user ? mapProfileRecord(user) : null;
}

async function requireSession(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ message: 'Sesi login tidak valid. Silakan login kembali.' });
      return null;
    }
    return user;
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Gagal memvalidasi sesi.' });
    return null;
  }
}

async function requireAdmin(req, res) {
  const user = await requireSession(req, res);
  if (!user) return null;
  if (user.role !== 'admin' && user.role !== 'principal') {
    res.status(403).json({ message: 'Akses khusus admin.' });
    return null;
  }
  return user;
}

async function getAttendanceForUserOnDate(userId, date) {
  const rows = await supabaseRequest('attendance', {
    query: {
      user_id: `eq.${userId}`,
      date: `eq.${date}`,
      select: 'id,user_id,date,check_in,check_out,distance_meters,jam_masuk_standar'
    }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function getJamMasukStandar() {
  try {
    const rows = await supabaseRequest('settings', {
      query: {
        key: `eq.jamMasukStandar`,
        select: 'value'
      }
    });
    const settingsRow = Array.isArray(rows) ? rows[0] : rows;
    return settingsRow?.value || '07:30';
  } catch (error) {
    return '07:30';
  }
}

async function getUserForLogin(username, password) {
  const rows = await supabaseRequest('users', {
    query: {
      username: `eq.${username}`,
      select: 'id,username,name,role,school,password,password_hash'
    }
  });

  const user = Array.isArray(rows) ? rows[0] : rows;
  if (!user) {
    return null;
  }

  const valid = await verifyPassword(password, user.password_hash || user.password);
  if (!valid) return null;

  if (!user.password_hash) {
    const passwordHash = await hashPassword(password);
    await supabaseRequest('users', {
      method: 'PATCH',
      query: { id: `eq.${user.id}` },
      body: { password_hash: passwordHash, password: null }
    });
  }

  return mapProfileRecord(user);
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await getUserForLogin(username, password);
    if (!user) {
      return res.status(401).json({ message: 'Username atau password salah.' });
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await supabaseRequest('sessions', {
      method: 'POST',
      body: [{
        token_hash: hashToken(sessionToken),
        user_id: user.id,
        revoked_at: null
      }]
    });
    return res.json({ user, sessionToken });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Login gagal.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  const user = await requireSession(req, res);
  if (!user) return;
  return res.json({ user });
});

app.post('/api/auth/logout', async (req, res) => {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    await supabaseRequest('sessions', {
      method: 'PATCH',
      query: { token_hash: `eq.${hashToken(match[1])}` },
      body: { revoked_at: new Date().toISOString() }
    }).catch(() => {});
  }
  return res.json({ success: true });
});

app.post('/api/admin/users/reset-password', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { username, newPassword } = req.body;
  if (!username || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ message: 'Username dan password baru minimal 6 karakter wajib diisi.' });
  }

  try {
    const userRows = await supabaseRequest('users', {
      query: {
        username: `eq.${username}`,
        select: 'id,username,name,role,school'
      }
    });
    const user = Array.isArray(userRows) ? userRows[0] : userRows;
    if (!user) return res.status(404).json({ message: 'Guru tidak ditemukan.' });

    const passwordHash = await hashPassword(newPassword);
    await supabaseRequest('users', {
      method: 'PATCH',
      query: { id: `eq.${user.id}` },
      body: { password_hash: passwordHash, password: null }
    });
    await supabaseRequest('sessions', {
      method: 'PATCH',
      query: { user_id: `eq.${user.id}`, revoked_at: 'is.null' },
      body: { revoked_at: new Date().toISOString() }
    }).catch(() => {});

    return res.json({ success: true, message: `Password ${username} berhasil diperbarui.` });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal reset password.' });
  }
});

app.get('/api/attendance/today', async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const today = getToday();
    const attendance = await getAttendanceForUserOnDate(sessionUser.id, today);
    const attendanceRecord = attendance ? mapAttendanceRecord(attendance) : null;
    return res.json({
      attendance: attendanceRecord,
      status: attendanceRecord ? getAttendanceStatus(attendanceRecord.checkIn, attendanceRecord.jamMasukStandar || jamMasukStandar) : 'Belum absen',
      today,
      jamMasukStandar
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil data absensi.' });
  }
});

app.post('/api/attendance/checkin', async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;
  const { latitude, longitude } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number'
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ message: 'Lokasi GPS wajib tersedia saat absen masuk.' });
  }

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const today = getToday();
    const profileRows = await supabaseRequest('users', {
      query: {
        id: `eq.${sessionUser.id}`,
        select: 'id'
      }
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
    if (!profile) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

    const existingQuery = {
      user_id: `eq.${sessionUser.id}`,
      date: `eq.${today}`,
      select: 'id'
    };
    const existingRows = await supabaseRequest('attendance', {
      query: existingQuery
    });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (existing) {
      return res.status(400).json({ message: 'Anda sudah absen masuk hari ini.' });
    }

    const jakartaNow = getJakartaDate();
    const checkIn = `${String(jakartaNow.getUTCHours()).padStart(2, '0')}:${String(jakartaNow.getUTCMinutes()).padStart(2, '0')}`;
    const distanceMeters = getDistanceMeters(latitude, longitude, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
    const insertedRows = await supabaseRequest('attendance', {
      method: 'POST',
      body: [{
        user_id: sessionUser.id,
        date: today,
        check_in: checkIn,
        check_out: null,
        distance_meters: Math.round(distanceMeters),
        jam_masuk_standar: jamMasukStandar
      }]
    });
    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    const mappedAttendance = mapAttendanceRecord(inserted);
    return res.json({ attendance: mappedAttendance, status: getAttendanceStatus(checkIn, jamMasukStandar) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal absen masuk.' });
  }
});

app.post('/api/attendance/checkout', async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;

  try {
    const today = getToday();
    const rows = await supabaseRequest('attendance', {
      query: {
        user_id: `eq.${sessionUser.id}`,
        date: `eq.${today}`,
        select: 'id,user_id,date,check_in,check_out,distance_meters,jam_masuk_standar'
      }
    });
    const record = Array.isArray(rows) ? rows[0] : rows;
    if (!record) {
      return res.status(400).json({ message: 'Belum melakukan absensi masuk hari ini.' });
    }
    if (record.check_out) {
      return res.status(400).json({ message: 'Anda sudah absen pulang hari ini.' });
    }

    const jakartaNow = getJakartaDate();
    const checkOut = `${String(jakartaNow.getUTCHours()).padStart(2, '0')}:${String(jakartaNow.getUTCMinutes()).padStart(2, '0')}`;
    const updatedRows = await supabaseRequest('attendance', {
      method: 'PATCH',
      query: {
        id: `eq.${record.id}`
      },
      body: {
        check_out: checkOut
      }
    });
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
    return res.json({ attendance: mapAttendanceRecord(updated || { ...record, check_out: checkOut }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal absen pulang.' });
  }
});

app.get('/api/attendance/history', async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const rows = await supabaseRequest('attendance', {
      query: {
        user_id: `eq.${sessionUser.id}`,
        select: 'id,user_id,date,check_in,check_out,distance_meters,jam_masuk_standar'
      }
    });
    const records = (Array.isArray(rows) ? rows : []).map(mapAttendanceRecord).sort((a, b) => b.date.localeCompare(a.date));
    return res.json({ history: records, jamMasukStandar });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil riwayat absensi.' });
  }
});

app.post('/api/leaves', upload.single('attachment'), async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;
  const { type, date, reason } = req.body;

  try {
    const profileRows = await supabaseRequest('users', {
      query: {
        id: `eq.${sessionUser.id}`,
        select: 'id'
      }
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
    if (!profile) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

    const attachment = req.file ? `/uploads/${req.file.filename}` : null;
    const insertedRows = await supabaseRequest('leaves', {
      method: 'POST',
      body: [{
        user_id: sessionUser.id,
        type,
        reason,
        date,
        attachment: attachment,
        status: 'Menunggu'
      }]
    });
    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    return res.json({ leave: mapLeaveRecord(inserted) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengirim izin.' });
  }
});

app.get('/api/leaves', async (req, res) => {
  const sessionUser = await requireSession(req, res);
  if (!sessionUser) return;

  try {
    const rows = await supabaseRequest('leaves', {
      query: {
        user_id: `eq.${sessionUser.id}`,
        select: 'id,user_id,type,reason,date,attachment,status,submitted_at'
      }
    });
    const leaves = (Array.isArray(rows) ? rows : []).map(mapLeaveRecord).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return res.json({ leaves });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil data izin.' });
  }
});

app.get('/api/admin/monitoring', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const date = req.query.date || getToday();

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const teacherRows = await supabaseRequest('users', {
      query: {
        role: 'eq.teacher',
        select: 'id,name,role,username,school'
      }
    });
    const teachers = (Array.isArray(teacherRows) ? teacherRows : []).map(mapProfileRecord);
    const attendanceRows = await supabaseRequest('attendance', {
      query: {
        date: `eq.${date}`,
        select: 'id,user_id,date,check_in,check_out,distance_meters,jam_masuk_standar'
      }
    });
    const attendances = (Array.isArray(attendanceRows) ? attendanceRows : []).map(mapAttendanceRecord);
    const leaveRows = await supabaseRequest('leaves', {
      query: {
        date: `eq.${date}`,
        select: 'id,user_id,type,date,reason,attachment,status,submitted_at'
      }
    });
    const leaves = (Array.isArray(leaveRows) ? leaveRows : []).map(mapLeaveRecord);

    const hadir = attendances.filter((record) => record.checkIn && getAttendanceStatus(record.checkIn, record.jamMasukStandar || jamMasukStandar) === 'Hadir').length;
    const terlambat = attendances.filter((record) => record.checkIn && getAttendanceStatus(record.checkIn, record.jamMasukStandar || jamMasukStandar) === 'Terlambat').length;
    const izinSakit = leaves.length;
    const belumAbsen = teachers.length - attendances.length;
    const table = teachers.map((teacher) => {
      const record = attendances.find((item) => item.userId === teacher.id);
      const leave = leaves.find((item) => item.userId === teacher.id);
      if (leave) {
        return {
          name: teacher.name,
          checkIn: '--:--',
          checkOut: '--:--',
          status: leave.type === 'sakit' || leave.type === 'izin' ? leave.type.charAt(0).toUpperCase() + leave.type.slice(1) : 'Izin'
        };
      }
      if (record) {
        return {
          name: teacher.name,
          checkIn: record.checkIn,
          checkOut: record.checkOut || '--:--',
          status: getAttendanceStatus(record.checkIn, record.jamMasukStandar || jamMasukStandar)
        };
      }
      return {
        name: teacher.name,
        checkIn: '--:--',
        checkOut: '--:--',
        status: 'Belum absen'
      };
    });
    return res.json({ date, summary: { hadir, terlambat, izinSakit, belumAbsen }, table });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil monitoring.' });
  }
});


app.get('/api/export/rekap', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'startDate dan endDate wajib diisi (format YYYY-MM-DD).' });
  }

  try {
    const jamMasukStandar = await getJamMasukStandar();

    const teacherRows = await supabaseRequest('users', {
      query: { role: 'eq.teacher', select: 'id,name,role,username,school' }
    });
    const teachers = (Array.isArray(teacherRows) ? teacherRows : []).map(mapProfileRecord);

    const attendanceRows = await supabaseRequest('attendance', {
      query: {
        and: `(date.gte.${startDate},date.lte.${endDate})`,
        select: 'id,user_id,date,check_in,check_out,distance_meters,jam_masuk_standar'
      }
    });
    const attendances = (Array.isArray(attendanceRows) ? attendanceRows : []).map(mapAttendanceRecord);
    // Hanya pertimbangkan attendance pada hari kerja (Senin-Jumat)
    const attendancesWeekday = attendances.filter((a) => isWeekday(a.date));

    const leaveRows = await supabaseRequest('leaves', {
      query: {
        and: `(date.gte.${startDate},date.lte.${endDate})`,
        select: 'id,user_id,type,date,reason,attachment,status,submitted_at'
      }
    });
    const leaves = (Array.isArray(leaveRows) ? leaveRows : []).map(mapLeaveRecord);

    const hariKerja = countWorkdays(startDate, endDate);

    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet('Ringkasan');
    summarySheet.columns = [
      { header: 'Guru', key: 'guru', width: 28 },
      { header: 'Hari Kerja', key: 'hariKerja', width: 12 },
      { header: 'Hadir', key: 'hadir', width: 10 },
      { header: 'Terlambat', key: 'terlambat', width: 12 },
      { header: 'Izin', key: 'izin', width: 10 },
      { header: 'Sakit', key: 'sakit', width: 10 },
      { header: 'Tidak Absen', key: 'mangkir', width: 14 },
      { header: 'Jarak Absen Masuk (m)', key: 'jarakMasuk', width: 22 }
    ];

    const detailSheet = workbook.addWorksheet('Detail');
    detailSheet.columns = [
      { header: 'Guru', key: 'guru', width: 28 },
      { header: 'Tanggal', key: 'tanggal', width: 14 },
      { header: 'Masuk', key: 'masuk', width: 12 },
      { header: 'Pulang', key: 'pulang', width: 12 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Jarak Absen Masuk (m)', key: 'jarakMasuk', width: 22 }
    ];

    teachers.forEach((teacher) => {
      const teacherAttendance = attendancesWeekday.filter((a) => a.userId === teacher.id);
      const teacherLeaves = leaves.filter((l) => l.userId === teacher.id);

      const hadir = teacherAttendance.filter((a) => getAttendanceStatus(a.checkIn, a.jamMasukStandar || jamMasukStandar) === 'Hadir').length;
      const terlambat = teacherAttendance.filter((a) => getAttendanceStatus(a.checkIn, a.jamMasukStandar || jamMasukStandar) === 'Terlambat').length;
      const izin = teacherLeaves.filter((l) => l.type === 'izin').length;
      const sakit = teacherLeaves.filter((l) => l.type === 'sakit').length;
      const mangkir = Math.max(0, hariKerja - hadir - terlambat - izin - sakit);

      const firstAttendance = teacherAttendance.find((record) => record.distanceMeters != null);
      summarySheet.addRow({
        guru: teacher.name,
        hariKerja,
        hadir,
        terlambat,
        izin,
        sakit,
        mangkir,
        jarakMasuk: firstAttendance?.distanceMeters ?? '--'
      });

      // Untuk sheet Detail, jangan sertakan baris pada weekend
      const teacherLeavesForDetail = teacherLeaves.filter((l) => isWeekday(l.date));
      const combinedRecords = [
        ...teacherAttendance.map((a) => ({
          date: a.date,
          masuk: a.checkIn || '--:--',
          pulang: a.checkOut || '--:--',
          status: getAttendanceStatus(a.checkIn, a.jamMasukStandar || jamMasukStandar),
          distanceMeters: a.distanceMeters
        })),
        ...teacherLeavesForDetail.map((l) => ({
          date: l.date,
          masuk: '--:--',
          pulang: '--:--',
          status: l.type === 'sakit' ? 'Sakit' : 'Izin',
          distanceMeters: null
        }))
      ].sort((a, b) => a.date.localeCompare(b.date));

      combinedRecords.forEach((record) => {
        detailSheet.addRow({
          guru: teacher.name,
          tanggal: record.date,
          masuk: record.masuk,
          pulang: record.pulang,
          status: record.status,
          jarakMasuk: record.distanceMeters == null ? '--' : record.distanceMeters
        });
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=rekap-absensi-${startDate}_${endDate}.xlsx`);
    res.send(buffer);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal membuat rekap.' });
  }
});

app.get('/api/admin/settings', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const jamMasukStandar = await getJamMasukStandar();
    return res.json({ settings: { jamMasukStandar } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil pengaturan.' });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { jamMasukStandar } = req.body;
  if (!jamMasukStandar || !/^\d{2}:\d{2}$/.test(jamMasukStandar)) {
    return res.status(400).json({ message: 'Format jamMasukStandar tidak valid. Gunakan HH:MM.' });
  }

  try {
    // Periksa apakah entry dengan key 'jamMasukStandar' sudah ada
    const existingRows = await supabaseRequest('settings', {
      query: {
        key: `eq.jamMasukStandar`,
        select: 'key,value'
      }
    });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (existing) {
      // PATCH value
      await supabaseRequest('settings', {
        method: 'PATCH',
        query: {
          key: `eq.jamMasukStandar`
        },
        body: {
          value: jamMasukStandar
        }
      });
    } else {
      // INSERT new key/value row
      await supabaseRequest('settings', {
        method: 'POST',
        body: [{
          key: 'jamMasukStandar',
          value: jamMasukStandar
        }]
      });
    }
    return res.json({ settings: { jamMasukStandar } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal menyimpan pengaturan.' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});

module.exports = app;
