const express = require('express');
const session = require('express-session');
const passport = require('passport');
const "GOOGLE_SECRET_REMOVED_FOR_SECURITY"20').Strategy;
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require("fs");

const app = express();

// KONFIGURASI PENTING DAN MIDDLEWARE

app.use(express.static(path.join(__dirname)));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- PERBAIKAN: GUNAKAN VARIABEL LINGKUNGAN DARI SCALINGO ---
// Ganti nilai fallback ini dengan nilai yang benar dari Google Cloud Console
// DAN SET NILAI INI DI ENVIRONMENT VARIABLES PADA DASHBOARD SCALINGO
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Konfigurasi database - DIPERBAIKI UNTUK SCALINGO (menggunakan MYSQL_URL)
// Scalingo secara otomatis menyediakan variabel lingkungan MYSQL_URL setelah Add-on dibuat.
const pool = mysql.createPool(process.env.MYSQL_URL);


// Session configuration
// Harap pastikan SESSION_SECRET diset di Environment Variables Scalingo
app.use(session({
    secret: process.env.SESSION_SECRET || 'rahasia_super_aman_untuk_production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production', // true untuk production
        sameSite: 'lax',
        httpOnly: true
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// FUNGSI UTAMA UNTUK HTML
function renderHTML(fileName, data = {}) {
    let html = fs.readFileSync(path.join(__dirname, fileName), 'utf8');

    // Tangani {{username|slice:0:1|upper}} secara khusus
    if (data.username) {
        const initial = data.username.charAt(0).toUpperCase();
        html = html.replace(/\{\{username\|slice:0:1\|upper\}\}/g, initial);
    }
    
    // Tangani semua placeholder lain secara generik
    for (const key in data) {
        // Handle undefined or null values by replacing them with an empty string
        const value = data[key] !== null && data[key] !== undefined ? data[key] : '';
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        html = html.replace(placeholder, value);
    }
    
    return html;
}

// AUTENTIKASI DAN OTORISASI

passport.serializeUser((user, done) => {
    // Memastikan Passport hanya menyimpan user_id (PK) ke sesi
    done(null, user.user_id);
});

passport.deserializeUser(async (user_id, done) => {
    try {
        // Memastikan pengguna diambil berdasarkan user_id (PK)
        const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [user_id]);
        if (rows.length > 0) {
            done(null, rows[0]);
        } else {
            done(null, false);
        }
    } catch (err) {
        done(err, null);
    }
});

// Google Strategy - MODIFIED CALLBACK URL FOR SCALINGO
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    // Pastikan callbackURL ini sama persis dengan yang di Google Cloud Console
    // Untuk Scalingo, gunakan nama domain Anda atau biarkan /auth/google/callback
    callbackURL: process.env.NODE_ENV === 'production' 
        ? "/auth/google/callback"
        : "http://localhost:3000/auth/google/callback"
},
async (accessToken, refreshToken, profile, done) => {
    try {
        const googleId = profile.id;
        const email = profile.emails[0].value;
        const username = email.split('@')[0];

        // 1. Periksa apakah pengguna sudah ada berdasarkan google_id
        const [rowsByGoogleId] = await pool.query('SELECT * FROM users WHERE google_id = ?', [googleId]);

        if (rowsByGoogleId.length > 0) {
            // Pengguna sudah terdaftar dengan Google, perbarui data jika perlu
            const user = rowsByGoogleId[0];
            await pool.query('UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE google_id = ?', 
            [profile.name.givenName, profile.name.familyName, email, googleId]);
            return done(null, user);
        }

        // 2. Jika tidak ada google_id, periksa apakah pengguna sudah ada berdasarkan email atau username
        const [rowsByEmailOrUsername] = await pool.query('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);

        if (rowsByEmailOrUsername.length > 0) {
            // Pengguna sudah terdaftar secara manual, tambahkan google_id ke akun yang sudah ada
            const user = rowsByEmailOrUsername[0];
            await pool.query('UPDATE users SET google_id = ? WHERE user_id = ?', [googleId, user.user_id]);
            return done(null, user);
        }

        // 3. Jika pengguna sama sekali baru, buat entri baru
        const newUser = {
            google_id: googleId,
            username: username,
            first_name: profile.name.givenName,
            last_name: profile.name.familyName,
            email: email,
            phone_number: null,
            role: 'user' 
        };
        const [result] = await pool.query('INSERT INTO users (username, password, first_name, last_name, email, dob, phone_number, role, google_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [newUser.username, '', newUser.first_name, newUser.last_name, newUser.email, null, newUser.phone_number, newUser.role, newUser.google_id]);
        
        const user = { user_id: result.insertId, ...newUser };
        return done(null, user);

    } catch (err) {
        console.error("Google auth error:", err);
        return done(err, null);
    }
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

/**
 * Middleware untuk memastikan pengguna sudah login (user terdaftar atau guest).
 */
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated() || req.session.isGuest) { 
        return next();
    }
    res.redirect('/login');
}

/**
 * Middleware untuk memastikan pengguna adalah admin.
 */
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }
    // Render halaman error 403 menggunakan template HTML dan CSS
    const html = renderHTML('accessDenied.html', {});
    res.status(403).send(html);
}

