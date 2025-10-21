const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// File paths for JSON "database"
const USERS_FILE = path.join(__dirname, 'users.json');
const KAMAR_FILE = path.join(__dirname, 'kamar_tersedia.json');
const LAPORAN_FILE = path.join(__dirname, 'laporan_keuangan.json');

// --- Helpers for JSON storage (synchronous for simplicity) ---
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('readJson error for', filePath, err.message);
    return [];
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('writeJson error for', filePath, err.message);
  }
}

// Ensure files exist
if (!fs.existsSync(USERS_FILE)) writeJson(USERS_FILE, [
  // example admin user (password: 12345)
  { user_id: 1, username: 'admin', password: bcrypt.hashSync('12345', 10), first_name: 'Admin', last_name: '', email: '', role: 'admin' }
]);
if (!fs.existsSync(KAMAR_FILE)) writeJson(KAMAR_FILE, []);
if (!fs.existsSync(LAPORAN_FILE)) writeJson(LAPORAN_FILE, []);

// --- Middleware ---
app.use(express.static(path.join(__dirname)));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('views', path.join(__dirname));
app.set('view engine', 'ejs'); // optional, code uses renderHTML for static templates

app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia_super_aman_untuk_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true
  }
}));

// --- Simple renderHTML that substitutes {{placeholders}} in static HTML files ---
function renderHTML(fileName, data = {}) {
  const filePath = path.join(__dirname, fileName);
  let html = '';
  try {
    html = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return `<pre>Template ${fileName} not found: ${err.message}</pre>`;
  }

  // special: {{username|slice:0:1|upper}}
  if (data.username) {
    const initial = String(data.username).charAt(0).toUpperCase();
    html = html.replace(/\{\{username\|slice:0:1\|upper\}\}/g, initial);
  }

  for (const key in data) {
    const value = data[key] !== null && data[key] !== undefined ? data[key] : '';
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    html = html.replace(placeholder, value);
  }
  return html;
}

// --- Authentication helpers using users.json ---
function loadUsers() {
  return readJson(USERS_FILE).map(u => ({ ...u, user_id: Number(u.user_id) }));
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function getUserByUsername(username) {
  const users = loadUsers();
  return users.find(u => String(u.username) === String(username)) || null;
}

function getUserById(user_id) {
  if (!user_id) return null;
  const users = loadUsers();
  return users.find(u => Number(u.user_id) === Number(user_id)) || null;
}

// --- Simple session-based login (no passport) ---
function isAuthenticated(req, res, next) {
  if (req.session && (req.session.user || req.session.isGuest)) return next();
  return res.redirect('/login');
}

function isAdmin(req, res, next) {
  const u = req.session.user;
  if (u && u.role === 'admin') return next();
  const html = renderHTML('accessDenied.html', {});
  res.status(403).send(html);
}

// --- Kamar and laporan helpers (JSON) ---
function loadKamar() {
  return readJson(KAMAR_FILE);
}
function saveKamar(list) {
  writeJson(KAMAR_FILE, list);
}
function loadLaporan() {
  return readJson(LAPORAN_FILE);
}
function saveLaporan(list) {
  writeJson(LAPORAN_FILE, list);
}

function getKamarData(searchQuery = '') {
  try {
    const rows = loadKamar();
    let filtered = rows;
    if (searchQuery) {
      const q = String(searchQuery).toLowerCase();
      filtered = rows.filter(r => (r.tipe_kamar && r.tipe_kamar.toLowerCase().includes(q)) || (r.deskripsi && r.deskripsi.toLowerCase().includes(q)));
      // custom ordering like original: tipe_kamar matches first
      filtered.sort((a,b) => {
        const aMatch = (a.tipe_kamar||'').toLowerCase().includes(q) ? 0 : 1;
        const bMatch = (b.tipe_kamar||'').toLowerCase().includes(q) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return String(a.tipe_kamar).localeCompare(String(b.tipe_kamar));
      });
    } else {
      filtered.sort((a,b) => String(a.tipe_kamar).localeCompare(String(b.tipe_kamar)));
    }
    const semuaKamar = filtered.map(kamar => ({ ...kamar, status: (kamar.jumlah_tersedia || 0) > 0 ? 'Tersedia' : 'Sold Out' }));
    return { semuaKamar };
  } catch (err) {
    console.error(err);
    return { semuaKamar: [] };
  }
}

function getKamarByTipe(tipe_kamar) {
  const rows = loadKamar();
  return rows.find(r => r.tipe_kamar === tipe_kamar) || null;
}

function getUsersByRole(role) {
  const users = loadUsers();
  return users.filter(u => u.role === role).map(u => ({
    user_id: u.user_id,
    username: u.username,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    email: u.email || '',
    phone_number: u.phone_number || '',
    role: u.role
  }));
}

// --- Routes (mirroring previous structure) ---

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  const html = renderHTML('login.html', { error: '' });
  res.send(html);
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = getUserByUsername(username);
    if (!user) {
      const html = renderHTML('login.html', { error: 'Username atau password salah.' });
      return res.status(400).send(html);
    }
    const stored = user.password || '';
    let passwordMatches = false;
    if (stored.startsWith('$2')) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      passwordMatches = password === stored;
    }
    if (!passwordMatches) {
      const html = renderHTML('login.html', { error: 'Username atau password salah.' });
      return res.status(400).send(html);
    }
    req.session.user = user;
    req.session.isGuest = false;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Terjadi kesalahan server saat login.');
  }
});

