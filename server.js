// server.js
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// View engine & static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper generate random code
function generateCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// Home: form shorten
app.get('/', async (req, res) => {
  res.render('index', {
    shortUrl: null,
    error: null,
    title: null
  });
});

// Handle shorten
app.post('/shorten', async (req, res) => {
  let { url, title } = req.body;
  url = (url || '').trim();
  title = (title || '').trim();

  if (!url) {
    return res.render('index', {
      shortUrl: null,
      error: 'URL tidak boleh kosong.',
      title
    });
  }

  // Normalisasi & validasi URL
  let parsedTarget;
  try {
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    parsedTarget = new URL(url); // kalau invalid akan throw
  } catch (e) {
    return res.render('index', {
      shortUrl: null,
      error: 'URL tidak valid.',
      title
    });
  }

  // Cegah short URL ke domain sendiri (biar tidak redirect loop)
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const baseHost = new URL(baseUrl).host;
    const targetHost = parsedTarget.host;

    if (baseHost === targetHost) {
      return res.render('index', {
        shortUrl: null,
        error: 'Tidak boleh mensingkat URL dari domain yang sama.',
        title
      });
    }
  } catch (e) {
    // kalau parsing BASE_URL gagal, skip check
    console.warn('Gagal memeriksa host BASE_URL:', e.message);
  }

  // Kalau title kosong, isi default dari host URL
  if (!title) {
    try {
      title = `Konten dari ${parsedTarget.hostname}`;
    } catch (e) {
      title = 'Konten yang kamu minta';
    }
  }

  try {
    let code;
    let isUnique = false;
    // pastikan code unik
    while (!isUnique) {
      code = generateCode(7);
      const [rows] = await pool.query('SELECT id FROM links WHERE code = ?', [code]);
      if (rows.length === 0) isUnique = true;
    }

    await pool.query(
      'INSERT INTO links (code, original_url, title) VALUES (?, ?, ?)',
      [code, url, title]
    );

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const shortUrl = `${baseUrl}/${code}`;

    res.render('index', {
      shortUrl,
      error: null,
      title
    });
  } catch (err) {
    console.error('Error INSERT link:', err);
    res.render('index', {
      shortUrl: null,
      error: 'Terjadi kesalahan pada server.',
      title
    });
  }
});

/**
 * API untuk lanjutkan (AJAX)
 * HARUS di atas route '/:code'
 */
app.get('/api/continue/:code', async (req, res) => {
  const code = req.params.code;

  try {
    const [rows] = await pool.query('SELECT * FROM links WHERE code = ?', [code]);
    if (rows.length === 0) {
      return res.json({ success: false, message: 'Link tidak ditemukan.' });
    }

    const link = rows[0];

    // Update klik
    await pool.query('UPDATE links SET clicks = clicks + 1 WHERE id = ?', [link.id]);

    return res.json({
      success: true,
      url: link.original_url
    });
  } catch (err) {
    console.error('Error API continue:', err);
    return res.json({ success: false, message: 'Kesalahan server.' });
  }
});

// Halaman redirect (tampilkan artikel + iklan + tombol lanjut)
app.get('/:code', async (req, res) => {
  const code = req.params.code;

  try {
    const [rows] = await pool.query('SELECT * FROM links WHERE code = ?', [code]);
    if (rows.length === 0) {
      return res.status(404).send('Link tidak ditemukan.');
    }

    const link = rows[0];

    res.render('redirect', {
      code: link.code,
      title: link.title || 'Konten yang kamu minta'
    });
  } catch (err) {
    console.error('Error render redirect:', err);
    res.status(500).send('Terjadi kesalahan pada server.');
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
