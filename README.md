# ✦ The Lotus Cross — Full System (PostgreSQL)

Sistem complet pentru comunitatea spirituală The Lotus Cross:
- **Pagina publică** — înrolare (formular)
- **Portal membri** — sarcini zilnice, rank-uri, progres
- **Panou admin** — vezi înrolările, aprobi/respingi, vezi membrii
- **Emailuri** — confirmare la înrolare, notificare admin, aprobare/respingere

Acum folosește **PostgreSQL** (nu SQLite), deci datele persistă pe hosting.

---

## 🚀 Rulare locală

### 1. Instalează PostgreSQL local (opțional, doar pentru test)
Sau setează `DATABASE_URL` către un Postgres existent.

### 2. Pornește serverul
```
npm install
node server.js
```
Sau dublu-click pe `start.bat`.

### 3. Deschide site-ul
- **Pagina publică:** http://localhost:3000/
- **Login:** http://localhost:3000/login.html
- **Panou admin:** http://localhost:3000/admin.html

---

## 🔑 Contul de admin (IMPORTANT)

La prima pornire se creează automat un admin:

| | |
|---|---|
| **Email** | `admin@thelotuscross.org` |
| **Parolă** | `admin123` |

> ⚠️ **SCHIMBĂ PAROLA** după primul login!

---

## 🌍 Publicare online GRATUIT (Render + Supabase)

### Pasul 1 — Creează baza de date gratuită pe Supabase
1. Mergi la **https://supabase.com** → Sign Up (gratuit)
2. Creează un **New Project** (dă-i un nume, setează o parolă de DB)
3. Din meniul stânga: **Settings → Database → Connection string**
4. Copiază **URI**-ul (începe cu `postgresql://...`)

### Pasul 2 — Creează contul pe Render
1. Mergi la **https://render.com** → Sign Up (gratuit, cu GitHub sau email)
2. Click **New → Web Service**
3. Conectează-ți repo-ul GitHub (sau folosește "Public Git Repository" cu link-ul)
4. Render detectează automat `render.yaml` — confirmă

### Pasul 3 — Setează variabilele de mediu
În Render, la serviciul tău: **Environment → Add Environment Variable**
```
DATABASE_URL = <URI-ul de la Supabase de la Pasul 1>
```
(Opțional, pentru emailuri reale: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)

### Pasul 4 — Deploy
Click **Deploy**. Render îți dă un URL ca:
```
https://the-lotus-cross.onrender.com
```
Acesta e link-ul tău public — curat, nu arată a scam.

---

## ⚠️ Limitări tier-ul gratuit Render
- **Adoarme după 15 min inactiv** — prima vizită durează ~50s să se trezească
- **Datele NU se pierd** (sunt în Supabase, nu pe Render) ✅
- Pentru "mereu pornit" instant, trebuie tier plătit (~$7/lună)

---

## 📧 Emailuri reale

**Implicit**, emailurile sunt doar **logate** în `data/emails.log`. Ca să trimită emailuri reale, setează variabilele SMTP (vezi `.env.example`). Pentru Gmail: activează "2-Step Verification" și generează o "App Password".

---

## 📁 Structura fișierelor

```
server/
├── server.js          ← backend (Express + PostgreSQL)
├── package.json
├── Procfile           ← pentru Render
├── render.yaml        ← blueprint Render
├── .env.example       ← template variabile de mediu
├── .gitignore
├── start.bat          ← script de pornire Windows
├── data/              ← log emailuri (dacă nu e SMTP)
└── public/
    ├── index.html     ← pagina publică (înrolare)
    ├── login.html     ← login membri + admin
    ├── portal.html    ← portal membri (sarcini, rank-uri)
    └── admin.html     ← panou admin
```

---

## 🛠️ Funcționalități

### Membri
- 5 sarcini zilnice (meditație, bunătate, scriptură, mindful, reflecție)
- Fiecare sarcină = +10 XP
- 5 rank-uri: Seeker → Initiate → Disciple → Elder → Guide
- Streak (zile consecutive)
- Email automat la avansarea de rank

### Admin
- Vezi toate înrolările (pending / approved / rejected)
- Aprobi / respingi membri
- Vezi detalii: țară, vârstă, tradiție, rank, tasks, streak
- Statistici live

---

## ⚠️ Note de securitate
- Schimbă parola adminului implicit (`admin123`) imediat
- Nu expune `data/` public
- Folosește HTTPS (Render o face automat)
- Adaugă rate-limiting dacă site-ul devine public (prevenire spam)