app.get('/register', (req, res) => {
  const html = renderHTML('register.html', { error: '' });
  res.send(html);
});

app.post('/register', async (req, res) => {
  try {
    const { username, password, first_name, last_name, email, dob, phone_number, role } = req.body;
    let users = loadUsers();
    if (users.find(u => String(u.username) === String(username) || String(u.email) === String(email))) {
      return res.status(400).send('<h1>Error</h1><p>Username atau email sudah terdaftar. Silakan pilih yang lain.</p>');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      user_id: Date.now(),
      username,
      password: hashedPassword,
      first_name: first_name || '',
      last_name: last_name || '',
      email: email || '',
      dob: dob || null,
      phone_number: phone_number || '',
      role: role || 'user'
    };
    users.push(newUser);
    saveUsers(users);
    req.session.user = newUser;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Registrasi error:', err);
    res.status(500).send('Terjadi kesalahan server saat registrasi.');
  }
});

app.get('/guest', (req, res) => {
  req.session.isGuest = true;
  req.session.user = { user_id: 'guest', username: 'Tamu', role: 'guest' };
  res.redirect('/dashboard');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user || { username: 'Tamu', role: 'guest' };
  if (user && user.role === 'admin') return res.redirect('/dashboardAdmin');
  try {
    const { semuaKamar } = getKamarData();
    const jumlahTersedia = semuaKamar.filter(k => (k.jumlah_tersedia||0) > 0).length;
    const data = { username: user.username, role: user.role, jumlahTersedia };
    const html = renderHTML('dashboard.html', data);
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat dashboard.');
  }
});

app.get('/dashboardAdmin', isAdmin, (req, res) => {
  const data = { username: req.session.user.username, role: req.session.user.role };
  const html = renderHTML('dashboardAdmin.html', data);
  res.send(html);
});

