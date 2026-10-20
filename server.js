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
const REFLECTIONS = require('./reflections');
const PRACTICES = require('./practices');

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
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'daily',
      xp INTEGER DEFAULT 10,
      active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS reflections (
      id SERIAL PRIMARY KEY,
      day_index INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      practice TEXT,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS circles (
      id SERIAL PRIMARY KEY,
      steward_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      city TEXT,
      country TEXT,
      model TEXT DEFAULT 'licensed_circle',
      remit_pct INTEGER DEFAULT 25,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS circle_reports (
      id SERIAL PRIMARY KEY,
      circle_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      gross_pence INTEGER NOT NULL DEFAULT 0,
      remit_pence INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (circle_id, period)
    );
  `);
  // Migration: single-level referral (who brought this member)
  // Progression: practices unlock as the member advances; later ones require photo evidence
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS min_count INTEGER DEFAULT 0");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_proof BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_hint TEXT DEFAULT ''");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proofs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      caption TEXT,
      image TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS proofs_status_idx ON proofs(status)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users(referral_code) WHERE referral_code IS NOT NULL");
  // Backfill invitation codes for existing members
  await pool.query(`
    UPDATE users SET referral_code = COALESCE(NULLIF(lower(regexp_replace(split_part(name,' ',1),'[^a-zA-Z]','','g')),''),'friend')
      || '-' || substr(md5(random()::text || id::text),1,6)
    WHERE referral_code IS NULL`);
  // Migration: add channel column to messages (for topic channels)
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'general'");
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
  // Seed default tasks if none exist
  const tc = await pool.query("SELECT COUNT(*)::int AS c FROM tasks");
  if (tc.rows[0].c === 0) {
    const defaults = [
      ['Meditation (10 minutes)', 'Sit in stillness. Breathe. Observe your mind without judgment. This is the medicine for a restless mind.', 'daily', 10, 0],
      ['Act of Kindness', 'Do one deliberate act of kindness for another person. No matter how small.', 'daily', 10, 1],
      ['Scripture Reading', 'Read a passage from any sacred text (Bible, Dhammapada, Bhagavad Gita) and reflect on its meaning for your life.', 'daily', 10, 2],
      ['Mindful Action', 'Perform one ordinary task (washing dishes, walking, eating) with full mindful awareness.', 'daily', 10, 3],
      ['Self-Reflection', 'At day\u2019s end, reflect: what did I do well? What could I do better? What karma did I create?', 'daily', 10, 4]
    ];
    for (const d of defaults) {
      await pool.query("INSERT INTO tasks (title, description, category, xp, sort_order) VALUES ($1,$2,$3,$4,$5)", d);
    }
    console.log('  Default tasks seeded.');
  }
  // Seed the ladder of outward practices (from the 10th practice onward, with photo evidence)
  const pc = await pool.query("SELECT COUNT(*)::int AS c FROM tasks WHERE requires_proof = true");
  if (pc.rows[0].c === 0) {
    let i = 0;
    for (const p of PRACTICES) {
      await pool.query(
        "INSERT INTO tasks (title, description, category, xp, sort_order, min_count, requires_proof, proof_hint) VALUES ($1,$2,$3,$4,$5,$6,true,$7)",
        [p.title, p.desc, 'service', p.xp, 10 + i, p.min, p.hint]);
      i++;
    }
    console.log('  Ladder of practices seeded (' + PRACTICES.length + ').');
  }
  // Seed daily reflections (30, rotating by calendar day)
  const rc = await pool.query("SELECT COUNT(*)::int AS c FROM reflections");
  if (rc.rows[0].c === 0) {
    for (let i = 0; i < REFLECTIONS.length; i++) {
      const r = REFLECTIONS[i];
      await pool.query("INSERT INTO reflections (day_index, title, body, practice, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (day_index) DO NOTHING",
        [i, r.title, r.body, r.practice, r.source]);
    }
    console.log('  Daily reflections seeded (' + REFLECTIONS.length + ').');
  }
}

// Deterministic "today" helpers — no cron needed, works even on a sleeping free tier
function todayKey() { return new Date().toISOString().slice(0, 10); }
function dayOfYear() {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}
async function reflectionForToday() {
  const total = (await pool.query("SELECT COUNT(*)::int AS c FROM reflections")).rows[0].c;
  if (!total) return null;
  const idx = dayOfYear() % total;
  const r = (await pool.query("SELECT * FROM reflections WHERE day_index=$1", [idx])).rows[0];
  return r || null;
}
function makeReferralCode(name) {
  const base = (name || 'friend').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'friend';
  return base + '-' + crypto.randomBytes(3).toString('hex');
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
app.use(express.json({ limit: '6mb' }));
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
  { id: 4, name: 'Guide', icon: '✦', xpNeeded: 400 },
  { id: 5, name: 'Steward', icon: '🪷', xpNeeded: 500 }
];
function calcRank(tasks) {
  if (tasks >= 500) return 5;
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
    const { name, email, country, age, tradition, message, ref } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const existing = await pool.query("SELECT * FROM users WHERE email=$1", [String(email).toLowerCase().trim()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with this email already exists' });
    // Single-level referral: who invited this person (informational, no payout attached)
    let referrerId = null;
    if (ref) {
      const r = await pool.query("SELECT id FROM users WHERE referral_code=$1 AND status='approved'", [String(ref).trim()]);
      referrerId = r.rows.length ? r.rows[0].id : null;
    }
    const code = makeReferralCode(name);
    const info = await pool.query(
      "INSERT INTO users (name, email, country, age, tradition, message, role, status, referred_by, referral_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [name, email, country || '', age || null, tradition || '', message || '', 'member', 'pending', referrerId, code]);
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
  const tasks = (await pool.query(
    "SELECT id, title, description, category, xp, min_count, requires_proof, proof_hint FROM tasks WHERE active=true AND COALESCE(min_count,0) <= $1 ORDER BY COALESCE(min_count,0) DESC, sort_order, id LIMIT 12",
    [u.tasks_completed || 0])).rows;
  const proofsToday = (await pool.query(
    "SELECT task_id, status, id FROM proofs WHERE user_id=$1 AND date=$2 ORDER BY created_at DESC", [u.id, today])).rows;
  const reflection = await reflectionForToday();
  const circle = (await pool.query("SELECT * FROM circles WHERE steward_id=$1", [u.id])).rows[0] || null;
  const brought = (await pool.query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='approved')::int AS approved FROM users WHERE referred_by=$1", [u.id])).rows[0];
  res.json({
    user: { id: u.id, name: u.name, email: u.email, country: u.country, age: u.age, tradition: u.tradition,
      rank: u.rank, xp: u.xp, tasks_completed: u.tasks_completed, streak: u.streak, enrolled_at: u.enrolled_at,
      referral_code: u.referral_code },
    ranks: RANKS, tasks: tasks, doneToday: done.rows.map(r => r.task_id), today,
    proofsToday: proofsToday, reflection: reflection, circle: circle, brought: brought
  });
});

// ===== DAILY REFLECTION =====
app.get('/api/reflection/today', requireAuth, async (req, res) => {
  try {
    const r = await reflectionForToday();
    res.json({ reflection: r, date: todayKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CIRCLES (rank 5 Stewards) =====
// A Steward runs a local circle: a real, in-person or online study group that charges
// for real teaching/service. The circle remits 25% of its gross receipts to The Lotus Cross
// as a licence fee. It is NOT a franchise sold for income, and members' donations are not
// redirected — the circle's own receipts are what is declared.
app.get('/api/member/circle', requireAuth, async (req, res) => {
  try {
    const circle = (await pool.query("SELECT * FROM circles WHERE steward_id=$1", [req.user.id])).rows[0] || null;
    let reports = [];
    if (circle) {
      reports = (await pool.query("SELECT * FROM circle_reports WHERE circle_id=$1 ORDER BY period DESC LIMIT 12", [circle.id])).rows;
    }
    res.json({ circle: circle, reports: reports, eligible: (req.user.rank || 0) >= 5 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/member/circle', requireAuth, async (req, res) => {
  try {
    if ((req.user.rank || 0) < 5) return res.status(403).json({ error: 'Only Stewards (rank 5) may open a circle' });
    const { name, city, country } = req.body;
    if (!name) return res.status(400).json({ error: 'Circle name required' });
    const exists = (await pool.query("SELECT id FROM circles WHERE steward_id=$1", [req.user.id])).rows[0];
    if (exists) return res.status(409).json({ error: 'You already steward a circle' });
    const c = (await pool.query(
      "INSERT INTO circles (steward_id, name, city, country, remit_pct) VALUES ($1,$2,$3,$4,25) RETURNING *",
      [req.user.id, name, city || '', country || req.user.country || ''])).rows[0];
    sendEmail(req.user.email, 'Your circle is open',
      `<h2>🪷 ${name}</h2><p>Your circle is now registered under The Lotus Cross. You keep 75% of what the circle receives for its teaching and service; 25% is remitted to the mother community each month.</p><p>Declare your monthly receipts honestly in the portal. Nothing else is asked of you.</p>`);
    res.json({ ok: true, circle: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/member/circle/report', requireAuth, async (req, res) => {
  try {
    const circle = (await pool.query("SELECT * FROM circles WHERE steward_id=$1", [req.user.id])).rows[0];
    if (!circle) return res.status(404).json({ error: 'No circle found' });
    const period = String(req.body.period || '').trim(); // e.g. 2026-10
    const gross = Math.round(Number(req.body.gross || 0) * 100);
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period must be YYYY-MM' });
    if (!isFinite(gross) || gross < 0) return res.status(400).json({ error: 'Invalid amount' });
    const remit = Math.round(gross * (circle.remit_pct / 100));
    await pool.query(
      `INSERT INTO circle_reports (circle_id, period, gross_pence, remit_pence, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (circle_id, period) DO UPDATE SET gross_pence=$3, remit_pence=$4, note=$5`,
      [circle.id, period, gross, remit, String(req.body.note || '').slice(0, 500)]);
    res.json({ ok: true, gross: gross / 100, remit: remit / 100, keep: (gross - remit) / 100 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/member/referrals', requireAuth, async (req, res) => {
  try {
    const people = (await pool.query(
      "SELECT id, name, country, rank, status, enrolled_at FROM users WHERE referred_by=$1 ORDER BY enrolled_at DESC", [req.user.id])).rows;
    const me = (await pool.query("SELECT referral_code FROM users WHERE id=$1", [req.user.id])).rows[0];
    res.json({ people: people, count: people.length, approved: people.filter(p => p.status === 'approved').length,
      referral_code: me ? me.referral_code : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/circles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const circles = (await pool.query(
      `SELECT c.*, u.name AS steward_name, u.email AS steward_email,
              COALESCE((SELECT SUM(remit_pence) FROM circle_reports r WHERE r.circle_id=c.id),0)::int AS total_remit
       FROM circles c JOIN users u ON u.id=c.steward_id ORDER BY c.created_at DESC`)).rows;
    res.json({ circles: circles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/member/task', requireAuth, async (req, res) => {
  try {
    const taskId = String(req.body.taskId);
    const u = req.user;
    const today = new Date().toISOString().slice(0, 10);
    const task = (await pool.query("SELECT id, xp, requires_proof FROM tasks WHERE id=$1 AND active=true", [parseInt(taskId, 10)])).rows[0];
    if (!task) return res.status(400).json({ error: 'Invalid task' });
    if (task.requires_proof) return res.status(400).json({ error: 'This practice is credited only after a photograph is reviewed' });
    const xp = task.xp || 10;
    const existing = await pool.query("SELECT * FROM tasks_done WHERE user_id=$1 AND task_id=$2 AND date=$3", [u.id, taskId, today]);
    if (existing.rows.length > 0) {
      await pool.query("DELETE FROM tasks_done WHERE user_id=$1 AND task_id=$2 AND date=$3", [u.id, taskId, today]);
      await pool.query("UPDATE users SET tasks_completed = GREATEST(0, tasks_completed - 1), xp = GREATEST(0, xp - $1) WHERE id=$2", [xp, u.id]);
    } else {
      await pool.query("INSERT INTO tasks_done (user_id, task_id, date) VALUES ($1,$2,$3)", [u.id, taskId, today]);
      let streak = u.streak || 0;
      if (u.last_task_date !== today) {
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        streak = (u.last_task_date === y) ? streak + 1 : 1;
      }
      await pool.query("UPDATE users SET tasks_completed = tasks_completed + 1, xp = xp + $1, streak=$2, last_task_date=$3 WHERE id=$4", [xp, streak, today, u.id]);
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

// ===== PROOFS (outward practices, evidenced and reviewed) =====
app.post('/api/member/proof', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    const taskId = parseInt(req.body.taskId, 10);
    const image = String(req.body.image || '');
    const caption = String(req.body.caption || '').slice(0, 400);
    if (!taskId) return res.status(400).json({ error: 'Task required' });
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)) return res.status(400).json({ error: 'A photograph is required (JPEG or PNG)' });
    if (image.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'The photograph is too large. Please use a smaller one.' });
    const task = (await pool.query("SELECT * FROM tasks WHERE id=$1 AND active=true", [taskId])).rows[0];
    if (!task) return res.status(404).json({ error: 'Practice not found' });
    if (!task.requires_proof) return res.status(400).json({ error: 'This practice does not need a photograph' });
    if ((task.min_count || 0) > (u.tasks_completed || 0)) return res.status(403).json({ error: 'This practice is not yet unlocked for you' });
    const today = todayKey();
    const dup = (await pool.query("SELECT id FROM proofs WHERE user_id=$1 AND task_id=$2 AND date=$3", [u.id, taskId, today])).rows[0];
    if (dup) return res.status(409).json({ error: 'You have already submitted evidence for this practice today' });
    const row = (await pool.query(
      "INSERT INTO proofs (user_id, task_id, date, caption, image) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [u.id, taskId, today, caption, image])).rows[0];
    const validators = (await pool.query("SELECT email FROM users WHERE role='admin'")).rows.map(r => r.email);
    validators.forEach(mail => sendEmail(mail, 'Practice awaiting review: ' + u.name,
      `<h2>Evidence submitted</h2><p><strong>${u.name}</strong> submitted a photograph for “${task.title}”.</p><p>Open the admin panel to approve or decline it.</p>`));
    res.json({ ok: true, id: row.id, status: 'pending' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/member/proofs', requireAuth, async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT p.id, p.task_id, p.date, p.caption, p.status, p.review_note, p.created_at, t.title
       FROM proofs p JOIN tasks t ON t.id=p.task_id
       WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 40`, [req.user.id])).rows;
    res.json({ proofs: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/proofs/:id/image', requireAuth, async (req, res) => {
  try {
    const p = (await pool.query("SELECT * FROM proofs WHERE id=$1", [parseInt(req.params.id, 10)])).rows[0];
    if (!p) return res.status(404).send('Not found');
    const allowed = p.user_id === req.user.id || req.user.role === 'admin' || (req.user.rank || 0) >= 4;
    if (!allowed) return res.status(403).send('Forbidden');
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(p.image);
    if (!m) return res.status(500).send('Bad image');
    res.set('Content-Type', m[1]).set('Cache-Control', 'private, max-age=3600').send(Buffer.from(m[2], 'base64'));
  } catch (e) { res.status(500).send('Error'); }
});

// Reviewing evidence is the work of Guides (rank 4+) and admins
async function requireValidator(req, res, next) {
  if (req.user.role === 'admin' || (req.user.rank || 0) >= 4) return next();
  return res.status(403).json({ error: 'Only Guides and Stewards may review evidence' });
}

app.get('/api/admin/proofs', requireAuth, requireValidator, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = (await pool.query(
      `SELECT p.id, p.task_id, p.date, p.caption, p.status, p.created_at,
              t.title AS task_title, u.name AS member_name, u.email AS member_email, u.rank AS member_rank
       FROM proofs p JOIN tasks t ON t.id=p.task_id JOIN users u ON u.id=p.user_id
       WHERE p.status=$1 ORDER BY p.created_at ASC LIMIT 60`, [status])).rows;
    res.json({ proofs: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/proofs/:id/review', requireAuth, requireValidator, async (req, res) => {
  try {
    const proofId = parseInt(req.params.id, 10);
    const action = req.body.action === 'approve' ? 'approve' : 'reject';
    const note = String(req.body.note || '').slice(0, 400);
    const p = (await pool.query("SELECT * FROM proofs WHERE id=$1", [proofId])).rows[0];
    if (!p) return res.status(404).json({ error: 'Evidence not found' });
    if (p.status !== 'pending') return res.status(409).json({ error: 'Already reviewed' });
    const task = (await pool.query("SELECT * FROM tasks WHERE id=$1", [p.task_id])).rows[0];
    if (action === 'reject') {
      await pool.query("UPDATE proofs SET status='rejected', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3", [req.user.id, note, proofId]);
      return res.json({ ok: true, status: 'rejected' });
    }
    await pool.query("UPDATE proofs SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3", [req.user.id, note, proofId]);
    // Credit the practice (once per day, like any other)
    const xp = task.xp || 20;
    await pool.query("INSERT INTO tasks_done (user_id, task_id, date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.user_id, p.task_id, p.date]);
    const u2 = (await pool.query("SELECT * FROM users WHERE id=$1", [p.user_id])).rows[0];
    let streak = u2.streak || 0;
    if (u2.last_task_date !== p.date) {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      streak = (u2.last_task_date === y) ? streak + 1 : 1;
    }
    await pool.query("UPDATE users SET tasks_completed = tasks_completed + 1, xp = xp + $1, streak=$2, last_task_date=$3 WHERE id=$4",
      [xp, streak, p.date, p.user_id]);
    const updated = (await pool.query("SELECT * FROM users WHERE id=$1", [p.user_id])).rows[0];
    const newRank = calcRank(updated.tasks_completed);
    if (newRank !== updated.rank) {
      await pool.query("UPDATE users SET rank=$1 WHERE id=$2", [newRank, u2.id]);
      sendEmail(updated.email, 'You have advanced to ' + RANKS[newRank].name,
        `<h2>✦ ${updated.name}, you have advanced</h2><p>You are now <strong>${RANKS[newRank].name}</strong> ${RANKS[newRank].icon}.</p>`);
    }
    sendEmail(updated.email, 'Your practice was accepted',
      `<h2>✓ ${task.title}</h2><p>${req.user.name} accepted the evidence you submitted. The practice has been credited to your path.</p>${note ? '<p>Note: ' + note + '</p>' : ''}`);
    res.json({ ok: true, status: 'approved', xp: xp });
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
  const link = await issueSetupLink(user);
  sendEmail(user.email, 'You are approved! Welcome to The Lotus Cross',
    `<h2>✦ Welcome, ${user.name}!</h2>
     <p>Your enrollment has been <strong>approved</strong>. You are now a member of The Lotus Cross.</p>
     <p>Set your password with this link (valid 7 days):</p>
     <p><a href="${link}">${link}</a></p>
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

// ===== ADMIN: TASKS =====
app.get('/api/admin/tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tasks = (await pool.query("SELECT * FROM tasks ORDER BY sort_order, id")).rows;
    res.json({ tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, category, xp } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
    const info = await pool.query(
      "INSERT INTO tasks (title, description, category, xp) VALUES ($1,$2,$3,$4) RETURNING *",
      [title.trim(), description || '', category || 'daily', parseInt(xp, 10) || 10]
    );
    res.json({ ok: true, task: info.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = (await pool.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
    if (!t) return res.status(404).json({ error: 'Task not found' });
    const { title, description, category, xp, active } = req.body;
    await pool.query(
      "UPDATE tasks SET title=$1, description=$2, category=$3, xp=$4, active=$5 WHERE id=$6",
      [title != null ? title : t.title, description != null ? description : t.description, category != null ? category : t.category, xp != null ? parseInt(xp, 10) : t.xp, active != null ? active : t.active, id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query("DELETE FROM tasks WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: RANK =====
app.post('/api/admin/set-rank', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, rank } = req.body;
    const r = parseInt(rank, 10);
    if (isNaN(r) || r < 0 || r > 5) return res.status(400).json({ error: 'Invalid rank (0-5)' });
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [userId])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const thresholds = [0, 7, 30, 90, 200, 500];
    await pool.query("UPDATE users SET rank=$1, tasks_completed=$2 WHERE id=$3", [r, thresholds[r], user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Password setup/reset — token-based only. Never allow setting a password from an email alone.
app.post('/api/request-reset', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = (await pool.query("SELECT id, name, email FROM users WHERE email=$1", [email])).rows[0];
    // Always answer the same way, so this cannot be used to discover accounts
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1,$2,now()+interval '2 hours')", [token, user.id]);
      const base = process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com';
      sendEmail(user.email, 'Set your password — The Lotus Cross',
        `<h2>✦ Set your password, ${user.name}</h2>
         <p>Use this link within 2 hours to choose your password:</p>
         <p><a href="${base}/portal.html?setpw=${token}">${base}/portal.html?setpw=${token}</a></p>
         <p>If you did not ask for this, ignore this email — nothing has changed.</p>`);
    }
    res.json({ ok: true, message: 'If that email has an account, a link is on its way.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || String(password).length < 8) return res.status(400).json({ error: 'A valid link and a password of at least 8 characters are required' });
    const row = (await pool.query(
      "SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at > now()", [String(token)])).rows[0];
    if (!row) return res.status(400).json({ error: 'This link is invalid or has expired. Request a new one.' });
    const hash = bcrypt.hashSync(String(password), 10);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, row.user_id]);
    await pool.query("UPDATE password_resets SET used=true WHERE token=$1", [row.token]);
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
    res.json({ ok: true, message: 'Password set. You can now log in.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: issue a setup link for a member (used on approval and on demand)
async function issueSetupLink(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1,$2,now()+interval '7 days')", [token, user.id]);
  return (process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com') + '/portal.html?setpw=' + token;
}

// ===== MESSAGING (community chat + direct messages) =====

// Member directory: all approved members except self
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const users = (await pool.query(
      `SELECT id, name, country, age, tradition, rank, tasks_completed, streak, enrolled_at
       FROM users WHERE status='approved' AND id != $1 ORDER BY name ASC`,
      [req.user.id]
    )).rows;
    res.json({ members: users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get messages: ?with=<userId> = DM thread; otherwise global community chat
app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const withId = req.query.with ? parseInt(req.query.with, 10) : null;
    let rows;
    if (withId) {
      rows = (await pool.query(
        `SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)
         ORDER BY m.created_at ASC LIMIT 300`,
        [req.user.id, withId]
      )).rows;
    } else {
      const channel = (req.query.channel || 'general').toString();
      rows = (await pool.query(
        `SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.receiver_id IS NULL AND m.channel=$1
         ORDER BY m.created_at DESC LIMIT 200`,
        [channel]
      )).rows;
      rows.reverse();
    }
    res.json({ messages: rows, me: req.user.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send a message (receiverId omitted = global community chat)
app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const { receiverId, body, channel } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
    if (body.trim().length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    let rid = null;
    if (receiverId) {
      rid = parseInt(receiverId, 10);
      const target = (await pool.query("SELECT id FROM users WHERE id=$1 AND status='approved'", [rid])).rows[0];
      if (!target) return res.status(404).json({ error: 'Member not found' });
    }
    const ch = rid ? null : ((channel || 'general').toString());
    await pool.query("INSERT INTO messages (sender_id, receiver_id, body, channel) VALUES ($1,$2,$3,$4)",
      [req.user.id, rid, body.trim(), ch]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List DM conversation partners (people I've exchanged messages with)
app.get('/api/messages/partners', requireAuth, async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT u.id, u.name, u.rank, u.country,
              (SELECT m2.body FROM messages m2
               WHERE (m2.sender_id=u.id AND m2.receiver_id=$1) OR (m2.sender_id=$1 AND m2.receiver_id=u.id)
               ORDER BY m2.created_at DESC LIMIT 1) AS last_msg
       FROM users u
       WHERE u.id IN (
         SELECT DISTINCT CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END
         FROM messages
         WHERE (sender_id=$1 OR receiver_id=$1) AND receiver_id IS NOT NULL
       )
       ORDER BY (SELECT MAX(m2.created_at) FROM messages m2
                 WHERE (m2.sender_id=u.id AND m2.receiver_id=$1) OR (m2.sender_id=$1 AND m2.receiver_id=u.id)) DESC`,
      [req.user.id]
    )).rows;
    res.json({ partners: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
