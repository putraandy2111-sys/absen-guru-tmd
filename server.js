const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

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

function getAttendanceStatus(checkIn, jamMasukStandar = '08:30') {
  if (!checkIn) return 'Belum absen';
  const [inHour, inMinute] = checkIn.split(':').map(Number);
  const [stdHour, stdMinute] = jamMasukStandar.split(':').map(Number);
  if (inHour < stdHour || (inHour === stdHour && inMinute <= stdMinute)) return 'Hadir';
  return 'Terlambat';
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY || '',
    Authorization: `Bearer ${SUPABASE_ANON_KEY || ''}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(path, { method = 'GET', body, query = {}, headers = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error('Konfigurasi Supabase belum lengkap.');
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
    checkOut: record.check_out
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

async function getAttendanceForUserOnDate(userId, date) {
  const rows = await supabaseRequest('attendance', {
    query: {
      user_id: `eq.${userId}`,
      date: `eq.${date}`,
      select: 'id,user_id,date,check_in,check_out'
    }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function getJamMasukStandar() {
  try {
    const rows = await supabaseRequest('settings', {
      query: {
        id: 'eq.1',
        select: 'jam_masuk_standar'
      }
    });
    const settingsRow = Array.isArray(rows) ? rows[0] : rows;
    return settingsRow?.jam_masuk_standar || '08:30';
  } catch (error) {
    return '08:30';
  }
}

async function getUserForLogin(username, password) {
  const rows = await supabaseRequest('users', {
    query: {
      username: `eq.${username}`,
      password: `eq.${password}`,
      select: 'id,username,name,role,school,password'
    }
  });

  const user = Array.isArray(rows) ? rows[0] : rows;
  if (!user) {
    return null;
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
    return res.json({ user });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Login gagal.' });
  }
});

app.get('/api/attendance/today', async (req, res) => {
  const { userId } = req.query;

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const today = getToday();
    const attendance = await getAttendanceForUserOnDate(userId, today);
    return res.json({
      attendance: attendance ? mapAttendanceRecord(attendance) : null,
      status: attendance ? getAttendanceStatus(attendance.check_in, jamMasukStandar) : 'Belum absen',
      today,
      jamMasukStandar
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil data absensi.' });
  }
});

app.post('/api/attendance/checkin', async (req, res) => {
  const { userId } = req.body;

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const today = getToday();
    const profileRows = await supabaseRequest('users', {
      query: {
        id: `eq.${userId}`,
        select: 'id'
      }
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
    if (!profile) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

    const existingQuery = {
      user_id: `eq.${userId}`,
      date: `eq.${today}`,
      select: 'id'
    };
    const existingUrl = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/attendance`);
    Object.entries(existingQuery).forEach(([key, value]) => existingUrl.searchParams.set(key, value));
    console.log('CHECKIN EXISTING QUERY:', {
      userId: userId,
      userIdType: typeof userId,
      today,
      url: existingUrl.toString()
    });

    const existingRows = await supabaseRequest('attendance', {
      query: existingQuery
    });
    console.log('CHECKIN EXISTING RESULT:', { existingRows });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (existing) {
      return res.status(400).json({ message: 'Anda sudah absen masuk hari ini.' });
    }

    const jakartaNow = getJakartaDate();
    const checkIn = `${String(jakartaNow.getUTCHours()).padStart(2, '0')}:${String(jakartaNow.getUTCMinutes()).padStart(2, '0')}`;
    const insertedRows = await supabaseRequest('attendance', {
      method: 'POST',
      body: [{
        user_id: userId,
        date: today,
        check_in: checkIn,
        check_out: null
      }]
    });
    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    console.log('CHECKIN INSERTED ROWS:', { insertedRows });
    let mappedAttendance;
    try {
      mappedAttendance = mapAttendanceRecord(inserted);
      console.log('CHECKIN MAPPED ATTENDANCE:', { mappedAttendance });
    } catch (error) {
      console.error('CHECKIN MAPPING ERROR:', error);
      throw error;
    }
    return res.json({ attendance: mappedAttendance, status: getAttendanceStatus(checkIn, jamMasukStandar) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal absen masuk.' });
  }
});