app.get('/TipeKamar', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user || { username: 'Tamu', role: 'guest' };
    const searchQuery = req.query.search || '';
    const { semuaKamar } = getKamarData(searchQuery);
    let kamarHtml = '';
    if (semuaKamar && semuaKamar.length > 0) {
      semuaKamar.forEach(kamar => {
        const statusClass = (kamar.jumlah_tersedia||0) === 0 ? 'sold-out' : '';
        let buttonHtml;
        if (user.role === 'guest') {
          buttonHtml = `<a href="/login" class="btn-pesan">Login untuk Memesan</a>`;
        } else {
          buttonHtml = (kamar.jumlah_tersedia||0) > 0
            ? `<a href="/Form?tipe=${encodeURIComponent(kamar.tipe_kamar)}&harga=${kamar.harga}" class="btn-pesan">Pesan Sekarang</a>`
            : `<button class="btn-pesan sold-out-btn" disabled>Sold Out</button>`;
        }
        kamarHtml += `
          <div class="kamar-item ${statusClass}">
            <img src="https://via.placeholder.co/350x200/3498db/ffffff?text=${encodeURIComponent(kamar.tipe_kamar)}" alt="Foto Kamar ${kamar.tipe_kamar}">
            <h3>${kamar.tipe_kamar}</h3>
            <p class="harga">Rp ${Number(kamar.harga||0).toLocaleString('id-ID')} / bulan</p>
            <p>${kamar.deskripsi||''}</p>
            <ul class="fasilitas">
              <li><i class="fas fa-check"></i> Ukuran Standar</li>
              <li><i class="fas fa-check"></i> Kamar Mandi Dalam</li>
              <li><i class="fas fa-check"></i> Fasilitas: AC, Lemari, Meja Belajar, Wifi</li>
            </ul>
            ${buttonHtml}
          </div>
        `;
      });
    } else {
      kamarHtml = '<p style="text-align: center;">Tidak ada tipe kamar yang ditemukan.</p>';
    }
    const html = renderHTML('TipeKamar.html', { username: user.username, kamarList: kamarHtml, searchQuery });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat halaman Tipe Kamar.');
  }
});

app.get('/kamarTersedia', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user || { username: 'Tamu', role: 'guest' };
    const { semuaKamar } = getKamarData();
    const tersedia = semuaKamar.filter(k => (k.jumlah_tersedia||0) > 0);
    let kamarHtml = '';
    if (tersedia.length > 0) {
      tersedia.forEach(kamar => {
        let buttonHtml;
        if (user.role === 'guest') {
          buttonHtml = `<a href="/login" class="btn-pesan">Login untuk Memesan</a>`;
        } else {
          buttonHtml = `<a href="/Form?tipe=${encodeURIComponent(kamar.tipe_kamar)}&harga=${kamar.harga}" class="btn-pesan">Pesan Sekarang</a>`;
        }
        kamarHtml += `
          <div class="kamar-item">
            <img src="https://placehold.co/400x250/3498db/ffffff?text=${encodeURIComponent(kamar.tipe_kamar)}" alt="Foto Kamar ${kamar.tipe_kamar}">
            <h3>${kamar.tipe_kamar}</h3>
            <p class="harga">Rp ${Number(kamar.harga||0).toLocaleString('id-ID')} / bulan</p>
            <p>${kamar.deskripsi||''}</p>
            <ul class="fasilitas">
              <li><i class="fas fa-check"></i> Ukuran Standar</li>
              <li><i class="fas fa-check"></i> Kamar Mandi Dalam</li>
              <li><i class="fas fa-check"></i> Fasilitas: AC, Lemari, Meja Belajar, Wifi</li>
            </ul>
            ${buttonHtml}
          </div>
        `;
      });
    } else {
      kamarHtml = '<p>Maaf, saat ini tidak ada kamar yang tersedia.</p>';
    }
    const html = renderHTML('kamarTersedia.html', { username: user.username, kamarList: kamarHtml });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat halaman Kamar Tersedia.');
  }
});

app.get('/laporanKeuangan', isAuthenticated, (req, res) => {
  if (req.session.isGuest) return res.redirect('/login');
  try {
    const laporan = loadLaporan().filter(l => Number(l.user_id) === Number(req.session.user.user_id));
    let rowsHtml = '';
    if (laporan.length > 0) {
      laporan.forEach(row => {
        const tanggalObj = new Date(row.tanggal_pembayaran);
        const optionsDate = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' };
        const optionsTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        const formattedDate = tanggalObj.toLocaleDateString('id-ID', optionsDate);
        const formattedTime = tanggalObj.toLocaleTimeString('id-ID', optionsTime);
        rowsHtml += `<tr><td>${formattedDate}</td><td>${formattedTime}</td><td>${row.tipe_kamar}</td></tr>`;
      });
    } else {
      rowsHtml = '<tr><td colspan="3">Tidak ada data pembayaran yang ditemukan.</td></tr>';
    }
    const html = renderHTML('laporanKeuangan.html', { username: req.session.user.username, rows: rowsHtml });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat laporan keuangan.');
  }
});