// FUNGSI UNTUK DATABASE

async function getKamarData(searchQuery = '') {
    try {
        let query = 'SELECT id, tipe_kamar, deskripsi, harga, jumlah_tersedia FROM kamar_tersedia';
        const params = [];
        let orderByClause = '';
        
        if (searchQuery) {
            query += ' WHERE tipe_kamar LIKE ? OR deskripsi LIKE ?';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
            
            orderByClause = ` ORDER BY 
                CASE 
                    WHEN tipe_kamar LIKE '%${searchQuery}%' THEN 0 
                    WHEN deskripsi LIKE '%${searchQuery}%' THEN 1 
                    ELSE 2 
                END, tipe_kamar ASC`;
        }
        
        query += orderByClause;
        
        const [rows] = await pool.query(query, params);
        
        const semuaKamar = rows.map(kamar => ({
            ...kamar,
            status: kamar.jumlah_tersedia > 0 ? 'Tersedia' : 'Sold Out'
        }));
        
        return { semuaKamar };
    } catch (err) {
        console.error("Gagal membaca kamar dari database:", err.message);
        return { semuaKamar: [] };
    }
}

async function getKamarByTipe(tipe_kamar) {
    try {
        const [rows] = await pool.query('SELECT * FROM kamar_tersedia WHERE tipe_kamar = ?', [tipe_kamar]);
        return rows[0];
    } catch (err) {
        console.error("Gagal membaca kamar dari database:", err.message);
        return null;
    }
}

// MODIFIED FOR DATABASE SCHEMA COMPATIBILITY
async function getLaporanKeuanganData(userId) {
    try {
        const [rows] = await pool.query(
            'SELECT tanggal_pembayaran, tipe_kamar FROM laporan_keuangan WHERE user_id = ?', 
            [userId]
        );
        return rows;
    } catch (err) {
        console.error("Gagal membaca laporan keuangan dari database:", err.message);
        return [];
    }
}

// MODIFIED FOR DATABASE SCHEMA COMPATIBILITY
async function getAllLaporanKeuangan(searchQuery) {
    try {
        let query = `
            SELECT l.tanggal_pembayaran, l.tipe_kamar, u.username 
            FROM laporan_keuangan l 
            JOIN users u ON l.user_id = u.user_id
        `;
        const params = [];

        if (searchQuery) {
            query += ' WHERE u.username LIKE ?';
            params.push(`%${searchQuery}%`);
        }

        const [rows] = await pool.query(query, params);
        return rows;
    } catch (err) {
        console.error("Gagal membaca semua laporan keuangan dari database:", err.message);
        return [];
    }
}

async function getUsersByRole(role) {
    try {
        const [rows] = await pool.query('SELECT user_id, username, first_name, last_name, email, phone_number, role FROM users WHERE role = ?', [role]);
        return rows;
    } catch (err) {
        console.error(`Gagal membaca daftar pengguna dengan role ${role}:`, err.message);
        return [];
    }
}

