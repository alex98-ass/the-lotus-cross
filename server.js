// The Lotus Cross — Backend Server (PostgreSQL version)
// Express + PostgreSQL (pg) + bcryptjs + nodemailer
// Runs: enrollment, member portal, admin panel, emails.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

// ===== DATABASE (PostgreSQL) =====
// Uses DATABASE_URL env var (Supabase / Render / local). Falls back to local Postgres.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/lotus',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      country TEXT,
      age INTEGER,
      tradition TEXT,
      message TEXT,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'pending',
      rank INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      last_task_date TEXT,
      enrolled_at TIMESTAMPTZ DEFAULT now(),
      approved_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS tasks_done (
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (user_id, task_id, date)
    );
  `);
  // Seed default admin if none exists
  const res = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role='admin'");
  if (res.rows[0].c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query("INSERT INTO users (name, email, password_hash, role, status) VALUES ($1,$2,$3,$4,$5)",
      ['Administrator', 'admin@thelotuscross.org', hash, 'admin', 'approved']);
    console.log('==============================================');
    console.log('  DEFAULT ADMIN CREATED');
    console.log('  Email: admin@thelotuscross.org');
    console.log('  Password: admin123');
    console.log('  CHANGE THIS AFTER FIRST LOGIN!');
    console.log('==============================================');
  }
}

// ===== EMAIL =====
// Primary: Resend HTTP API (set RESEND_API_KEY). Fallback: SMTP (SMTP_*). Otherwise: log only.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'The Lotus Cross <onboarding@resend.dev>';

let transporter = null;
if (!RESEND_API_KEY && process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  console.log('SMTP email configured.');
}

function sendEmail(to, subject, html) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const logLine = `\n[${new Date().toISOString()}] TO: ${to}\nSUBJECT: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}\n${'='.repeat(60)}`;
  fs.appendFileSync(path.join(DATA_DIR, 'emails.log'), logLine);

  if (RESEND_API_KEY) {
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html })
    })
      .then(async (r) => {
        if (r.ok) { console.log('Email sent via Resend to', to); }
        else { const t = await r.text(); console.log('Resend failed:', r.status, t.slice(0, 200)); }
      })
      .catch(e => console.log('Resend error:', e.message));
  }

  if (transporter) {
    return transporter.sendMail({ from: EMAIL_FROM, to, subject, html })
      .then(() => console.log('Email sent to', to))
      .catch(e => console.log('Email send failed:', e.message));
  }

  console.log('Email logged only (no transport configured) to', to);
  return Promise.resolve();
}

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [token, userId, expires]);
  return token;
}

async function getUserFromToken(token) {
  if (!token) return null;
  const s = await pool.query("SELECT * FROM sessions WHERE token=$1 AND expires_at > now()", [token]);
  if (s.rows.length === 0) return null;
  const u = await pool.query("SELECT * FROM users WHERE id=$1", [s.rows[0].user_id]);
  return u.rows[0] || null;
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ===== RANKS =====
const RANKS = [
  { id: 0, name: 'Seeker', icon: '🌱', xpNeeded: 7 },
  { id: 1, name: 'Initiate', icon: '🌿', xpNeeded: 30 },
  { id: 2, name: 'Disciple', icon: '🔥', xpNeeded: 90 },
  { id: 3, name: 'Elder', icon: '⭐', xpNeeded: 200 },
  { id: 4, name: 'Guide', icon: '✦', xpNeeded: 500 }
];
function calcRank(tasks) {
  if (tasks >= 200) return 4;
  if (tasks >= 90) return 3;
  if (tasks >= 30) return 2;
  if (tasks >= 7) return 1;
  return 0;
}

// ===== PUBLIC API =====
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/enroll', async (req, res) => {
  try {
    const { name, email, country, age, tradition, message } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const existing = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with this email already exists' });
    const info = await pool.query(
      "INSERT INTO users (name, email, country, age, tradition, message, role, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [name, email, country || '', age || null, tradition || '', message || '', 'member', 'pending']);
    const userId = info.rows[0].id;
    const admins = await pool.query("SELECT email FROM users WHERE role='admin'");
    admins.rows.forEach(a => {
      sendEmail(a.email, 'New Enrollment: ' + name,
        `<h2>New enrollment request</h2><p><strong>${name}</strong> (${email}) wants to join The Lotus Cross.</p>
         <p>Country: ${country || '—'}<br>Age: ${age || '—'}<br>Tradition: ${tradition || '—'}</p>
         <p>Message: ${message || '—'}</p>
         <p>Log in to the admin panel to approve or reject.</p>`);
    });
    sendEmail(email, 'Welcome to The Lotus Cross',
      `<h2>✦ Welcome, ${name}</h2>
       <p>Your enrollment request has been received. Our community will review it shortly.</p>
       <p>Once approved, you will receive access to the Member Portal.</p>
       <p>— The Lotus Cross</p>`);
    res.json({ ok: true, message: 'Enrollment submitted. Check your email for confirmation.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== AUTH =====
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = (await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase().trim()])).rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status !== 'approved') return res.status(403).json({ error: 'Your enrollment is still pending approval' });
    const token = await createSession(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, rank: user.rank } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.post('/api/logout', requireAuth, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token=$1", [req.token]);
  res.json({ ok: true });
});

// ===== MEMBER =====
app.get('/api/member/dashboard', requireAuth, async (req, res) => {
  const u = req.user;
  const today = new Date().toISOString().slice(0, 10);
  const done = await pool.query("SELECT task_id FROM tasks_done WHERE user_id=$1 AND date=$2", [u.id, today]);
  res.json({
    user: { id: u.id, name: u.name, email: u.email, country: u.country, age: u.age, tradition: u.tradition,
      rank: u.rank, xp: u.xp, tasks_completed: u.tasks_completed, streak: u.streak, enrolled_at: u.enrolled_at },
    ranks: RANKS, doneToday: done.rows.map(r => r.task_id), today
  });
});

app.post('/api/member/task', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.body;
    const u = req.user;
    const today = new Date().toISOString().slice(0, 10);
    const validTasks = ['meditate', 'kindness', 'scripture', 'mindful', 'reflect'];
    if (!validTasks.includes(taskId)) return res.status(400).json({ error: 'Invalid task' });
    const existing = await pool.query("SELECT * FROM tasks_done WHERE user_id=$1 AND task_id=$2 AND date=$3", [u.id, taskId, today]);
    if (existing.rows.length > 0) {
      await pool.query("DELETE FROM tasks_done WHERE user_id=$1 AND task_id=$2 AND date=$3", [u.id, taskId, today]);
      await pool.query("UPDATE users SET tasks_completed = GREATEST(0, tasks_completed - 1), xp = GREATEST(0, xp - 10) WHERE id=$1", [u.id]);
    } else {
      await pool.query("INSERT INTO tasks_done (user_id, task_id, date) VALUES ($1,$2,$3)", [u.id, taskId, today]);
      let streak = u.streak || 0;
      if (u.last_task_date !== today) {
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        streak = (u.last_task_date === y) ? streak + 1 : 1;
      }
      await pool.query("UPDATE users SET tasks_completed = tasks_completed + 1, xp = xp + 10, streak=$1, last_task_date=$2 WHERE id=$3", [streak, today, u.id]);
    }
    const updated = (await pool.query("SELECT * FROM users WHERE id=$1", [u.id])).rows[0];
    const newRank = calcRank(updated.tasks_completed);
    if (newRank !== updated.rank) {
      await pool.query("UPDATE users SET rank=$1 WHERE id=$2", [newRank, u.id]);
      sendEmail(updated.email, 'You have advanced to ' + RANKS[newRank].name,
        `<h2>✦ Congratulations, ${updated.name}!</h2><p>You have advanced to the rank of <strong>${RANKS[newRank].name}</strong> ${RANKS[newRank].icon}.</p><p>Continue walking.</p>`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = (await pool.query("SELECT id, name, email, country, age, tradition, message, role, status, rank, tasks_completed, streak, enrolled_at, approved_at FROM users ORDER BY enrolled_at DESC")).rows;
  res.json({ users });
});

app.post('/api/admin/approve', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [userId])).rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  await pool.query("UPDATE users SET status='approved', approved_at=now() WHERE id=$1", [userId]);
  sendEmail(user.email, 'You are approved! Welcome to The Lotus Cross',
    `<h2>✦ Welcome, ${user.name}!</h2>
     <p>Your enrollment has been <strong>approved</strong>. You are now a member of The Lotus Cross.</p>
     <p>Visit the site and log in with your email. Use "Set Password" on the login page if you have not set one.</p>
     <p>Your journey begins now. — The Lotus Cross</p>`);
  res.json({ ok: true });
});

app.post('/api/admin/reject', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  await pool.query("UPDATE users SET status='rejected' WHERE id=$1", [userId]);
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [userId])).rows[0];
  if (user) sendEmail(user.email, 'Update on your enrollment',
    `<h2>Dear ${user.name},</h2><p>After careful consideration, we are unable to approve your enrollment at this time.</p><p>You are welcome to reapply in the future. — The Lotus Cross</p>`);
  res.json({ ok: true });
});

app.post('/api/set-password', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Valid email and password (min 6 chars) required' });
  const user = (await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase().trim()])).rows[0];
  if (!user) return res.status(404).json({ error: 'No account found with this email' });
  const hash = bcrypt.hashSync(password, 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, user.id]);
  res.json({ ok: true, message: 'Password set. You can now log in.' });
});

// ===== START =====
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('==============================================');
    console.log('  ✦ The Lotus Cross server running');
    console.log('  Public site:  http://localhost:' + PORT + '/');
    console.log('  Login:        http://localhost:' + PORT + '/login.html');
    console.log('  Admin panel:  http://localhost:' + PORT + '/admin.html');
    console.log('==============================================');
  });
}).catch(e => {
  console.error('Database init failed:', e.message);
  console.error('Set DATABASE_URL to a PostgreSQL connection string (e.g. Supabase).');
  process.exit(1);
});