app.get('/laporanKeuanganAdmin', isAdmin, (req, res) => {
  try {
    const searchQuery = req.query.search || '';
    const laporanAll = loadLaporan();
    const filtered = searchQuery ? laporanAll.filter(l => {
      const users = loadUsers();
      const u = users.find(x => Number(x.user_id) === Number(l.user_id));
      return u && u.username && u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }) : laporanAll;
    let rowsHtml = '';
    if (filtered.length > 0) {
      filtered.forEach(row => {
        const tanggalObj = new Date(row.tanggal_pembayaran);
        const optionsDate = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' };
        const optionsTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        const formattedDate = tanggalObj.toLocaleDateString('id-ID', optionsDate);
        const formattedTime = tanggalObj.toLocaleTimeString('id-ID', optionsTime);
        const users = loadUsers();
        const u = users.find(x => Number(x.user_id) === Number(row.user_id));
        const username = u ? u.username : 'Unknown';
        rowsHtml += `<tr><td>${username}</td><td>${formattedDate}</td><td>${formattedTime}</td><td>${row.tipe_kamar}</td></tr>`;
      });
    } else {
      rowsHtml = '<tr><td colspan="4">Tidak ada data pembayaran yang ditemukan.</td></tr>';
    }
    const html = renderHTML('laporanKeuanganAdmin.html', { username: req.session.user.username, rows: rowsHtml, searchQuery });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat laporan keuangan admin.');
  }
});

app.post('/daftarUser/delete', isAdmin, (req, res) => {
  try {
    const { username } = req.body;
    let users = loadUsers();
    users = users.filter(u => u.username !== username);
    saveUsers(users);
    res.redirect('/daftarUser');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal menghapus pengguna.');
  }
});

app.post('/daftarUser/updateRole', isAdmin, (req, res) => {
  try {
    const { username, newRole } = req.body;
    if (newRole !== 'admin' && newRole !== 'user') return res.status(400).send('Peran tidak valid.');
    const users = loadUsers();
    const user = users.find(u => u.username === username);
    if (user) {
      user.role = newRole;
      saveUsers(users);
    }
    res.redirect('/daftarUser');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal mengubah peran pengguna.');
  }
});

app.get('/daftarUser', isAdmin, (req, res) => {
  try {
    const adminUsers = getUsersByRole('admin');
    const regularUsers = getUsersByRole('user');
    let adminRowsHtml = '';
    if (adminUsers.length > 0) {
      adminUsers.forEach(user => {
        adminRowsHtml += `<tr>
          <td>${user.username}</td>
          <td>${user.first_name} ${user.last_name}</td>
          <td>${user.email}</td>
          <td>${user.phone_number || '-'}</td>
          <td>
            <form action="/daftarUser/updateRole" method="POST" style="display:inline-block; margin-right:5px;">
              <input type="hidden" name="username" value="${user.username}">
              <input type="hidden" name="newRole" value="user">
              <button type="submit">Ubah ke User</button>
            </form>
            <form action="/daftarUser/delete" method="POST" style="display:inline-block;">
              <input type="hidden" name="username" value="${user.username}">
              <button type="submit">Hapus</button>
            </form>
          </td>
        </tr>`;
      });
    } else {
      adminRowsHtml = '<tr><td colspan="5">Tidak ada pengguna admin yang terdaftar.</td></tr>';
    }
    let regularRowsHtml = '';
    if (regularUsers.length > 0) {
      regularUsers.forEach(user => {
        regularRowsHtml += `<tr>
          <td>${user.username}</td>
          <td>${user.first_name} ${user.last_name}</td>
          <td>${user.email}</td>
          <td>${user.phone_number || '-'}</td>
          <td>
            <form action="/daftarUser/updateRole" method="POST" style="display:inline-block; margin-right:5px;">
              <input type="hidden" name="username" value="${user.username}">
              <input type="hidden" name="newRole" value="admin">
              <button type="submit">Ubah ke Admin</button>
            </form>
            <form action="/daftarUser/delete" method="POST" style="display:inline-block;">
              <input type="hidden" name="username" value="${user.username}">
              <button type="submit">Hapus</button>
            </form>
          </td>
        </tr>`;
      });
    } else {
      regularRowsHtml = '<tr><td colspan="5">Tidak ada pengguna biasa yang terdaftar.</td></tr>';
    }
    const html = renderHTML('daftarUser.html', { username: req.session.user.username, adminRows: adminRowsHtml, regularRows: regularRowsHtml });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat daftar pengguna.');
  }
});