async function getKamarTersedia() {
    try {
        const [rows] = await pool.query('SELECT id, tipe_kamar, deskripsi, harga, jumlah_tersedia FROM kamar_tersedia ORDER BY tipe_kamar ASC');
        return rows;
    } catch (err) {
        console.error("Gagal membaca kamar dari database:", err.message);
        return [];
    }
}

async function addKamar(tipe_kamar, harga, deskripsi, jumlah_tersedia) {
    try {
        await pool.query('INSERT INTO kamar_tersedia (tipe_kamar, harga, deskripsi, jumlah_tersedia) VALUES (?, ?, ?, ?)', [tipe_kamar, harga, deskripsi, jumlah_tersedia]);
    } catch (err) {
        console.error("Gagal menambahkan kamar ke database:", err.message);
        throw err;
    }
}

async function updateKamar(id, jumlah_tersedia) {
    try {
        await pool.query('UPDATE kamar_tersedia SET jumlah_tersedia = ? WHERE id = ?', [jumlah_tersedia, id]);
    } catch (err) {
        console.error("Gagal memperbarui kamar:", err.message);
        throw err;
    }
}

async function deleteKamar(id) {
    try {
        await pool.query('DELETE FROM kamar_tersedia WHERE id = ?', [id]);
    } catch (err) {
        console.error("Gagal menghapus kamar:", err.message);
        throw err;
    }
}

// DEFINISI RUTE

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', async (req, res) => {
    const html = renderHTML('login.html', { error: '' });
    res.send(html);
});

app.post('/login', async (req, res, next) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user || !user.password || !await bcrypt.compare(password, user.password)) {
            const html = renderHTML('login.html', { error: `<div class="error-message">Username atau password salah.</div>` });
            return res.status(400).send(html);
        }
        
        req.session.isGuest = false;

        req.login(user, (err) => {
            if (err) { return next(err); }
            return res.redirect('/dashboard');
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).send("Terjadi kesalahan server saat login.");
    }
});

app.get('/register', (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'register.html'), 'utf8');
    res.send(html);
});

app.post('/register', async (req, res, next) => {
    const { username, password, first_name, last_name, email, dob, phone_number, role } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (rows.length > 0) {
            return res.status(400).send("<h1>Error</h1><p>Username atau email sudah terdaftar. Silakan pilih yang lain.</p>");
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (username, password, first_name, last_name, email, dob, phone_number, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [username, hashedPassword, first_name, last_name, email, dob, phone_number, role]);
        
        const newUser = { user_id: result.insertId, username, first_name, last_name, email, phone_number, role };
        
        req.login(newUser, (err) => {
            if (err) { return next(err); }
            return res.redirect('/dashboard');
        });
        
    } catch (err) {
        console.error("Registrasi error:", err);
        res.status(500).send("Terjadi kesalahan server saat registrasi.");
    }
});

app.get('/guest', (req, res, next) => {
    req.session.isGuest = true;
    req.session.guestUser = {
        user_id: 'guest',
        username: 'Tamu',
        role: 'guest'
    };
    res.redirect('/dashboard');
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
    const user = req.user || req.session.guestUser;
    
    if (user && user.role === 'admin') {
        return res.redirect('/dashboardAdmin');
    }

    try {
        const { semuaKamar } = await getKamarData();
        const jumlahTersedia = semuaKamar.filter(kamar => kamar.jumlah_tersedia > 0).length;

        const data = {
            username: user.username,
            role: user.role,
            jumlahTersedia: jumlahTersedia,
        };
        const html = renderHTML('dashboard.html', data);
        res.send(html);
    } catch (err) {
        console.error("Error saat memuat dashboard:", err);
        res.status(500).send("Gagal memuat dashboard.");
    }
});

app.get('/dashboardAdmin', isAdmin, (req, res) => {
    const data = {
        username: req.user.username,
        role: req.user.role,
    };
    const html = renderHTML('dashboardAdmin.html', data);
    res.send(html);
});

