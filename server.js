const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'tevetvault_secret_2024_malawi';

// ── SUPABASE CLIENT ─────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhssrsarpsdwxjxzjter.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoc3Nyc2FycHNkd3hqeHpqdGVyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTEyNTM5NiwiZXhwIjoyMDk0NzAxMzk2fQ.W86V2siMDU8Ow-xV9D7SB5qbITmrFGodsT_4rm4OeHg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Supabase URL:', SUPABASE_URL);

// ── EMAIL ───────────────────────────────────────────────────
function createMailer() {
  if (process.env.BREVO_USER && process.env.BREVO_PASS) {
    console.log('Email: Using Brevo SMTP');
    return nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_PASS }
    });
  } else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    console.log('Email: Using Gmail SMTP');
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
  }
  console.log('Email: Demo mode — no credentials set');
  return null;
}
const mailer = createMailer();

function otpEmailHtml(otp, message) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f4f6fa">
    <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <h2 style="color:#1a56db;margin:0 0 8px">TevetVault</h2>
      <p style="color:#374151;font-size:14px;margin-bottom:20px">${message}</p>
      <div style="background:#eff4ff;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
        <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#1a56db">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:13px">This code expires in <strong>10 minutes</strong>.</p>
      <hr style="border:none;border-top:1px solid #e5e8ef;margin:20px 0"/>
      <p style="color:#9ca3af;font-size:12px;margin:0">TevetVault &middot; Student Resource Platform &middot; Malawi</p>
    </div>
  </div>`;
}

async function sendEmail(to, subject, html) {
  if (!mailer) {
    console.log(`[EMAIL DEMO] To: ${to} | Subject: ${subject}`);
    return false;
  }
  const from = process.env.EMAIL_FROM ||
    (process.env.BREVO_USER ? `TevetVault <${process.env.BREVO_USER}>` : `TevetVault <${process.env.EMAIL_USER}>`);
  await mailer.sendMail({ from, to, subject, html });
  console.log(`[EMAIL SENT] To: ${to}`);
  return true;
}

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── FILE UPLOAD (memory — goes to Supabase Storage) ────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf','.doc','.docx','.ppt','.pptx','.txt','.jpg','.jpeg','.png','.gif'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// ── AUTH MIDDLEWARE ─────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── HELPERS ─────────────────────────────────────────────────
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (ext === 'pdf') return 'pdf';
  if (['doc','docx'].includes(ext)) return 'doc';
  if (['ppt','pptx'].includes(ext)) return 'ppt';
  if (['jpg','jpeg','png','gif'].includes(ext)) return 'img';
  if (ext === 'txt') return 'txt';
  return 'other';
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}
function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// Send OTP (registration)
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

  const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10*60*1000).toISOString();

  await supabase.from('otps').delete().eq('email', email);
  await supabase.from('otps').insert({ email, otp, expires_at: expiresAt });

  console.log(`Registration OTP for ${email}: ${otp}`);
  try {
    const sent = await sendEmail(email, 'Your TevetVault verification code',
      otpEmailHtml(otp, 'Use the code below to verify your email address:'));
    if (sent) {
      res.json({ success: true, message: 'Verification code sent to your email' });
    } else {
      res.json({ success: true, message: 'OTP sent', demo_otp: otp });
    }
  } catch (err) {
    console.error('Email error:', err.message);
    res.json({ success: true, message: 'Email failed — use this code', demo_otp: otp });
  }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const { data: record } = await supabase.from('otps').select('*').eq('email', email).eq('otp', otp).single();
  if (!record) return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired' });
  res.json({ success: true, message: 'Email verified' });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, otp, name, username, course, college, password, avatar } = req.body;

  const { data: otpRecord } = await supabase.from('otps').select('*').eq('email', email).eq('otp', otp).single();
  if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });

  const { data: existingEmail } = await supabase.from('users').select('id').eq('email', email).single();
  if (existingEmail) return res.status(400).json({ error: 'Email already taken' });

  const { data: existingUsername } = await supabase.from('users').select('id').eq('username', username).single();
  if (existingUsername) return res.status(400).json({ error: 'Username already taken' });

  if (!name||!username||!course||!college||!password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

  const hashed = bcrypt.hashSync(password, 10);
  const { data: user, error } = await supabase.from('users').insert({
    email, password: hashed, role: 'student',
    name, username, course, college, avatar: avatar || '', verified: true
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('otps').delete().eq('email', email);

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

// Get current user
app.get('/api/auth/me', auth, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safeUser(user));
});

// Update profile
app.put('/api/auth/profile', auth, async (req, res) => {
  const { name, username, college, avatar } = req.body;
  const { data: taken } = await supabase.from('users').select('id').eq('username', username).neq('id', req.user.id).single();
  if (taken) return res.status(400).json({ error: 'Username already taken' });
  const { data: user, error } = await supabase.from('users').update({ name, username, college, avatar }).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(safeUser(user));
});

// Change password
app.put('/api/auth/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword||!newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(400).json({ error: 'Current password is incorrect' });
  await supabase.from('users').update({ password: bcrypt.hashSync(newPassword, 10) }).eq('id', req.user.id);
  res.json({ success: true });
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
  if (!user) return res.status(400).json({ error: 'No account found with that email address' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10*60*1000).toISOString();
  await supabase.from('otps').delete().eq('email', email);
  await supabase.from('otps').insert({ email, otp, expires_at: expiresAt });

  console.log(`Password reset OTP for ${email}: ${otp}`);
  try {
    const sent = await sendEmail(email, 'Reset your TevetVault password',
      otpEmailHtml(otp, 'You requested a password reset. Use the code below:'));
    if (sent) {
      res.json({ success: true, message: 'Reset code sent to your email' });
    } else {
      res.json({ success: true, message: 'Reset code sent', demo_otp: otp });
    }
  } catch (err) {
    console.error('Email error:', err.message);
    res.json({ success: true, message: 'Email failed — use this code', demo_otp: otp });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email||!otp||!newPassword) return res.status(400).json({ error: 'All fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const { data: record } = await supabase.from('otps').select('*').eq('email', email).eq('otp', otp).single();
  if (!record) return res.status(400).json({ error: 'Invalid or expired reset code' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Reset code has expired' });
  await supabase.from('users').update({ password: bcrypt.hashSync(newPassword, 10) }).eq('email', email);
  await supabase.from('otps').delete().eq('email', email);
  res.json({ success: true, message: 'Password reset successfully' });
});

// ══════════════════════════════════════════════════════════════
//  COURSES
// ══════════════════════════════════════════════════════════════

app.get('/api/courses', async (req, res) => {
  const { data: courses } = await supabase.from('courses').select('*').order('name');
  const { data: materials } = await supabase.from('materials').select('course');
  const withCounts = (courses||[]).map(c => ({
    ...c,
    materialCount: (materials||[]).filter(m => m.course === c.id).length
  }));
  res.json(withCounts);
});

app.post('/api/courses', auth, adminOnly, async (req, res) => {
  const { name, emoji, whatsapp, subjects, image } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  const { data, error } = await supabase.from('courses').insert({ id, name, emoji:emoji||'', whatsapp:whatsapp||'', subjects:subjects||[], image:image||'' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put('/api/courses/:id', auth, adminOnly, async (req, res) => {
  const { name, emoji, whatsapp, subjects, image } = req.body;
  const { data, error } = await supabase.from('courses').update({ name, emoji, whatsapp, subjects, image }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/courses/:id', auth, adminOnly, async (req, res) => {
  await supabase.from('courses').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  MATERIALS
// ══════════════════════════════════════════════════════════════

app.get('/api/materials', async (req, res) => {
  const { course, subject, search, sort } = req.query;
  let query = supabase.from('materials').select('*');
  if (course && course !== 'all') query = query.eq('course', course);
  if (subject && subject !== 'all') query = query.eq('subject', subject);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,subject.ilike.%${search}%,uploader_name.ilike.%${search}%`);
  query = query.order(sort === 'date' ? 'created_at' : 'downloads', { ascending: false });
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/materials/my', auth, async (req, res) => {
  const { data, error } = await supabase.from('materials').select('*').eq('uploader_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/materials', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const { course, subject, description } = req.body;
  if (!course||!subject||!description) return res.status(400).json({ error: 'All fields required' });

  const { data: user } = await supabase.from('users').select('username').eq('id', req.user.id).single();
  const ext = path.extname(req.file.originalname);
  const filename = uuidv4() + ext;

  // Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage.from('uploads').upload(filename, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: false
  });
  if (uploadError) return res.status(500).json({ error: 'File upload failed: ' + uploadError.message });

  const { data: mat, error } = await supabase.from('materials').insert({
    title: path.basename(req.file.originalname, ext),
    description, course, subject,
    uploader_id: req.user.id,
    uploader_name: user.username,
    file_type: getFileType(req.file.originalname),
    size: formatSize(req.file.size),
    filename,
    original_name: req.file.originalname,
    downloads: 0
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(mat);
});