// Profile routes
app.get('/profile', isAuthenticated, (req, res) => {
  if (req.session.isGuest) return res.redirect('/login');
  if (req.session.user.role === 'admin') return res.redirect('/profileAdmin');
  const data = {
    username: req.session.user.username,
    firstName: req.session.user.first_name || '',
    lastName: req.session.user.last_name || '',
    email: req.session.user.email || 'belum_ada@gmail.com',
    phoneNumber: req.session.user.phone_number || '',
    role: req.session.user.role
  };
  const html = renderHTML('profile.html', data);
  res.send(html);
});

app.get('/profileAdmin', isAdmin, (req, res) => {
  const data = {
    username: req.session.user.username,
    firstName: req.session.user.first_name || '',
    lastName: req.session.user.last_name || '',
    email: req.session.user.email || 'belum_ada@gmail.com',
    phoneNumber: req.session.user.phone_number || '',
    role: req.session.user.role
  };
  const html = renderHTML('profileAdmin.html', data);
  res.send(html);
});

app.post('/profile/update', isAuthenticated, (req, res) => {
  if (req.session.isGuest) return res.redirect('/login');
  try {
    const { first_name, last_name, email, phone_number } = req.body;
    const users = loadUsers();
    const user = users.find(u => Number(u.user_id) === Number(req.session.user.user_id));
    if (user) {
      user.first_name = first_name || '';
      user.last_name = last_name || '';
      user.email = email || '';
      user.phone_number = phone_number || '';
      saveUsers(users);
      // refresh session user
      req.session.user = user;
    }
    if (req.session.user.role === 'admin') return res.redirect('/profileAdmin');
    return res.redirect('/profile');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memperbarui profil.');
  }
});

// Kelola kamar (admin)
app.get('/kelolaKamar', isAdmin, (req, res) => {
  try {
    const kamarList = loadKamar();
    let kamarHtml = '';
    if (kamarList.length > 0) {
      kamarList.forEach(kamar => {
        kamarHtml += `<div class="kamar-item">
            <img src="https://placehold.co/400x250/3498db/ffffff?text=${encodeURIComponent(kamar.tipe_kamar)}" alt="Foto Kamar ${kamar.tipe_kamar}">
            <h3>${kamar.tipe_kamar}</h3>
            <p class="harga">Rp ${Number(kamar.harga||0).toLocaleString('id-ID')} / bulan</p>
            <p>${kamar.deskripsi||''}</p>
            <div style="margin-top:20px;border-top:1px solid #eee;padding-top:15px;text-align:center;">
              <form action="/kelolaKamar/update" method="POST" style="display:inline-block;margin-right:15px;">
                <input type="hidden" name="id" value="${kamar.id}">
                <label for="jumlah-${kamar.id}" style="font-weight:600;">Tersedia:</label>
                <input type="number" id="jumlah-${kamar.id}" name="jumlah_tersedia" value="${kamar.jumlah_tersedia||0}" min="0" style="width:60px;padding:5px;border-radius:4px;border:1px solid #ddd;">
                <button type="submit">Update</button>
              </form>
              <form action="/kelolaKamar/delete" method="POST" style="display:inline-block;">
                <input type="hidden" name="id" value="${kamar.id}">
                <button type="submit">Hapus Tipe</button>
              </form>
            </div>
          </div>`;
      });
    } else {
      kamarHtml = '<p style="text-align:center;">Tidak ada tipe kamar yang terdaftar. Silakan tambahkan tipe kamar baru di atas.</p>';
    }
    const html = renderHTML('kelolaKamar.html', { username: req.session.user.username, kamarList: kamarHtml });
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat halaman kelola kamar.');
  }
});

