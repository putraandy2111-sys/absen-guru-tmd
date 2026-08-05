const appState = {
  user: null,
  today: null,
  leaveType: 'sakit',
  jamMasukStandar: '08:30'
};

const logoutButton = document.getElementById('logoutButton');
const navLinks = Array.from(document.querySelectorAll('.nav-link'));
const sections = Array.from(document.querySelectorAll('.page-section'));
const homeName = document.getElementById('homeName');
const homeSchool = document.getElementById('homeSchool');
const homeAvatar = document.getElementById('homeAvatar');
const attendanceLabel = document.getElementById('attendanceLabel');
const attendanceTime = document.getElementById('attendanceTime');
const locationLabel = document.querySelector('.attendance-location .location-label');
const locationDistance = document.querySelector('.attendance-location .location-distance');
const checkInButton = document.getElementById('checkInButton');
const checkOutButton = document.getElementById('checkOutButton');
const homeMenuButtons = Array.from(document.querySelectorAll('.home-menu-card'));
const loginForm = document.getElementById('loginForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const leaveForm = document.getElementById('leaveForm');
const leaveTypeButtons = Array.from(document.querySelectorAll('#leaveTypeRow .pill'));
const leaveDate = document.getElementById('leaveDate');
const leaveReason = document.getElementById('leaveReason');
const leaveAttachment = document.getElementById('leaveAttachment');
const historyPresent = document.getElementById('historyPresent');
const historyLate = document.getElementById('historyLate');
const historyLeave = document.getElementById('historyLeave');
const historyAbsent = document.getElementById('historyAbsent');
const historyList = document.getElementById('historyList');
const leaveList = document.getElementById('leaveList');
const adminTableBody = document.getElementById('adminTableBody');
const monitorPresent = document.getElementById('monitorPresent');
const monitorLate = document.getElementById('monitorLate');
const monitorLeave = document.getElementById('monitorLeave');
const monitorAbsent = document.getElementById('monitorAbsent');
const exportButton = document.getElementById('exportButton');
const adminTimeStandardInput = document.getElementById('adminTimeStandardInput');
const saveStandardButton = document.getElementById('saveStandardButton');
const homeClock = document.getElementById('homeClock');
const backFromForm = document.getElementById('backFromForm');
const backFromHistory = document.getElementById('backFromHistory');
const backFromMonitoring = document.getElementById('backFromMonitoring');
const adminSummaryText = document.getElementById('adminSummaryText');

const SCHOOL_LOCATION = {
  lat: -6.4012717,
  lng: 106.8089054
};
const SCHOOL_RADIUS_METERS = 200;

function setVisible(element, visible) {
  if (!element) return;
  element.classList.toggle('hidden', !visible);
}

function isAdminUser() {
  return appState.user?.role === 'admin' || appState.user?.role === 'principal';
}

function showSection(sectionId) {
  if (sectionId === 'monitoring' && !isAdminUser()) {
    sectionId = 'home';
  }
  sections.forEach((section) => {
    section.classList.toggle('hidden', section.id !== sectionId);
  });
  navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.section === sectionId);
  });
}

