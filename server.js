const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 8001;
const DATA_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

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

function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      users: [
        {
          id: 'guru1',
          name: 'Bu Siti Aminah',
          role: 'teacher',
          username: 'siti',
          password: 'guru123',
          school: 'Taman Main Darussalam'
        },
        {
          id: 'admin1',
          name: 'Admin Sekolah',
          role: 'admin',
          username: 'admin',
          password: 'admin123'
        }
      ],
      attendance: [],
      leaves: [],
      settings: {
        jamMasukStandar: '08:30'
      }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  if (!data.settings) {
    data.settings = { jamMasukStandar: '08:30' };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
  return data;
}

function saveDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getJamMasukStandar(db) {
  return db?.settings?.jamMasukStandar || '08:30';
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAttendanceStatus(checkIn, jamMasukStandar = '08:30') {
  if (!checkIn) return 'Belum absen';
  const [inHour, inMinute] = checkIn.split(':').map(Number);
  const [stdHour, stdMinute] = jamMasukStandar.split(':').map(Number);
  if (inHour < stdHour || (inHour === stdHour && inMinute <= stdMinute)) return 'Hadir';
  return 'Terlambat';
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  const user = db.users.find((u) => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ message: 'Username atau password salah.' });
  }
  const { password: _, ...safeUser } = user;
  return res.json({ user: safeUser });
});

app.get('/api/attendance/today', (req, res) => {
  const { userId } = req.query;
  const db = loadDB();
  const jamMasukStandar = getJamMasukStandar(db);
  const today = getToday();
  const attendance = db.attendance.find((item) => item.userId === userId && item.date === today);
  return res.json({
    attendance: attendance || null,
    status: attendance ? getAttendanceStatus(attendance.checkIn, jamMasukStandar) : 'Belum absen',
    today,
    jamMasukStandar
  });
});

app.post('/api/attendance/checkin', (req, res) => {
  const { userId } = req.body;
  const db = loadDB();
  const jamMasukStandar = getJamMasukStandar(db);
  const today = getToday();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
  const existing = db.attendance.find((item) => item.userId === userId && item.date === today);
  if (existing) {
    return res.status(400).json({ message: 'Anda sudah absen masuk hari ini.' });
  }
  const now = new Date();
  const checkIn = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const attendance = { id: uuidv4(), userId, date: today, checkIn, checkOut: null };
  db.attendance.push(attendance);
  saveDB(db);
  return res.json({ attendance, status: getAttendanceStatus(checkIn, jamMasukStandar) });
});

app.post('/api/attendance/checkout', (req, res) => {
  const { userId } = req.body;
  const db = loadDB();
  const today = getToday();
  const record = db.attendance.find((item) => item.userId === userId && item.date === today);
  if (!record) {
    return res.status(400).json({ message: 'Belum melakukan absensi masuk hari ini.' });
  }
  if (record.checkOut) {
    return res.status(400).json({ message: 'Anda sudah absen pulang hari ini.' });
  }
  const now = new Date();
  record.checkOut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  saveDB(db);
  return res.json({ attendance: record });
});

app.get('/api/attendance/history', (req, res) => {
  const { userId } = req.query;
  const db = loadDB();
  const records = db.attendance.filter((item) => item.userId === userId).sort((a, b) => b.date.localeCompare(a.date));
  return res.json({ history: records, jamMasukStandar: getJamMasukStandar(db) });
});

app.post('/api/leaves', upload.single('attachment'), (req, res) => {
  const { userId, type, date, reason } = req.body;
  const db = loadDB();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
  const attachment = req.file ? `/uploads/${req.file.filename}` : null;
  const leave = {
    id: uuidv4(),
    userId,
    type,
    reason,
    date,
    attachment,
    status: 'Menunggu',
    submittedAt: new Date().toISOString()
  };
  db.leaves.push(leave);
  saveDB(db);
  return res.json({ leave });
});

app.get('/api/leaves', (req, res) => {
  const { userId } = req.query;
  const db = loadDB();
  const leaves = db.leaves.filter((item) => item.userId === userId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return res.json({ leaves });
});

app.get('/api/admin/monitoring', (req, res) => {
  const date = req.query.date || getToday();
  const db = loadDB();
  const jamMasukStandar = getJamMasukStandar(db);
  const teachers = db.users.filter((user) => user.role === 'teacher');
  const attendances = db.attendance.filter((record) => record.date === date);
  const leaves = db.leaves.filter((leave) => leave.date === date);
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
});

app.get('/api/export', async (req, res) => {
  const date = req.query.date || getToday();
  const db = loadDB();
  const teachers = db.users.filter((user) => user.role === 'teacher');
  const attendances = db.attendance.filter((record) => record.date === date);
  const leaves = db.leaves.filter((leave) => leave.date === date);
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
});

app.get('/api/admin/settings', (req, res) => {
  const db = loadDB();
  return res.json({ settings: db.settings || { jamMasukStandar: '08:30' } });
});

app.post('/api/admin/settings', (req, res) => {
  const { jamMasukStandar } = req.body;
  if (!jamMasukStandar || !/^\d{2}:\d{2}$/.test(jamMasukStandar)) {
    return res.status(400).json({ message: 'Format jamMasukStandar tidak valid. Gunakan HH:MM.' });
  }
  const db = loadDB();
  db.settings = db.settings || {};
  db.settings.jamMasukStandar = jamMasukStandar;
  saveDB(db);
  return res.json({ settings: db.settings });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