app.post('/kelolaKamar/add', isAdmin, (req, res) => {
  try {
    const { tipe_kamar, harga_kamar, deskripsi_kamar, jumlah_tersedia } = req.body;
    const kamarList = loadKamar();
    const newKamar = {
      id: Date.now(),
      tipe_kamar,
      harga: Number(harga_kamar) || 0,
      deskripsi: deskripsi_kamar || '',
      jumlah_tersedia: Number(jumlah_tersedia) || 0
    };
    kamarList.push(newKamar);
    saveKamar(kamarList);
    res.redirect('/kelolaKamar');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal menambahkan kamar baru.');
  }
});

app.post('/kelolaKamar/update', isAdmin, (req, res) => {
  try {
    const { id, jumlah_tersedia } = req.body;
    const kamarList = loadKamar();
    const kamar = kamarList.find(k => String(k.id) === String(id));
    if (kamar) {
      kamar.jumlah_tersedia = Number(jumlah_tersedia) || 0;
      saveKamar(kamarList);
    }
    res.redirect('/kelolaKamar');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memperbarui jumlah kamar.');
  }
});

app.post('/kelolaKamar/delete', isAdmin, (req, res) => {
  try {
    const { id } = req.body;
    let kamarList = loadKamar();
    kamarList = kamarList.filter(k => String(k.id) !== String(id));
    saveKamar(kamarList);
    res.redirect('/kelolaKamar');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal menghapus kamar.');
  }
});

// Form pemesanan
app.get('/Form', isAuthenticated, (req, res) => {
  if (req.session.isGuest) return res.redirect('/login');
  const { tipe, harga } = req.query;
  if (!tipe || !harga) return res.status(400).send('<h1>Error</h1><p>Parameter tipe dan harga tidak valid.</p>');
  const today = new Date().toISOString().split('T')[0];
  const data = {
    username: req.session.user.username,
    nama: `${req.session.user.first_name || ''} ${req.session.user.last_name || ''}`.trim(),
    email: req.session.user.email || '',
    tanggal_sewa: today,
    tipe_kamar: decodeURIComponent(tipe),
    hargaKamar: harga
  };
  const html = renderHTML('Form.html', data);
  res.send(html);
});

app.post('/submitForm', isAuthenticated, (req, res) => {
  if (req.session.isGuest) return res.redirect('/login');
  try {
    const { tipe_kamar, durasi, tanggal_masuk } = req.body;
    const userId = req.session.user.user_id;
    const kamar = getKamarByTipe(tipe_kamar);
    if (!kamar || (kamar.jumlah_tersedia||0) <= 0) {
      return res.status(400).send('<h1>Error</h1><p>Kamar yang Anda pilih tidak lagi tersedia.</p>');
    }
    kamar.jumlah_tersedia = (kamar.jumlah_tersedia||0) - 1;
    const kamarList = loadKamar();
    const idx = kamarList.findIndex(k => String(k.id) === String(kamar.id));
    if (idx >= 0) { kamarList[idx] = kamar; saveKamar(kamarList); }
    const now = new Date().toISOString();
    const laporan = loadLaporan();
    laporan.push({ id: Date.now(), user_id: userId, tipe_kamar, tanggal_pembayaran: now });
    saveLaporan(laporan);
    res.redirect('/laporanKeuangan');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memproses pesanan Anda. Silakan coba lagi.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server berjalan di port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
