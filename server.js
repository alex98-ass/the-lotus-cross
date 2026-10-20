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
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_optin BOOLEAN DEFAULT true");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS challenge_started_at TEXT");
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS errors (
    id SERIAL PRIMARY KEY, where_ TEXT, message TEXT, stack TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY, actor_id INTEGER, actor_email TEXT, action TEXT, target TEXT, meta TEXT,
    created_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free'");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tier_required TEXT DEFAULT 'free'");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_lifetime BOOLEAN DEFAULT false");
  await pool.query(`CREATE TABLE IF NOT EXISTS live_sessions (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    minutes INTEGER DEFAULT 60,
    join_url TEXT,
    notes TEXT,
    tier_required TEXT DEFAULT 'supporter',
    created_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending TEXT");
  await pool.query("INSERT INTO settings (key,value) VALUES ('last_daily_send','') ON CONFLICT (key) DO NOTHING");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interest (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      tier TEXT DEFAULT 'supporter',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
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
  // Insert any practice that is not in the database yet, so the ladder can grow safely.
  let added = 0;
  for (let i = 0; i < PRACTICES.length; i++) {
    const p = PRACTICES[i];
    const exists = await pool.query("SELECT 1 FROM tasks WHERE title=$1 LIMIT 1", [p.title]);
    if (exists.rowCount === 0) {
      await pool.query(
        "INSERT INTO tasks (title, description, category, xp, sort_order, min_count, requires_proof, proof_hint, tier_required) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)",
        [p.title, p.desc, 'service', p.xp, 10 + i, p.min, p.hint, p.tier || 'free']);
      added++;
    }
  }
  if (added) console.log('  Practices added to the ladder: ' + added);
  for (let i = 0; i < PRACTICES.length; i++) {
    const p = PRACTICES[i];
    await pool.query("UPDATE tasks SET tier_required=$1, min_count=$2 WHERE title=$3 AND requires_proof=true",
      [p.tier || 'free', p.min, p.title]);
  }
  await loadEmailConfig();
  // Seed/refresh daily reflections — upsert so new entries extend the cycle
  for (let i = 0; i < REFLECTIONS.length; i++) {
    const r = REFLECTIONS[i];
    await pool.query("INSERT INTO reflections (day_index, title, body, practice, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (day_index) DO NOTHING",
      [i, r.title, r.body, r.practice, r.source]);
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

// Live configuration, changeable from the admin panel — no redeploy, no domain required
// if the provider verifies a single sender address (Brevo does).
let emailCfg = {
  provider: RESEND_API_KEY ? 'resend' : (transporter ? 'smtp' : 'none'),
  from: EMAIL_FROM,
  brevoKey: ''
};

async function loadEmailConfig() {
  try {
    const rows = (await pool.query("SELECT key, value FROM settings WHERE key IN ('email_provider','email_from','brevo_key')")).rows;
    const map = {};
    rows.forEach(function (r) { map[r.key] = r.value; });
    if (map.email_provider) emailCfg.provider = map.email_provider;
    if (map.email_from) emailCfg.from = map.email_from;
    emailCfg.brevoKey = typeof map.brevo_key === 'string' ? map.brevo_key : '';
    console.log('Email config: provider=' + emailCfg.provider + ' from=' + emailCfg.from);
  } catch (e) { console.error('email config load failed', e.message); }
}

function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  if (m) return { name: m[1] || 'The Lotus Cross', email: m[2] };
  return { name: 'The Lotus Cross', email: String(from || '').trim() };
}

function sendEmail(to, subject, html) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const logLine = `\n[${new Date().toISOString()}] TO: ${to}\nSUBJECT: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}\n${'='.repeat(60)}`;
  fs.appendFileSync(path.join(DATA_DIR, 'emails.log'), logLine);

  const cfg = emailCfg;

  // Brevo: verifies a single sender address, so it works without owning a domain.
  if (cfg.provider === 'brevo' && cfg.brevoKey) {
    const sender = parseFrom(cfg.from);
    return fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': cfg.brevoKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ sender: sender, to: [{ email: to }], subject: subject, htmlContent: html })
    })
      .then(async (r) => {
        const body = await r.text();
        if (r.ok) { console.log('Email sent via Brevo to', to); return { ok: true, via: 'brevo' }; }
        console.log('Brevo failed:', r.status, body.slice(0, 300));
        await recordError('email:' + to, new Error('Brevo ' + r.status + ' ' + body.slice(0, 300)));
        return { ok: false, status: r.status, body: body.slice(0, 600), via: 'brevo' };
      })
      .catch(async (e) => {
        console.log('Brevo error:', e.message);
        await recordError('email:' + to, e);
        return { ok: false, error: e.message, via: 'brevo' };
      });
  }

  if (cfg.provider === 'resend' && RESEND_API_KEY) {
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [to], subject: subject, html: html })
    })
      .then(async (r) => {
        if (r.ok) { console.log('Email sent via Resend to', to); return { ok: true, via: 'resend' }; }
        const body = await r.text();
        console.log('Resend failed:', r.status, body.slice(0, 300));
        await recordError('email:' + to, new Error('Resend ' + r.status + ' ' + body.slice(0, 300)));
        return { ok: false, status: r.status, body: body.slice(0, 600), via: 'resend' };
      })
      .catch(async (e) => {
        console.log('Resend error:', e.message);
        await recordError('email:' + to, e);
        return { ok: false, error: e.message, via: 'resend' };
      });
  }

  if (transporter) {
    return transporter.sendMail({ from: cfg.from, to: to, subject: subject, html: html })
      .then(() => { console.log('Email sent to', to); return { ok: true, via: 'smtp' }; })
      .catch(async (e) => {
        console.log('Email send failed:', e.message);
        await recordError('email:' + to, e);
        return { ok: false, error: e.message, via: 'smtp' };
      });
  }

  console.log('Email logged only (no transport configured) to', to);
  return Promise.resolve({ ok: false, error: 'no transport configured' });
}

// ===== MIDDLEWARE =====
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));

// ===== RATE LIMITING (in-memory; the app runs as a single instance) =====
const rateBuckets = new Map();
function rateLimit(max, windowMs) {
  return function (req, res, next) {
    const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || 'unknown').trim();
    const key = req.path + '|' + ip;
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; rateBuckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - b.start)) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}
setInterval(function () {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now - v.start > 3600000) rateBuckets.delete(k);
}, 600000).unref();

// ===== ERROR CAPTURE (so a crash is visible, not silent) =====
async function recordError(where, err) {
  try {
    await pool.query("INSERT INTO errors (where_, message, stack) VALUES ($1,$2,$3)",
      [String(where).slice(0, 120), String(err && err.message || err).slice(0, 800), String(err && err.stack || '').slice(0, 4000)]);
  } catch (e) { console.error('error-log failed', e.message); }
}
app.use(express.static(PUBLIC_DIR));
// A free-tier server sleeps; any visit wakes it. The first visit of a new day sends the daily reflection.
app.use(function (req, res, next) {
  if (req.method === 'GET') { sendDailyReflection(false).catch(function () {}); }
  next();
});

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

app.post('/api/enroll', rateLimit(5, 60 * 60 * 1000), async (req, res) => {
  try {
    const { name, email, country, age, tradition, message, ref } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const existing = await pool.query("SELECT * FROM users WHERE email=$1", [String(email).toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (!ex.password_hash) {
        return res.status(409).json({ error: 'This email is already registered, but no password has been set for it yet. Use “Set your password” on the sign-in page — or ask us for a setup link.' });
      }
      return res.status(409).json({ error: 'This email already has an account. Please sign in instead, or use “Set your password” if you have forgotten it.' });
    }
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

// ===== AUDIT + TWO-FACTOR =====
async function audit(actor, action, target, meta) {
  try {
    await pool.query("INSERT INTO audit_log (actor_id, actor_email, action, target, meta) VALUES ($1,$2,$3,$4,$5)",
      [actor && actor.id || null, actor && actor.email || null, String(action).slice(0, 80), String(target || '').slice(0, 200), String(meta || '').slice(0, 500)]);
  } catch (e) { console.error('audit failed', e.message); }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secret, counter) {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}
function verifyTotp(secret, code) {
  const step = Math.floor(Date.now() / 30000);
  for (let d = -1; d <= 1; d++) if (totpCode(secret, step + d) === String(code)) return true;
  return false;
}

// ===== AUTH =====
app.post('/api/login', rateLimit(12, 10 * 60 * 1000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = (await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase().trim()])).rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status !== 'approved') return res.status(403).json({ error: 'Your enrollment is still pending approval' });
    // Two-factor, if the account has it enabled
    if (user.totp_secret) {
      const code = String(req.body.code || '').replace(/\s+/g, '');
      if (!code) return res.status(401).json({ needs2fa: true, error: 'Enter the six-digit code from your authenticator app' });
      if (!verifyTotp(user.totp_secret, code)) {
        await audit(user, 'login.2fa_failed', user.email, '');
        return res.status(401).json({ needs2fa: true, error: 'That code is not valid. Codes change every 30 seconds.' });
      }
    }
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
    "SELECT id, title, description, category, xp, min_count, requires_proof, proof_hint, COALESCE(tier_required,'free') AS tier_required FROM tasks WHERE active=true AND COALESCE(min_count,0) <= $1 ORDER BY COALESCE(min_count,0), sort_order, id LIMIT 20",
    [u.tasks_completed || 0])).rows;
  const visibleTasks = tasks.filter(t => !t.tier_required || t.tier_required === 'free' || entitled(u, t.tier_required));
  const proofsToday = (await pool.query(
    "SELECT task_id, status, id FROM proofs WHERE user_id=$1 AND date=$2 ORDER BY created_at DESC", [u.id, today])).rows;
  const reflection = await reflectionForToday();
  const circle = (await pool.query("SELECT * FROM circles WHERE steward_id=$1", [u.id])).rows[0] || null;
  const challenge = await challengeState(u);
  const brought = (await pool.query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='approved')::int AS approved FROM users WHERE referred_by=$1", [u.id])).rows[0];
  res.json({
    user: { id: u.id, name: u.name, email: u.email, country: u.country, age: u.age, tradition: u.tradition,
      rank: u.rank, xp: u.xp, tasks_completed: u.tasks_completed, streak: u.streak, enrolled_at: u.enrolled_at,
      referral_code: u.referral_code },
    ranks: RANKS, tasks: visibleTasks, doneToday: done.rows.map(r => r.task_id), today,
    proofsToday: proofsToday, reflection: reflection, circle: circle, brought: brought, challenge: challenge,
    tier: u.tier || 'free', tierLifetime: !!u.tier_lifetime, tiers: TIERS, features: entitlementsFor(u)
  });
});

// ===== DAILY REFLECTION =====
app.get('/api/reflection/today', requireAuth, async (req, res) => {
  try {
    const r = await reflectionForToday();
    res.json({ reflection: r, date: todayKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== WHAT EACH PLAN AND RANK UNLOCKS =====
const TIER_ORDER = { free: 0, supporter: 1, circle: 2 };
const TIERS = {
  free:      { name: 'Seeker',    price: 'Free',        blurb: 'The whole practice, forever free.' },
  supporter: { name: 'Supporter', price: '£5 / month',  blurb: 'Live gatherings and the library.' },
  circle:    { name: 'Circle',    price: '£9.99 / month', blurb: 'Everything, plus guidance and a licence to lead.' }
};
function tierRank(u) { return TIER_ORDER[(u && u.tier) || 'free'] || 0; }
function entitled(u, need) { return tierRank(u) >= (TIER_ORDER[need] || 0); }

// Every gated item in the portal, in one place, so the rules cannot drift apart.
// minRank refers to the practice ranks (0–5); need refers to the plan.
const FEATURES = [
  { key: 'today',      label: "Today's reflection", need: 'free',      minRank: 0 },
  { key: 'tasks',      label: 'Daily practices',    need: 'free',      minRank: 0 },
  { key: 'community',  label: 'The community',      need: 'free',      minRank: 0 },
  { key: 'forty',      label: 'The Forty Days',     need: 'free',      minRank: 0 },
  { key: 'reading',    label: 'The reading room',   need: 'supporter', minRank: 0 },
  { key: 'live',       label: 'Live gatherings',    need: 'supporter', minRank: 0 },
  { key: 'library',    label: 'The Library',        need: 'supporter', minRank: 0 },
  { key: 'scriptorium',label: 'The Scriptorium',    need: 'circle',    minRank: 0 },
  { key: 'guidance',   label: 'Quarterly guidance', need: 'circle',    minRank: 2 },
  { key: 'circle',     label: 'Steward a circle',   need: 'circle',    minRank: 5 }
];

function entitlementsFor(u) {
  return FEATURES.map(function (f) {
    return {
      key: f.key, label: f.label, need: f.need, minRank: f.minRank,
      unlocked: entitled(u, f.need) && (u.rank || 0) >= f.minRank
    };
  });
}

// ===== LEADERBOARD (the reason people come back tomorrow) =====
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT id, name, country, rank, xp, streak, tasks_completed
       FROM users WHERE status='approved' AND role<>'admin' AND COALESCE(is_demo,false)=false
       ORDER BY tasks_completed DESC, streak DESC, xp DESC LIMIT 12`)).rows;
    const board = rows.map(function (u, i) {
      const parts = String(u.name || '').trim().split(/\s+/);
      const short = parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
      return { pos: i + 1, name: short, country: u.country, rank: u.rank, xp: u.xp, streak: u.streak, tasks_completed: u.tasks_completed };
    });
    const total = (await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE status='approved' AND role<>'admin' AND COALESCE(is_demo,false)=false")).rows[0].c;
    res.json({ leaderboard: board, total: total, ranks: RANKS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== FOUNDING MEMBERS (people who want the paid tier before it exists) =====
app.post('/api/interest', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const name = String(req.body.name || '').slice(0, 120);
    const tier = ['free', 'supporter', 'circle', 'shop'].includes(req.body.tier) ? req.body.tier : 'supporter';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    await pool.query(
      `INSERT INTO interest (name, email, tier, note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET tier=$3, name=COALESCE(NULLIF($1,''), interest.name)`,
      [name, email, tier, String(req.body.note || '').slice(0, 500)]);
    sendEmail(email, 'You are on the founding list — The Lotus Cross',
      `<h2>✦ Thank you, ${name || 'friend'}</h2>
       <p>You are on the list for the founding places. When the supporter tier opens, you will be the first told — and the first invited.</p>
       <p>In the meantime the whole path is free: the daily practice, the reflections, the community.</p>
       <p><a href="${process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com'}/index.html">Begin here</a></p>`);
    const count = (await pool.query("SELECT COUNT(*)::int AS c FROM interest")).rows[0].c;
    res.json({ ok: true, position: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/interest', requireAuth, requireAdmin, async (req, res) => {
  const rows = (await pool.query("SELECT * FROM interest ORDER BY created_at DESC LIMIT 200")).rows;
  res.json({ interest: rows, count: rows.length });
});

// ===== DAILY RITUAL EMAIL (triggered by a free scheduled job) =====
function unsubToken(id) {
  return crypto.createHmac('sha256', process.env.CRON_SECRET || 'lotus-dev-secret').update(String(id)).digest('hex').slice(0, 20);
}
app.get('/api/unsubscribe', async (req, res) => {
  const id = parseInt(req.query.u, 10), t = String(req.query.t || '');
  if (!id || t !== unsubToken(id)) return res.status(400).send('Invalid link');
  await pool.query("UPDATE users SET email_optin=false WHERE id=$1", [id]);
  res.send('<p style="font-family:Georgia,serif;padding:2rem">You will no longer receive the daily reflection. The door stays open.</p>');
});

// Sends today's reflection once per day. Claimed atomically, so it is safe to call often.
async function sendDailyReflection(force) {
  const today = todayKey();
  const claim = await pool.query(
    "UPDATE settings SET value=$1 WHERE key='last_daily_send' AND value<>$1 RETURNING value", [today]);
  if (!claim.rowCount && !force) return { ok: false, reason: 'already sent today' };
  const r = await reflectionForToday();
  if (!r) return { ok: false, reason: 'no reflection' };
  const users = (await pool.query(
    "SELECT id, name, email FROM users WHERE status='approved' AND COALESCE(email_optin,true)=true AND COALESCE(is_demo,false)=false AND email IS NOT NULL")).rows;
  const base = process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com';
  let sent = 0;
  for (const u of users) {
    await sendEmail(u.email, r.title + ' — today at The Lotus Cross',
      `<h2>✦ ${r.title}</h2>
       <p style="font-size:16px;line-height:1.7">${r.body}</p>
       ${r.practice ? '<p><strong>Today\'s practice:</strong> ' + r.practice + '</p>' : ''}
       <p style="color:#777">— ${r.source || 'The Lotus Cross'}</p>
       <p><a href="${base}/portal.html">Open your portal →</a></p>
       <p style="font-size:11px;color:#999">You receive this because you are a member. <a href="${base}/api/unsubscribe?u=${u.id}&t=${unsubToken(u.id)}">Unsubscribe</a></p>`);
    sent++;
  }
  // Data minimisation: evidence photographs are kept for 180 days, then the image is dropped.
  await pool.query("UPDATE proofs SET image='' WHERE created_at < now() - interval '180 days' AND image<>''");
  return { ok: true, sent: sent, reflection: r.title, date: today };
}

app.get('/api/cron/daily', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await sendDailyReflection(true));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cron/daily-legacy', async (req, res) => {
  try {
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET not set' });
    if (String(req.query.key || '') !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Forbidden' });
    const r = await reflectionForToday();
    if (!r) return res.json({ ok: false, reason: 'no reflection' });
    const users = (await pool.query(
      "SELECT id, name, email FROM users WHERE status='approved' AND COALESCE(email_optin,true)=true AND COALESCE(is_demo,false)=false AND email IS NOT NULL")).rows;
    const base = process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com';
    let sent = 0;
    for (const u of users) {
      await sendEmail(u.email, r.title + ' — today at The Lotus Cross',
        `<h2>✦ ${r.title}</h2>
         <p style="font-size:16px;line-height:1.7">${r.body}</p>
         ${r.practice ? '<p><strong>Today\'s practice:</strong> ' + r.practice + '</p>' : ''}
         <p style="color:#777">— ${r.source || 'The Lotus Cross'}</p>
         <p><a href="${base}/portal.html">Open your portal →</a></p>
         <p style="font-size:11px;color:#999">You receive this because you are a member. <a href="${base}/api/unsubscribe?u=${u.id}&t=${unsubToken(u.id)}">Unsubscribe</a></p>`);
      sent++;
    }
    res.json({ ok: true, sent: sent, reflection: r.title, date: todayKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== THE READING ROOM (Supporter and above) =====
const READING_PLAN = [
  ['Week 1',  'Dhammapada 1–2',            'Which verse describes a mind I recognise as mine?'],
  ['Week 2',  'Imitation, Book I 1–3',     'Where am I performing rather than practising?'],
  ['Week 3',  'Gita 1–2',                  'What is my duty when I would rather withdraw?'],
  ['Week 4',  'Cloud of Unknowing 1–3',    'What do I keep thinking about instead of praying?'],
  ['Week 5',  'Tao 1–10',                  'What would doing less look like this week?'],
  ['Week 6',  'Dhammapada 3–4',            'What am I clinging to that has already gone?'],
  ['Week 7',  'Imitation, Book II',        'What comfort am I unwilling to give up?'],
  ['Week 8',  'Gita 3–4',                  'Where does my action come from — fear or offering?'],
  ['Week 9',  'Isa Upanishad',             'What would change if everything were already sacred?'],
  ['Week 10', 'Tao 11–20',                 'Which emptiness am I afraid of?'],
  ['Week 11', 'Katha Upanishad',           'What would I do differently if this year were the last?'],
  ['Week 12', 'Gita 12, then return',      'What has changed, and what was I only pretending to change?']
];

app.get('/api/member/reading', requireAuth, async (req, res) => {
  try {
    if (!entitled(req.user, 'supporter')) {
      return res.status(403).json({ error: 'The reading room is part of the Supporter plan.', need: 'supporter' });
    }
    res.json({ plan: READING_PLAN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== THE SCRIPTORIUM (Circle only) =====
app.get('/api/member/scriptorium', requireAuth, async (req, res) => {
  try {
    if (!entitled(req.user, 'circle')) {
      return res.status(403).json({ error: 'The Scriptorium is part of the Circle plan.', need: 'circle' });
    }
    const items = [
      { title: 'Karma and grace — the argument', kind: 'Notes', note: 'Six pages on why we hold both, without collapsing one into the other.' },
      { title: 'The Cloud and the Void', kind: 'Notes', note: 'Where The Cloud of Unknowing and Zen say the same thing, and where they do not.' },
      { title: 'Reading the Gita without a battle', kind: 'Audio', note: 'Forty minutes, on why the battlefield is your kitchen.' },
      { title: 'Marginalia', kind: 'Letters', note: 'The notes I made in the margins over four years of reading.' }
    ];
    res.json({ items: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== LIVE GATHERINGS (Supporter and above) =====
app.get('/api/member/live', requireAuth, async (req, res) => {
  try {
    if (!entitled(req.user, 'supporter')) {
      return res.status(403).json({ error: 'Live gatherings are part of the Supporter plan.', need: 'supporter' });
    }
    const rows = (await pool.query(
      "SELECT id, title, starts_at, minutes, join_url, notes FROM live_sessions WHERE starts_at > now() - interval '3 hours' ORDER BY starts_at ASC LIMIT 20")).rows;
    res.json({ sessions: rows, tier: req.user.tier || 'free' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== THE LIBRARY (Supporter and above) =====
app.get('/api/member/library', requireAuth, async (req, res) => {
  try {
    if (!entitled(req.user, 'supporter')) {
      return res.status(403).json({ error: 'The Library is part of the Supporter plan.', need: 'supporter' });
    }
    const items = [
      { title: 'The twelve-week reading plan', kind: 'PDF', note: 'One page, printable, on the fridge.' },
      { title: 'Practice sheets — the first ten days', kind: 'PDF', note: 'A page per day, with space to write.' },
      { title: 'The monthly letter', kind: 'Letter', note: 'Plain text, once a month, no design.' },
      { title: 'Recordings of past gatherings', kind: 'Audio', note: 'Nothing is deleted.' }
    ];
    res.json({ items: items });
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

app.get('/api/admin/live', requireAuth, requireAdmin, async (req, res) => {
  const rows = (await pool.query("SELECT * FROM live_sessions ORDER BY starts_at DESC LIMIT 50")).rows;
  res.json({ sessions: rows });
});

app.post('/api/admin/live', requireAuth, requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const starts = String(req.body.starts_at || '').trim();
    if (!title || !starts) return res.status(400).json({ error: 'Title and start time are required' });
    const when = new Date(starts);
    if (isNaN(when.getTime())) return res.status(400).json({ error: 'That start time is not valid' });
    const row = (await pool.query(
      "INSERT INTO live_sessions (title, starts_at, minutes, join_url, notes, tier_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [title, when.toISOString(), parseInt(req.body.minutes, 10) || 60, String(req.body.join_url || '').trim(), String(req.body.notes || '').slice(0, 500), 'supporter'])).rows[0];
    await audit(req.user, 'live.created', title, when.toISOString());
    res.json({ ok: true, session: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/live/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM live_sessions WHERE id=$1", [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
});

app.post('/api/admin/set-tier', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tier = ['free', 'supporter', 'circle'].includes(req.body.tier) ? req.body.tier : null;
    if (!tier) return res.status(400).json({ error: 'Unknown plan' });
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [parseInt(req.body.userId, 10)])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    await pool.query("UPDATE users SET tier=$1, tier_lifetime=$2 WHERE id=$3", [tier, !!req.body.lifetime, user.id]);
    await audit(req.user, 'member.tier_set', user.email, tier);
    res.json({ ok: true, tier: tier });
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

// ===== THE FORTY DAYS — a shared challenge, the way the big apps hold people =====
const CHALLENGE_DAYS = 40;
async function challengeState(u) {
  const start = u.challenge_started_at;
  if (!start) return { started: false, days: CHALLENGE_DAYS, daysDone: 0, percent: 0, dayNumber: 0 };
  const done = (await pool.query(
    "SELECT COUNT(DISTINCT date)::int AS c FROM tasks_done WHERE user_id=$1 AND date >= $2", [u.id, start])).rows[0].c;
  const elapsed = Math.max(1, Math.round((new Date(todayKey()) - new Date(start)) / 86400000) + 1);
  return {
    started: true, start: start, days: CHALLENGE_DAYS,
    daysDone: Math.min(done, CHALLENGE_DAYS),
    dayNumber: Math.min(elapsed, CHALLENGE_DAYS),
    percent: Math.min(100, Math.round(done / CHALLENGE_DAYS * 100)),
    complete: done >= CHALLENGE_DAYS
  };
}

app.get('/api/member/challenge', requireAuth, async (req, res) => {
  try { res.json(await challengeState(req.user)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/member/challenge/start', requireAuth, async (req, res) => {
  try {
    if (req.user.challenge_started_at) return res.status(409).json({ error: 'You have already begun the forty days' });
    const start = todayKey();
    await pool.query("UPDATE users SET challenge_started_at=$1 WHERE id=$2", [start, req.user.id]);
    sendEmail(req.user.email, 'Your forty days begin today',
      `<h2>✦ Forty days</h2><p>One practice a day, for forty days. Not to earn anything — to see what happens to a person who keeps showing up.</p>
       <p><a href="${process.env.PUBLIC_URL || 'https://the-lotus-cross.onrender.com'}/portal.html">Begin day one →</a></p>`);
    res.json({ ok: true, start: start, days: CHALLENGE_DAYS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== PROOFS (outward practices, evidenced and reviewed) =====
app.post('/api/member/proof', requireAuth, rateLimit(20, 60 * 60 * 1000), async (req, res) => {
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
    if (task.tier_required && task.tier_required !== 'free' && !entitled(u, task.tier_required)) {
      return res.status(403).json({ error: 'This practice belongs to the ' + (task.tier_required === 'circle' ? 'Circle' : 'Supporter') + ' plan' });
    }
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
    const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
    const rows = (await pool.query(
      `SELECT p.id, p.user_id, p.task_id, p.date, p.caption, p.status, p.created_at,
              t.title AS task_title, u.name AS member_name, u.email AS member_email, u.rank AS member_rank
       FROM proofs p JOIN tasks t ON t.id=p.task_id JOIN users u ON u.id=p.user_id
       WHERE p.status=$1 AND ($2::int IS NULL OR p.user_id=$2)
       ORDER BY p.created_at ASC LIMIT 100`, [status, userId])).rows;
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
      await audit(req.user, 'proof.rejected', 'proof ' + proofId, note);
      return res.json({ ok: true, status: 'rejected' });
    }
    await pool.query("UPDATE proofs SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3", [req.user.id, note, proofId]);
    await audit(req.user, 'proof.approved', 'proof ' + proofId + ' / task ' + p.task_id, '');
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
  const users = (await pool.query("SELECT id, name, email, country, age, tradition, message, role, status, rank, tasks_completed, streak, enrolled_at, approved_at, COALESCE(is_demo,false) AS is_demo, (password_hash IS NOT NULL) AS has_password, COALESCE(tier,'free') AS tier FROM users ORDER BY enrolled_at DESC")).rows;
  res.json({ users });
});

app.post('/api/admin/approve', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [userId])).rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  await pool.query("UPDATE users SET status='approved', approved_at=now() WHERE id=$1", [userId]);
  await audit(req.user, 'member.approved', user.email, '');
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
  await audit(req.user, 'member.rejected', user.email, '');
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
    await audit(req.user, 'member.rank_set', user.email, 'rank ' + r);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Password setup/reset — token-based only. Never allow setting a password from an email alone.
app.post('/api/request-reset', rateLimit(5, 60 * 60 * 1000), async (req, res) => {
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

app.post('/api/set-password', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
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

// ===== TWO-FACTOR MANAGEMENT (admin) =====
app.post('/api/admin/2fa/setup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const secret = b32encode(crypto.randomBytes(20));
    await pool.query("UPDATE users SET totp_pending=$1 WHERE id=$2", [secret, req.user.id]);
    const label = encodeURIComponent('The Lotus Cross:' + req.user.email);
    res.json({
      secret: secret,
      otpauth: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=The%20Lotus%20Cross&digits=6&period=30',
      instructions: 'Add this to Google Authenticator, Authy, 1Password or Aegis, then enter the six-digit code to turn it on.'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/2fa/enable', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pending = req.user.totp_pending;
    if (!pending) return res.status(400).json({ error: 'Start the setup first' });
    const code = String(req.body.code || '').replace(/\s+/g, '');
    if (!verifyTotp(pending, code)) return res.status(400).json({ error: 'That code is not valid — check the clock on your phone and try the next one.' });
    await pool.query("UPDATE users SET totp_secret=$1, totp_pending=NULL WHERE id=$2", [pending, req.user.id]);
    await audit(req.user, 'admin.2fa_enabled', req.user.email, '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/2fa/disable', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!req.user.totp_secret) return res.json({ ok: true, alreadyOff: true });
    if (!bcrypt.compareSync(String(req.body.password || ''), req.user.password_hash || '')) return res.status(401).json({ error: 'Password required' });
    await pool.query("UPDATE users SET totp_secret=NULL, totp_pending=NULL WHERE id=$1", [req.user.id]);
    await audit(req.user, 'admin.2fa_disabled', req.user.email, '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/2fa/status', requireAuth, requireAdmin, async (req, res) => {
  res.json({ enabled: !!req.user.totp_secret, pending: !!req.user.totp_pending });
});

// Admin: when an email does not arrive, the link must still be obtainable.
app.post('/api/admin/send-setup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [parseInt(req.body.userId, 10)])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const link = await issueSetupLink(user);
    const mail = await sendEmail(user.email, 'Set your password — The Lotus Cross',
      `<h2>✦ Set your password, ${user.name}</h2>
       <p>Use this link within seven days to choose your password:</p>
       <p><a href="${link}">${link}</a></p>
       <p>If you did not ask for this, ignore this email — nothing has changed.</p>`);
    await audit(req.user, 'member.setup_link', user.email, mail && mail.ok ? 'emailed' : 'email failed: ' + JSON.stringify(mail).slice(0, 120));
    res.json({ ok: true, link: link, email: mail || { ok: false } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Is email actually able to reach members? Surfaced in the admin panel.
app.get('/api/admin/email-config', requireAuth, requireAdmin, async (req, res) => {
  const sandbox = emailCfg.provider === 'resend' && /resend\.dev/i.test(emailCfg.from);
  res.json({
    provider: emailCfg.provider,
    from: emailCfg.from,
    sandbox: sandbox,
    hasBrevoKey: !!emailCfg.brevoKey,
    hasResendKey: !!RESEND_API_KEY,
    note: sandbox
      ? 'Resend is in test mode: it will only deliver to the address that owns the Resend account. Switch to Brevo (a sender address is enough) or verify a domain.'
      : (emailCfg.provider === 'none' ? 'No provider configured — nothing is being sent.' : 'Configured via ' + emailCfg.provider + '.')
  });
});

// Change the sender without touching environment variables or redeploying.
app.get('/api/admin/email-settings', requireAuth, requireAdmin, (req, res) => {
  res.json({
    provider: emailCfg.provider,
    from: emailCfg.from,
    brevoKeyMasked: emailCfg.brevoKey ? '••••••' + emailCfg.brevoKey.slice(-4) : '',
    available: { brevo: true, resend: !!RESEND_API_KEY, smtp: !!transporter }
  });
});

app.post('/api/admin/email-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const provider = ['brevo', 'resend', 'smtp', 'none'].includes(req.body.provider) ? req.body.provider : null;
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    const from = String(req.body.from || '').trim();
    if (provider !== 'none' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((from.match(/<([^>]+)>/) || [null, from])[1] || '')) {
      return res.status(400).json({ error: 'A valid sender address is required' });
    }
    const key = String(req.body.brevoKey || '').trim();
    if (provider === 'brevo' && !key && !emailCfg.brevoKey) return res.status(400).json({ error: 'A Brevo API key is required' });

    await pool.query("INSERT INTO settings (key,value) VALUES ('email_provider',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [provider]);
    if (from) await pool.query("INSERT INTO settings (key,value) VALUES ('email_from',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [from]);
    if (key) await pool.query("INSERT INTO settings (key,value) VALUES ('brevo_key',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [key]);
    else if (provider !== 'brevo') await pool.query("INSERT INTO settings (key,value) VALUES ('brevo_key','') ON CONFLICT (key) DO UPDATE SET value=''");
    await loadEmailConfig();
    await audit(req.user, 'email.settings', provider, from);
    res.json({ ok: true, provider: emailCfg.provider, from: emailCfg.from });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: prove whether email delivery works, and see exactly what the provider says.
app.get('/api/admin/email-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = String(req.query.to || req.user.email);
    const r = await sendEmail(to, 'The Lotus Cross — delivery test',
      '<h2>✦ Test</h2><p>If you are reading this, delivery works.</p>');
    res.json({ to, result: r, from: emailCfg.from, provider: emailCfg.provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== OVERSIGHT: AUDIT TRAIL, ERRORS, BACKUP =====
app.get('/api/admin/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = (await pool.query("SELECT id, actor_email, action, target, meta, created_at FROM audit_log ORDER BY id DESC LIMIT 200")).rows;
    res.json({ entries: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/errors', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = (await pool.query("SELECT id, where_, message, created_at FROM errors ORDER BY id DESC LIMIT 100")).rows;
    const count = (await pool.query("SELECT COUNT(*)::int AS c FROM errors WHERE created_at > now() - interval '7 days'")).rows[0].c;
    res.json({ errors: rows, last7days: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Everything a person would need to rebuild the community, without secrets and without photographs.
app.get('/api/admin/backup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = (await pool.query(
      "SELECT id,name,email,country,age,tradition,role,status,rank,xp,tasks_completed,streak,enrolled_at,approved_at,referral_code,referred_by,challenge_started_at FROM users ORDER BY id")).rows;
    const tasks = (await pool.query("SELECT * FROM tasks ORDER BY id")).rows;
    const done = (await pool.query("SELECT * FROM tasks_done ORDER BY date")).rows;
    const proofs = (await pool.query("SELECT id,user_id,task_id,date,caption,status,reviewed_by,reviewed_at,review_note FROM proofs ORDER BY id")).rows;
    const messages = (await pool.query("SELECT id,sender_id,receiver_id,channel,body,created_at FROM messages ORDER BY id")).rows;
    const circles = (await pool.query("SELECT * FROM circles")).rows;
    const reports = (await pool.query("SELECT * FROM circle_reports")).rows;
    const interest = (await pool.query("SELECT * FROM interest")).rows;
    const audits = (await pool.query("SELECT * FROM audit_log ORDER BY id")).rows;
    const payload = { exported_at: new Date().toISOString(), users, tasks, tasks_done: done, proofs, messages, circles, circle_reports: reports, interest, audit_log: audits };
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', 'attachment; filename="lotus-backup-' + todayKey() + '.json"');
    res.send(JSON.stringify(payload));
    await audit(req.user, 'admin.backup', 'all', users.length + ' users');
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
process.on('unhandledRejection', function (e) { console.error('Unhandled rejection:', e); recordError('unhandledRejection', e); });
process.on('uncaughtException', function (e) { console.error('Uncaught exception:', e); recordError('uncaughtException', e); });

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