app.get('/api/materials/:id/download', auth, async (req, res) => {
  const { data: mat } = await supabase.from('materials').select('*').eq('id', req.params.id).single();
  if (!mat) return res.status(404).json({ error: 'Not found' });

  // Increment download count
  await supabase.from('materials').update({ downloads: mat.downloads + 1 }).eq('id', req.params.id);

  if (mat.filename) {
    // Get signed URL from Supabase Storage (valid for 60 seconds)
    const { data: urlData } = await supabase.storage.from('uploads').createSignedUrl(mat.filename, 60);
    if (urlData?.signedUrl) {
      return res.json({ success: true, url: urlData.signedUrl, downloads: mat.downloads + 1 });
    }
  }
  res.json({ success: true, demo: true, downloads: mat.downloads + 1 });
});

app.delete('/api/materials/:id', auth, async (req, res) => {
  const { data: mat } = await supabase.from('materials').select('*').eq('id', req.params.id).single();
  if (!mat) return res.status(404).json({ error: 'Not found' });
  if (mat.uploader_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  if (mat.filename) await supabase.storage.from('uploads').remove([mat.filename]);
  await supabase.from('materials').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════

app.get('/api/admin/stats', auth, adminOnly, async (req, res) => {
  const { data: users } = await supabase.from('users').select('id').eq('role', 'student');
  const { data: materials } = await supabase.from('materials').select('course, uploader_name, downloads');
  const { data: courses } = await supabase.from('courses').select('id, name');

  const totalDownloads = (materials||[]).reduce((a,m) => a+m.downloads, 0);
  const byC = {}; (materials||[]).forEach(m => { byC[m.course]=(byC[m.course]||0)+1; });
  const byU = {}; (materials||[]).forEach(m => { byU[m.uploader_name]=(byU[m.uploader_name]||0)+1; });

  res.json({
    totalStudents: (users||[]).length,
    totalMaterials: (materials||[]).length,
    totalDownloads,
    totalCourses: (courses||[]).length,
    courseBreakdown: (courses||[]).map(c => ({ ...c, count: byC[c.id]||0 })),
    topUploaders: Object.entries(byU).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([username,count])=>({username,count}))
  });
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  const { data: users } = await supabase.from('users').select('*').eq('role', 'student');
  const { data: materials } = await supabase.from('materials').select('uploader_id, downloads');
  const withStats = (users||[]).map(u => {
    const mats = (materials||[]).filter(m => m.uploader_id === u.id);
    return { ...safeUser(u), uploads: mats.length, totalDownloads: mats.reduce((a,m)=>a+m.downloads,0) };
  });
  res.json(withStats);
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  await supabase.from('users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ── FEEDBACK ────────────────────────────────────────────────
app.post('/api/feedback', auth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const { data: user } = await supabase.from('users').select('name').eq('id', req.user.id).single();
  await supabase.from('feedback').insert({ user_id: req.user.id, user_name: user?.name||'Unknown', message });
  res.json({ success: true });
});

app.get('/api/feedback', auth, adminOnly, async (req, res) => {
  const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
  res.json(data||[]);
});

// ── HEALTH ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0.0', platform: 'TevetVault + Supabase' }));

app.get('/{*splat}', (req, res) => {
  const fp = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(fp)) res.sendFile(fp);
  else res.json({ error: 'Frontend not found' });
});

app.listen(PORT, () => console.log(`✅ TevetVault API running on port ${PORT}`));
module.exports = app;