app.post('/api/attendance/checkout', async (req, res) => {
  const { userId } = req.body;

  try {
    const today = getToday();
    const rows = await supabaseRequest('attendance', {
      query: {
        user_id: `eq.${userId}`,
        date: `eq.${today}`,
        select: 'id,user_id,date,check_in,check_out'
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
  const { userId } = req.query;

  try {
    const jamMasukStandar = await getJamMasukStandar();
    const rows = await supabaseRequest('attendance', {
      query: {
        user_id: `eq.${userId}`,
        select: 'id,user_id,date,check_in,check_out'
      }
    });
    const records = (Array.isArray(rows) ? rows : []).map(mapAttendanceRecord).sort((a, b) => b.date.localeCompare(a.date));
    return res.json({ history: records, jamMasukStandar });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil riwayat absensi.' });
  }
});

app.post('/api/leaves', upload.single('attachment'), async (req, res) => {
  const { userId, type, date, reason } = req.body;

  try {
    const profileRows = await supabaseRequest('users', {
      query: {
        id: `eq.${userId}`,
        select: 'id'
      }
    });
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
    if (!profile) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

    const attachment = req.file ? `/uploads/${req.file.filename}` : null;
    const insertedRows = await supabaseRequest('leaves', {
      method: 'POST',
      body: [{
        user_id: userId,
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
  const { userId } = req.query;

  try {
    const rows = await supabaseRequest('leaves', {
      query: {
        user_id: `eq.${userId}`,
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
        select: 'id,user_id,date,check_in,check_out'
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

    const hadir = attendances.filter((record) => record.checkIn && getAttendanceStatus(record.checkIn, jamMasukStandar) === 'Hadir').length;
    const terlambat = attendances.filter((record) => record.checkIn && getAttendanceStatus(record.checkIn, jamMasukStandar) === 'Terlambat').length;
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
          status: getAttendanceStatus(record.checkIn, jamMasukStandar)
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

app.get('/api/export', async (req, res) => {
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
        select: 'id,user_id,date,check_in,check_out'
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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Monitoring');
    sheet.columns = [
      { header: 'Guru', key: 'guru', width: 28 },
      { header: 'Masuk', key: 'masuk', width: 15 },
      { header: 'Pulang', key: 'pulang', width: 15 },
      { header: 'Status', key: 'status', width: 18 }
    ];
    teachers.forEach((teacher) => {
      const record = attendances.find((item) => item.userId === teacher.id);
      const leave = leaves.find((item) => item.userId === teacher.id);
      if (leave) {
        sheet.addRow({ guru: teacher.name, masuk: '--:--', pulang: '--:--', status: leave.type === 'sakit' ? 'Sakit' : 'Izin' });
      } else if (record) {
        sheet.addRow({ guru: teacher.name, masuk: record.checkIn || '--:--', pulang: record.checkOut || '--:--', status: getAttendanceStatus(record.checkIn, jamMasukStandar) });
      } else {
        sheet.addRow({ guru: teacher.name, masuk: '--:--', pulang: '--:--', status: 'Belum absen' });
      }
    });
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=monitoring-${date}.xlsx`);
    res.send(buffer);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengekspor data.' });
  }
});

app.get('/api/export/rekap', async (req, res) => {
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
        select: 'id,user_id,date,check_in,check_out'
      }
    });
    const attendances = (Array.isArray(attendanceRows) ? attendanceRows : []).map(mapAttendanceRecord);

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
      { header: 'Tidak Absen', key: 'mangkir', width: 14 }
    ];

    const detailSheet = workbook.addWorksheet('Detail');
    detailSheet.columns = [
      { header: 'Guru', key: 'guru', width: 28 },
      { header: 'Tanggal', key: 'tanggal', width: 14 },
      { header: 'Masuk', key: 'masuk', width: 12 },
      { header: 'Pulang', key: 'pulang', width: 12 },
      { header: 'Status', key: 'status', width: 16 }
    ];

    teachers.forEach((teacher) => {
      const teacherAttendance = attendances.filter((a) => a.userId === teacher.id);
      const teacherLeaves = leaves.filter((l) => l.userId === teacher.id);

      const hadir = teacherAttendance.filter((a) => getAttendanceStatus(a.checkIn, jamMasukStandar) === 'Hadir').length;
      const terlambat = teacherAttendance.filter((a) => getAttendanceStatus(a.checkIn, jamMasukStandar) === 'Terlambat').length;
      const izin = teacherLeaves.filter((l) => l.type === 'izin').length;
      const sakit = teacherLeaves.filter((l) => l.type === 'sakit').length;
      const mangkir = Math.max(0, hariKerja - hadir - terlambat - izin - sakit);

      summarySheet.addRow({ guru: teacher.name, hariKerja, hadir, terlambat, izin, sakit, mangkir });

      const combinedRecords = [
        ...teacherAttendance.map((a) => ({
          date: a.date,
          masuk: a.checkIn || '--:--',
          pulang: a.checkOut || '--:--',
          status: getAttendanceStatus(a.checkIn, jamMasukStandar)
        })),
        ...teacherLeaves.map((l) => ({
          date: l.date,
          masuk: '--:--',
          pulang: '--:--',
          status: l.type === 'sakit' ? 'Sakit' : 'Izin'
        }))
      ].sort((a, b) => a.date.localeCompare(b.date));

      combinedRecords.forEach((record) => {
        detailSheet.addRow({ guru: teacher.name, tanggal: record.date, masuk: record.masuk, pulang: record.pulang, status: record.status });
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
  try {
    const jamMasukStandar = await getJamMasukStandar();
    return res.json({ settings: { jamMasukStandar } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Gagal mengambil pengaturan.' });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  const { jamMasukStandar } = req.body;
  if (!jamMasukStandar || !/^\d{2}:\d{2}$/.test(jamMasukStandar)) {
    return res.status(400).json({ message: 'Format jamMasukStandar tidak valid. Gunakan HH:MM.' });
  }

  try {
    const existingRows = await supabaseRequest('settings', {
      query: {
        id: 'eq.1',
        select: 'id'
      }
    });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (existing) {
      await supabaseRequest('settings', {
        method: 'PATCH',
        query: {
          id: 'eq.1'
        },
        body: {
          jam_masuk_standar: jamMasukStandar
        }
      });
    } else {
      await supabaseRequest('settings', {
        method: 'POST',
        body: [{
          id: 1,
          jam_masuk_standar: jamMasukStandar
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