app.get('/TipeKamar', isAuthenticated, async (req, res) => {
    try {
        const user = req.user || req.session.guestUser;
        const searchQuery = req.query.search || '';
        const { semuaKamar } = await getKamarData(searchQuery);
        let kamarHtml = '';
        
        if (semuaKamar && semuaKamar.length > 0) {
            semuaKamar.forEach(kamar => {
                const statusClass = kamar.jumlah_tersedia === 0 ? 'sold-out' : '';
                
                let buttonHtml;
                if (user.role === 'guest') {
                    buttonHtml = `<a href="/login" class="btn-pesan">Login untuk Memesan</a>`;
                } else {
                    buttonHtml = kamar.jumlah_tersedia > 0
                        ? `<a href="/Form?tipe=${encodeURIComponent(kamar.tipe_kamar)}&harga=${kamar.harga}" class="btn-pesan">Pesan Sekarang</a>`
                        : `<button class="btn-pesan sold-out-btn" disabled>Sold Out</button>`;
                }

                kamarHtml += `
                    <div class="kamar-item ${statusClass}">
                        <img src="https://via.placeholder.co/350x200/3498db/ffffff?text=${encodeURIComponent(kamar.tipe_kamar)}" alt="Foto Kamar ${kamar.tipe_kamar}">
                        <h3>${kamar.tipe_kamar}</h3>
                        <p class="harga">Rp ${kamar.harga.toLocaleString('id-ID')} / bulan</p>
                        <p>${kamar.deskripsi}</p>
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
        
        const html = renderHTML('TipeKamar.html', {
            username: user.username,
            kamarList: kamarHtml,
            searchQuery: searchQuery 
        });
        res.send(html);
        
    } catch (err) {
        console.error("Error fetching room types:", err);
        res.status(500).send("Gagal memuat halaman Tipe Kamar.");
    }
});

app.get('/kamarTersedia', isAuthenticated, async (req, res) => {
    try {
        const user = req.user || req.session.guestUser;
        const { semuaKamar } = await getKamarData();
        const tersedia = semuaKamar.filter(kamar => kamar.jumlah_tersedia > 0);
        
        let kamarHtml = '';
        if (tersedia && tersedia.length > 0) {
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
                        <p class="harga">Rp ${kamar.harga.toLocaleString('id-ID')} / bulan</p>
                        <p>${kamar.deskripsi}</p>
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
        console.error("Error fetching available rooms:", err);
        res.status(500).send("Gagal memuat halaman Kamar Tersedia.");
    }
});


app.get('/laporanKeuangan', isAuthenticated, async (req, res) => {
    if (req.session.isGuest) {
        return res.redirect('/login');
    }

    try {
        const laporan = await getLaporanKeuanganData(req.user.user_id);
        let rowsHtml = '';
        if (laporan && laporan.length > 0) {
            laporan.forEach(row => {
                const tanggalObj = new Date(row.tanggal_pembayaran);
                const optionsDate = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' };
                const optionsTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
                
                const formattedDate = tanggalObj.toLocaleDateString('id-ID', optionsDate);
                const formattedTime = tanggalObj.toLocaleTimeString('id-ID', optionsTime);
                
                rowsHtml += `
                    <tr>
                        <td>${formattedDate}</td>
                        <td>${formattedTime}</td>
                        <td>${row.tipe_kamar}</td>
                    </tr>
                `;
            });
        } else {
            rowsHtml = '<tr><td colspan="3">Tidak ada data pembayaran yang ditemukan.</td></tr>';
        }
        const html = renderHTML("laporanKeuangan.html", {
            username: req.user.username, 
            rows: rowsHtml
        });
        res.send(html);
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).send("<h1>Server Error</h1><p>Gagal memuat laporan keuangan.</p>");
    }
});

app.get('/laporanKeuanganAdmin', isAdmin, async (req, res) => {
    try {
        const searchQuery = req.query.search;
        const laporan = await getAllLaporanKeuangan(searchQuery);
        let rowsHtml = '';
        if (laporan && laporan.length > 0) {
            laporan.forEach(row => {
                const tanggalObj = new Date(row.tanggal_pembayaran);
                const optionsDate = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' };
                const optionsTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
                
                const formattedDate = tanggalObj.toLocaleDateString('id-ID', optionsDate);
                const formattedTime = tanggalObj.toLocaleTimeString('id-ID', optionsTime);
                
                rowsHtml += `
                    <tr>
                        <td>${row.username}</td>
                        <td>${formattedDate}</td>
                        <td>${formattedTime}</td>
                        <td>${row.tipe_kamar}</td>
                    </tr>
                `;
            });
        } else {
            rowsHtml = '<tr><td colspan="4">Tidak ada data pembayaran yang ditemukan.</td></tr>';
        }
        const html = renderHTML("laporanKeuanganAdmin.html", {
            username: req.user.username,
            rows: rowsHtml,
            searchQuery: searchQuery || ''
        });
        res.send(html);
    } catch (err) {
        console.error("Database error saat mengambil laporan keuangan admin:", err);
        res.status(500).send("<h1>Server Error</h1><p>Gagal memuat laporan keuangan admin.</p>");
    }
});

app.post('/daftarUser/delete', isAdmin, async (req, res) => {
    const { username } = req.body;
    try {
        await pool.query('DELETE FROM users WHERE username = ?', [username]);
        res.redirect('/daftarUser');
    } catch (err) {
        console.error("Gagal menghapus pengguna:", err);
        res.status(500).send("Gagal menghapus pengguna.");
    }
});

app.post('/daftarUser/updateRole', isAdmin, async (req, res) => {
    const { username, newRole } = req.body;
    try {
        if (newRole !== 'admin' && newRole !== 'user') {
            return res.status(400).send("Peran tidak valid.");
        }
        await pool.query('UPDATE users SET role = ? WHERE username = ?', [newRole, username]);
        res.redirect('/daftarUser');
    } catch (err) {
        console.error("Gagal mengubah peran pengguna:", err);
        res.status(500).send("Gagal mengubah peran pengguna.");
    }
});

// Rute Daftar Pengguna (Menampilkan 2 Tabel)
app.get('/daftarUser', isAdmin, async (req, res) => {
    try {
        const adminUsers = await getUsersByRole('admin');
        const regularUsers = await getUsersByRole('user');

        let adminRowsHtml = '';
        if (adminUsers && adminUsers.length > 0) {
            adminUsers.forEach(user => {
                adminRowsHtml += `
                    <tr>
                        <td>${user.username}</td>
                        <td>${user.first_name} ${user.last_name}</td>
                        <td>${user.email}</td>
                        <td>${user.phone_number || '-'}</td>
                        <td>
                            <form action="/daftarUser/updateRole" method="POST" style="display:inline-block; margin-right: 5px;">
                                <input type="hidden" name="username" value="${user.username}">
                                <input type="hidden" name="newRole" value="user">
                                <button type="submit" class="action-btn" style="background-color: #e67e22;">Ubah ke User</button>
                            </form>
                            <form action="/daftarUser/delete" method="POST" style="display:inline-block;">
                                <input type="hidden" name="username" value="${user.username}">
                                <button type="submit" class="action-btn" style="background-color: var(--red-alert);">Hapus</button>
                            </form>
                        </td>
                    </tr>
                `;
            });
        } else {
            adminRowsHtml = '<tr><td colspan="5">Tidak ada pengguna admin yang terdaftar.</td></tr>';
        }

        let regularRowsHtml = '';
        if (regularUsers && regularUsers.length > 0) {
            regularUsers.forEach(user => {
                regularRowsHtml += `
                    <tr>
                        <td>${user.username}</td>
                        <td>${user.first_name} ${user.last_name}</td>
                        <td>${user.email}</td>
                        <td>${user.phone_number || '-'}</td>
                        <td>
                            <form action="/daftarUser/updateRole" method="POST" style="display:inline-block; margin-right: 5px;">
                                <input type="hidden" name="username" value="${user.username}">
                                <input type="hidden" name="newRole" value="admin">
                                <button type="submit" class="action-btn" style="background-color: var(--primary-color);">Ubah ke Admin</button>
                            </form>
                            <form action="/daftarUser/delete" method="POST" style="display:inline-block;">
                                <input type="hidden" name="username" value="${user.username}">
                                <button type="submit" class="action-btn" style="background-color: var(--red-alert);">Hapus</button>
                            </form>
                        </td>
                    </tr>
                `;
            });
        } else {
            regularRowsHtml = '<tr><td colspan="5">Tidak ada pengguna biasa yang terdaftar.</td></tr>';
        }

        const html = renderHTML("daftarUser.html", {
            username: req.user.username,
            adminRows: adminRowsHtml,
            regularRows: regularRowsHtml
        });
        res.send(html);
    } catch (err) {
        console.error("Database error saat mengambil daftar pengguna:", err);
        res.status(500).send("<h1>Server Error</h1><p>Gagal memuat daftar pengguna.</p>");
    }
});


// Rute Profil untuk PENGGUNA BIASA
app.get('/profile', isAuthenticated, (req, res) => {
    if (req.session.isGuest) {
        return res.redirect('/login');
    }
    
    if (req.user.role === 'admin') {
        return res.redirect('/profileAdmin');
    }
    const data = {
        username: req.user.username,
        firstName: req.user.first_name,
        lastName: req.user.last_name,
        email: req.user.email || 'belum_ada@gmail.com',
        phoneNumber: req.user.phone_number || '',
        role: req.user.role,
    };
    const html = renderHTML('profile.html', data);
    res.send(html);
});

// Rute Profil untuk ADMIN
app.get('/profileAdmin', isAdmin, (req, res) => {
    const data = {
        username: req.user.username,
        firstName: req.user.first_name,
        lastName: req.user.last_name,
        email: req.user.email || 'belum_ada@gmail.com',
        phoneNumber: req.user.phone_number || '',
        role: req.user.role,
    };
    const html = renderHTML('profileAdmin.html', data);
    res.send(html);
});

// Rute POST untuk update profil (digunakan oleh kedua role)
app.post('/profile/update', isAuthenticated, async (req, res) => {
    if (req.session.isGuest) {
        return res.redirect('/login');
    }
    const { first_name, last_name, email, phone_number } = req.body;
    try {
        await pool.query('UPDATE users SET first_name = ?, last_name = ?, email = ?, phone_number = ? WHERE user_id = ?',
            [first_name, last_name, email, phone_number, req.user.user_id]);
        
        if (req.user.role === 'admin') {
             res.redirect('/profileAdmin');
        } else {
             res.redirect('/profile');
        }
    } catch (err) {
        console.error("Gagal memperbarui profil:", err);
        res.status(500).send("Gagal memperbarui profil.");
    }
});

app.get('/kelolaKamar', isAdmin, async (req, res) => {
    try {
        const kamarList = await getKamarTersedia();
        let kamarHtml = '';

        if (kamarList && kamarList.length > 0) {
            kamarList.forEach(kamar => {
                kamarHtml += `
                    <div class="kamar-item">
                        <img src="https://placehold.co/400x250/3498db/ffffff?text=${encodeURIComponent(kamar.tipe_kamar)}" alt="Foto Kamar ${kamar.tipe_kamar}">
                        <h3>${kamar.tipe_kamar}</h3>
                        <p class="harga">Rp ${kamar.harga.toLocaleString('id-ID')} / bulan</p>
                        <p>${kamar.deskripsi}</p>
                        
                        <div style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px; text-align: center;">
                            <form action="/kelolaKamar/update" method="POST" style="display:inline-block; margin-right: 15px;">
                                <input type="hidden" name="id" value="${kamar.id}">
                                <label for="jumlah-${kamar.id}" style="font-weight: 600;">Tersedia:</label>
                                <input type="number" id="jumlah-${kamar.id}" name="jumlah_tersedia" value="${kamar.jumlah_tersedia}" min="0" style="width: 60px; padding: 5px; border-radius: 4px; border: 1px solid #ddd;">
                                <button type="submit" style="background-color: var(--primary-color); color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Update</button>
                            </form>
                            <form action="/kelolaKamar/delete" method="POST" style="display:inline-block;">
                                <input type="hidden" name="id" value="${kamar.id}">
                                <button type="submit" style="background-color: var(--red-alert); color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Hapus Tipe</button>
                            </form>
                        </div>
                    </div>
                `;
            });
        } else {
            kamarHtml = '<p style="text-align: center;">Tidak ada tipe kamar yang terdaftar. Silakan tambahkan tipe kamar baru di atas.</p>';
        }

        const html = renderHTML("kelolaKamar.html", {
            username: req.user.username,
            kamarList: kamarHtml
        });
        res.send(html);
    } catch (err) {
        console.error("Gagal memuat halaman kelola kamar:", err);
        res.status(500).send("<h1>Server Error</h1><p>Gagal memuat halaman kelola kamar.</p>");
    }
});

app.post('/kelolaKamar/add', isAdmin, async (req, res) => {
    const { tipe_kamar, harga_kamar, deskripsi_kamar, jumlah_tersedia } = req.body;
    try {
        await pool.query('INSERT INTO kamar_tersedia (tipe_kamar, harga, deskripsi, jumlah_tersedia) VALUES (?, ?, ?, ?)', [tipe_kamar, harga_kamar, deskripsi_kamar, jumlah_tersedia]);
        res.redirect('/kelolaKamar');
    } catch (err) {
        console.error("Gagal menambahkan kamar ke database:", err.message);
        res.status(500).send("<h1>Error</h1><p>Gagal menambahkan kamar baru.</p>");
    }
});

app.post('/kelolaKamar/update', isAdmin, async (req, res) => {
    const { id, jumlah_tersedia } = req.body;
    try {
        await pool.query('UPDATE kamar_tersedia SET jumlah_tersedia = ? WHERE id = ?', [jumlah_tersedia, id]);
        res.redirect('/kelolaKamar');
    } catch (err) {
        res.status(500).send("<h1>Error</h1><p>Gagal memperbarui jumlah kamar.</p>");
    }
});

app.post('/kelolaKamar/delete', isAdmin, async (req, res) => {
    const { id } = req.body;
    try {
        await deleteKamar(id);
        res.redirect('/kelolaKamar');
    } catch (err) {
        res.status(500).send("<h1>Error</h1><p>Gagal menghapus kamar.</p>");
    }
});

// Rute untuk menampilkan formulir pemesanan kamar
app.get('/Form', isAuthenticated, async (req, res) => {
    if (req.session.isGuest) {
        return res.redirect('/login');
    }
    
    const { tipe, harga } = req.query;
    if (!tipe || !harga) {
        return res.status(400).send("<h1>Error</h1><p>Parameter tipe dan harga tidak valid.</p>");
    }
    
    const today = new Date().toISOString().split('T')[0];

    const data = {
        username: req.user.username,
        nama: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        email: req.user.email,
        tanggal_sewa: today, 
        tipe_kamar: decodeURIComponent(tipe), 
        hargaKamar: harga,
    };
    const html = renderHTML('Form.html', data);
    res.send(html);
});

app.post('/submitForm', isAuthenticated, async (req, res) => {
    if (req.session.isGuest) {
        return res.redirect('/login');
    }

    const { tipe_kamar, durasi, tanggal_masuk } = req.body;
    const userId = req.user.user_id;

    try {
        const kamar = await getKamarByTipe(tipe_kamar);
        if (!kamar || kamar.jumlah_tersedia <= 0) {
            return res.status(400).send("<h1>Error</h1><p>Kamar yang Anda pilih tidak lagi tersedia.</p>");
        }

        const newJumlah = kamar.jumlah_tersedia - 1;
        await pool.query('UPDATE kamar_tersedia SET jumlah_tersedia = ? WHERE tipe_kamar = ?', [newJumlah, tipe_kamar]);

        // Simpan waktu transaksi yang tepat
        const now = new Date();
        await pool.query('INSERT INTO laporan_keuangan (user_id, tipe_kamar, tanggal_pembayaran) VALUES (?, ?, ?)',
            [userId, tipe_kamar, now]);

        res.redirect('/laporanKeuangan');

    } catch (err) {
        console.error("Gagal memproses pesanan:", err);
        res.status(500).send("<h1>Server Error</h1><p>Gagal memproses pesanan Anda. Silakan coba lagi.</p>");
    }
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy();
        res.redirect('/login');
    });
});

// MODIFIED PORT CONFIGURATION FOR SCALINGO
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});