function setRoleUI() {
  const isTeacher = appState.user?.role === 'teacher';
  const isAdmin = isAdminUser();
  const hasTeacherAccess = isTeacher || isAdmin;

  document.querySelectorAll('.teacher-only').forEach((el) => setVisible(el, hasTeacherAccess));
  document.querySelectorAll('.admin-only').forEach((el) => setVisible(el, isAdmin));
  navLinks.forEach((link) => {
    if (link.dataset.section === 'monitoring') return setVisible(link, isAdmin);
    if (link.dataset.section === 'form' || link.dataset.section === 'history') return setVisible(link, hasTeacherAccess);
    return setVisible(link, true);
  });
  if (exportButton) {
    setVisible(exportButton, isAdmin);
  }
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m dari lokasi`;
  return `${(meters / 1000).toFixed(1)} km dari lokasi`;
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getStatusLabel(checkIn, jamMasukStandar = '08:30') {
  if (!checkIn) return 'Belum absen';
  return checkIn <= jamMasukStandar ? 'Hadir' : 'Terlambat';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'object' && data?.message ? data.message : 'Permintaan gagal.';
    throw new Error(message);
  }

  return data;
}

async function initializeAuth() {
  showSection('loginSection');
}

function loginUser(user) {
  appState.user = user;
  logoutButton?.classList.remove('hidden');
  setRoleUI();
  showSection('home');
  loadHome();
}

async function logout() {
  appState.user = null;
  logoutButton?.classList.add('hidden');
  showSection('loginSection');
}

async function updateLocationStatus() {
  if (!locationLabel || !locationDistance) return;
  if (!navigator.geolocation) {
    locationLabel.textContent = 'Lokasi tidak tersedia';
    locationDistance.textContent = 'Browser Anda tidak mendukung geolokasi.';
    return;
  }

  locationLabel.textContent = 'Mendeteksi lokasi...';
  locationDistance.textContent = 'Izinkan akses lokasi untuk validasi area sekolah.';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const distance = getDistanceMeters(latitude, longitude, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
      const inside = distance <= SCHOOL_RADIUS_METERS;
      locationLabel.textContent = inside ? 'Di dalam area sekolah' : 'Di luar area sekolah';
      locationDistance.textContent = formatDistance(distance);
    },
    () => {
      locationLabel.textContent = 'Lokasi tidak dapat dideteksi';
      locationDistance.textContent = 'Periksa izin lokasi dan coba lagi.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

async function loadHome() {
  if (!appState.user) return;

  homeName.textContent = appState.user.name;
  homeSchool.textContent = appState.user.school || 'Taman Main Darussalam';
  homeAvatar.textContent = appState.user.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (appState.user.role === 'teacher') {
    setVisible(checkInButton, true);
    setVisible(checkOutButton, true);
    checkInButton.disabled = false;
    checkOutButton.disabled = true;
    await loadTodayAttendance();
    updateLocationStatus();
    loadHistory();
    loadLeaves();
  }

  if (isAdminUser()) {
    adminSummaryText.textContent = 'Memuat data...';
    loadMonitoring();
    loadAdminSettings();
  }
}

async function loadTodayAttendance() {
  const today = getToday();
  appState.today = today;
  try {
    const data = await api(`/api/attendance/today?userId=${encodeURIComponent(appState.user.id)}`);
    const attendance = data.attendance || null;
    const status = attendance ? getStatusLabel(attendance.checkIn, data.jamMasukStandar) : 'Belum absen';
    attendanceLabel.textContent = attendance ? `${status} masuk` : 'Belum absen masuk';
    attendanceTime.textContent = attendance ? attendance.checkIn : '--:--';
    document.getElementById('attendanceInSummary').textContent = attendance ? attendance.checkIn : 'Belum absen';
    document.getElementById('attendanceOutSummary').textContent = attendance?.checkOut || '--:--';
    checkInButton.disabled = Boolean(attendance);
    checkOutButton.disabled = !attendance || Boolean(attendance.checkOut);
  } catch (error) {
    console.error(error);
  }
}

async function loadHistory() {
  try {
    const data = await api(`/api/attendance/history?userId=${encodeURIComponent(appState.user.id)}`);
    const records = data.history || [];
    const present = records.filter((item) => item.checkIn && item.checkIn <= data.jamMasukStandar).length;
    const late = records.filter((item) => item.checkIn && item.checkIn > data.jamMasukStandar).length;
    const absent = records.filter((item) => !item.checkIn).length;

    historyPresent.textContent = present;
    historyLate.textContent = late;
    historyLeave.textContent = 0;
    historyAbsent.textContent = absent;

    historyList.innerHTML = records
      .map((record) => {
        const status = getStatusLabel(record.checkIn, data.jamMasukStandar);
        return `
          <div class="history-item">
            <div>
              <p class="history-title">${record.date}</p>
              <p class="history-subtitle">Masuk ${record.checkIn || '--:--'} · Pulang ${record.checkOut || '--:--'}</p>
            </div>
            <span class="status-badge ${status === 'Hadir' ? 'success' : 'warning'}">${status}</span>
          </div>
        `;
      })
      .join('');
  } catch (error) {
    console.error(error);
  }
}

async function loadLeaves() {
  try {
    const data = await api(`/api/leaves?userId=${encodeURIComponent(appState.user.id)}`);
    const leaves = data.leaves || [];
    historyLeave.textContent = leaves.length;

    leaveList.innerHTML = leaves
      .map((leave) => `
        <div class="leave-item">
          <div>
            <p class="history-title">${leave.date} · ${leave.type}</p>
            <p class="history-subtitle">${leave.reason || '-'}</p>
          </div>
          <span class="status-badge accent">${leave.status}</span>
        </div>
      `)
      .join('');
  } catch (error) {
    console.error(error);
  }
}

async function loadMonitoring() {
  const date = getToday();
  try {
    const data = await api(`/api/admin/monitoring?date=${encodeURIComponent(date)}`);
    const summary = data.summary || {};
    const table = data.table || [];

    monitorPresent.textContent = summary.hadir || 0;
    monitorLate.textContent = summary.terlambat || 0;
    monitorLeave.textContent = summary.izinSakit || 0;
    monitorAbsent.textContent = summary.belumAbsen || 0;
    adminSummaryText.textContent = `Hadir: ${summary.hadir || 0}, Terlambat: ${summary.terlambat || 0}`;

    adminTableBody.innerHTML = table
      .map((row) => `
        <tr>
          <td>${row.name}</td>
          <td>${row.checkIn}</td>
          <td>${row.checkOut}</td>
          <td><span class="status-badge ${row.status === 'Hadir' ? 'success' : row.status === 'Terlambat' ? 'warning' : 'danger'}">${row.status}</span></td>
        </tr>
      `)
      .join('');
  } catch (error) {
    console.error(error);
  }
}

async function loadAdminSettings() {
  try {
    const data = await api('/api/admin/settings');
    appState.jamMasukStandar = data.settings?.jamMasukStandar || '08:30';
    adminTimeStandardInput.value = appState.jamMasukStandar;
  } catch (error) {
    console.error(error);
  }
}

function updateLiveClock() {
  const now = new Date();
  const dateString = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeString = now.toLocaleTimeString('id-ID', { hour12: false });
  if (homeClock) {
    homeClock.textContent = `${dateString} · ${timeString} WIB`;
  }
}

setInterval(updateLiveClock, 1000);
updateLiveClock();
initializeAuth();

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    if (!appState.user) return;
    const target = link.dataset.section;
    showSection(target);
    if (target === 'home') loadHome();
    if (target === 'history') loadHistory();
    if (target === 'monitoring') loadMonitoring();
  });
});

homeMenuButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.section;
    if (!target) return;
    showSection(target);
    if (target === 'home') loadHome();
    if (target === 'history') loadHistory();
    if (target === 'monitoring') loadMonitoring();
  });
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    loginUsername.value = '';
    loginPassword.value = '';
    loginUser(data.user);
  } catch (error) {
    alert(error.message || 'Login gagal. Pastikan username dan password benar.');
  }
});

checkInButton.addEventListener('click', async () => {
  try {
    await api('/api/attendance/checkin', {
      method: 'POST',
      body: JSON.stringify({ userId: appState.user.id })
    });
    await loadHome();
  } catch (error) {
    console.error(error);
    alert('Gagal absen masuk.');
  }
});

checkOutButton.addEventListener('click', async () => {
  try {
    await api('/api/attendance/checkout', {
      method: 'POST',
      body: JSON.stringify({ userId: appState.user.id })
    });
    await loadHome();
  } catch (error) {
    console.error(error);
    alert('Gagal absen pulang.');
  }
});

leaveTypeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    appState.leaveType = button.dataset.type;
    leaveTypeButtons.forEach((btn) => btn.classList.toggle('selected', btn === button));
  });
});

leaveForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const formData = new FormData();
    formData.append('userId', appState.user.id);
    formData.append('type', appState.leaveType);
    formData.append('date', leaveDate.value);
    formData.append('reason', leaveReason.value);
    if (leaveAttachment.files[0]) {
      formData.append('attachment', leaveAttachment.files[0]);
    }

    await api('/api/leaves', {
      method: 'POST',
      body: formData
    });

    alert('Pengajuan izin/sakit berhasil dikirim.');
    leaveForm.reset();
    appState.leaveType = 'sakit';
    leaveTypeButtons.forEach((btn) => btn.classList.toggle('selected', btn.dataset.type === 'sakit'));
    await loadLeaves();
  } catch (error) {
    console.error(error);
    alert('Gagal mengirim pengajuan.');
  }
});

saveStandardButton?.addEventListener('click', async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ jamMasukStandar: adminTimeStandardInput.value })
    });
    alert('Jam masuk standar berhasil disimpan.');
    appState.jamMasukStandar = adminTimeStandardInput.value;
    loadMonitoring();
    loadHistory();
  } catch (error) {
    console.error(error);
    alert('Gagal menyimpan jam masuk standar.');
  }
});

logoutButton?.addEventListener('click', logout);
backFromForm?.addEventListener('click', () => {
  showSection('home');
  loadHome();
});
backFromHistory?.addEventListener('click', () => {
  showSection('home');
  loadHome();
});
backFromMonitoring?.addEventListener('click', () => {
  showSection('home');
  loadHome();
});

showSection('loginSection');
