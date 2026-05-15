const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

require('dotenv').config();

const nodemailer = require('nodemailer');

// Email transporter — uses Gmail SMTP from environment variables
const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send email helper
async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[EMAIL SKIPPED - no credentials] To: ${to} | Subject: ${subject}`);
    return false;
  }
  await mailer.sendMail({
    from: process.env.EMAIL_FROM || `TevetVault <${process.env.EMAIL_USER}>`,
    to, subject, html
  });
  return true;
}

function otpEmailHtml(otp, title, message) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f4f6fa">
    <div style="background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <h2 style="color:#1a56db;margin:0 0 8px">TevetVault</h2>
      <p style="color:#374151;font-size:14px;margin-bottom:20px">${message}</p>
      <div style="background:#eff4ff;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
        <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#1a56db">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:13px">This code expires in <strong>10 minutes</strong>. If you did not request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e5e8ef;margin:20px 0"/>
      <p style="color:#9ca3af;font-size:12px;margin:0">TevetVault &middot; Student Resource Platform &middot; Malawi</p>
    </div>
  </div>`;
}

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'edushare_secret_2024_mw';

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
[dataDir, uploadsDir].forEach(d => !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true }));

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({
  users: [{
    id: 'admin-001', email: 'admin@tevetvault.mw',
    password: bcrypt.hashSync('admin123', 10), role: 'admin',
    name: 'TevetVault Admin', username: 'admin', course: '',
    college: 'TevetVault HQ', avatar: '', verified: true,
    createdAt: new Date().toISOString()
  }],
  materials: [
    { id: 'm1', title: 'ICT Revision Notes 2024', description: 'Comprehensive revision notes covering all ICT topics.', course: 'ict', subject: 'Technology', uploaderId: 'demo-u1', uploaderName: 'jbanda', date: '2024-11-10', fileType: 'pdf', size: '2.4 MB', filename: null, downloads: 145, createdAt: '2024-11-10T10:00:00Z' },
    { id: 'm2', title: 'Entrepreneurship Past Paper 2023', description: 'TVET exam paper with marking scheme.', course: 'ict', subject: 'Entrepreneurship', uploaderId: 'demo-u2', uploaderName: 'mchilima', date: '2024-10-22', fileType: 'pdf', size: '1.1 MB', filename: null, downloads: 98, createdAt: '2024-10-22T10:00:00Z' },
    { id: 'm3', title: 'Numeracy Workbook', description: 'Practice exercises with solutions.', course: 'ict', subject: 'Numeracy', uploaderId: 'demo-u1', uploaderName: 'jbanda', date: '2024-09-15', fileType: 'doc', size: '3.2 MB', filename: null, downloads: 77, createdAt: '2024-09-15T10:00:00Z' },
    { id: 'm4', title: 'Plumbing Safety Guidelines', description: 'OSH guidelines for plumbing trade.', course: 'plumbing', subject: 'Safety', uploaderId: 'demo-u3', uploaderName: 'psangala', date: '2024-11-01', fileType: 'pdf', size: '890 KB', filename: null, downloads: 43, createdAt: '2024-11-01T10:00:00Z' },
    { id: 'm5', title: 'Wood Joinery Diagrams', description: 'Illustrated guide to joinery techniques.', course: 'carpentry', subject: 'Joinery', uploaderId: 'demo-u2', uploaderName: 'mchilima', date: '2024-10-05', fileType: 'img', size: '5.6 MB', filename: null, downloads: 62, createdAt: '2024-10-05T10:00:00Z' },
    { id: 'm6', title: 'Engine Systems Overview', description: 'Intro to petrol and diesel engines.', course: 'automobile', subject: 'Engine Systems', uploaderId: 'demo-u1', uploaderName: 'jbanda', date: '2024-08-20', fileType: 'ppt', size: '4.1 MB', filename: null, downloads: 55, createdAt: '2024-08-20T10:00:00Z' }
  ],
  courses: [
    { id: 'ict', name: 'ICT', emoji: '', whatsapp: '', subjects: ['Technology', 'Science', 'Numeracy', 'OSH', 'Entrepreneurship', 'Communication', 'Technical Drawing'], image: '', createdAt: new Date().toISOString() },
    { id: 'plumbing', name: 'Plumbing', emoji: '', whatsapp: '', subjects: ['Basic Plumbing', 'Water Systems', 'Pipe Fitting', 'Safety', 'Drainage', 'Valves'], image: '', createdAt: new Date().toISOString() },
    { id: 'carpentry', name: 'Carpentry', emoji: '', whatsapp: '', subjects: ['Wood Work', 'Joinery', 'Furniture Making', 'Safety', 'Tools & Equipment', 'Technical Drawing'], image: '', createdAt: new Date().toISOString() },
    { id: 'bricklaying', name: 'Bricklaying', emoji: '', whatsapp: '', subjects: ['Masonry', 'Foundations', 'Roofing', 'Safety', 'Materials', 'Technical Drawing'], image: '', createdAt: new Date().toISOString() },
    { id: 'automobile', name: 'Automobile Mechanics', emoji: '', whatsapp: '', subjects: ['Engine Systems', 'Electrical', 'Transmission', 'Safety', 'Diagnostics', 'Body Work'], image: '', createdAt: new Date().toISOString() },
    { id: 'tailoring', name: 'Tailoring & Garments', emoji: '', whatsapp: '', subjects: ['Pattern Making', 'Sewing', 'Design', 'Fashion', 'OSH', 'Business'], image: '', createdAt: new Date().toISOString() }
  ],
  otps: [],
  feedback: []
}).write();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf','.doc','.docx','.ppt','.pptx','.txt','.jpg','.jpeg','.png','.gif'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

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

function safeUser(u) { const { password, ...rest } = u; return rest; }

// ── AUTH ────────────────────────────────────────────────────

app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  const existing = db.get('users').find({ email }).value();
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10*60*1000).toISOString();
  const otps = db.get('otps').value().filter(o => o.email !== email);
  otps.push({ email, otp, expiresAt });
  db.set('otps', otps).write();
  console.log(`Registration OTP for ${email}: ${otp}`);
  try {
    const sent = await sendEmail(
      email,
      'Your TevetVault verification code',
      otpEmailHtml(otp, 'Verify your email', 'Use the code below to verify your email address and complete registration:')
    );
    if (sent) {
      res.json({ success: true, message: 'Verification code sent to your email' });
    } else {
      // No email credentials — fall back to demo mode so testing still works
      res.json({ success: true, message: 'OTP sent', demo_otp: otp });
    }
  } catch (err) {
    console.error('Email send error:', err.message);
    // Still allow registration by returning the OTP in response as fallback
    res.json({ success: true, message: 'Email delivery failed — use this code to continue', demo_otp: otp, email_error: err.message });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const record = db.get('otps').find({ email, otp }).value();
  if (!record) return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date(record.expiresAt) < new Date()) return res.status(400).json({ error: 'OTP expired' });
  res.json({ success: true, message: 'Email verified' });
});

app.post('/api/auth/register', (req, res) => {
  const { email, otp, name, username, course, college, password, avatar } = req.body;
  const otpRecord = db.get('otps').find({ email, otp }).value();
  if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });
  if (db.get('users').find({ email }).value()) return res.status(400).json({ error: 'Email taken' });
  if (db.get('users').find({ username }).value()) return res.status(400).json({ error: 'Username taken' });
  if (!name||!username||!course||!college||!password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
  const user = { id: uuidv4(), email, password: bcrypt.hashSync(password, 10), role: 'student', name, username, course, college, avatar: avatar||'', verified: true, createdAt: new Date().toISOString() };
  db.get('users').push(user).write();
  db.set('otps', db.get('otps').value().filter(o => o.email !== email)).write();
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.get('users').find({ email }).value();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(safeUser(user));
});

app.put('/api/auth/profile', auth, (req, res) => {
  const { name, username, college, avatar } = req.body;
  const users = db.get('users').value();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (users.find(u => u.username === username && u.id !== req.user.id)) return res.status(400).json({ error: 'Username taken' });
  if (name) users[idx].name = name;
  if (username) users[idx].username = username;
  if (college) users[idx].college = college;
  if (avatar !== undefined) users[idx].avatar = avatar;
  db.set('users', users).write();
  res.json(safeUser(users[idx]));
});

app.put('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword||!newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = db.get('users').value();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (!bcrypt.compareSync(currentPassword, users[idx].password)) return res.status(400).json({ error: 'Current password is incorrect' });
  users[idx].password = bcrypt.hashSync(newPassword, 10);
  db.set('users', users).write();
  res.json({ success: true });
});

// ── FORGOT PASSWORD ─────────────────────────────────────────

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const user = db.get('users').find({ email }).value();
  if (!user) return res.status(400).json({ error: 'No account found with that email address' });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10*60*1000).toISOString();
  const otps = db.get('otps').value().filter(o => o.email !== email);
  otps.push({ email, otp, expiresAt });
  db.set('otps', otps).write();
  console.log(`Password reset OTP for ${email}: ${otp}`);
  try {
    const sent = await sendEmail(
      email,
      'Reset your TevetVault password',
      otpEmailHtml(otp, 'Reset your password', 'You requested a password reset. Use the code below to set a new password:')
    );
    if (sent) {
      res.json({ success: true, message: 'Password reset code sent to your email' });
    } else {
      res.json({ success: true, message: 'Reset code sent', demo_otp: otp });
    }
  } catch (err) {
    console.error('Email send error:', err.message);
    res.json({ success: true, message: 'Email delivery failed — use this code to continue', demo_otp: otp, email_error: err.message });
  }
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email||!otp||!newPassword) return res.status(400).json({ error: 'All fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const record = db.get('otps').find({ email, otp }).value();
  if (!record) return res.status(400).json({ error: 'Invalid or expired reset code' });
  if (new Date(record.expiresAt) < new Date()) return res.status(400).json({ error: 'Reset code has expired — request a new one' });
  const users = db.get('users').value();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].password = bcrypt.hashSync(newPassword, 10);
  db.set('users', users).write();
  db.set('otps', db.get('otps').value().filter(o => o.email !== email)).write();
  res.json({ success: true, message: 'Password reset successfully — you can now sign in' });
});

// ── COURSES ─────────────────────────────────────────────────

app.get('/api/courses', (req, res) => {
  const courses = db.get('courses').value();
  const materials = db.get('materials').value();
  res.json(courses.map(c => ({ ...c, materialCount: materials.filter(m => m.course === c.id).length })));
});

app.post('/api/courses', auth, adminOnly, (req, res) => {
  const { name, emoji, whatsapp, subjects, image } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  if (db.get('courses').find({ id }).value()) return res.status(400).json({ error: 'Course already exists' });
  const course = { id, name, emoji: emoji||'', whatsapp: whatsapp||'', subjects: subjects||[], image: image||'', createdAt: new Date().toISOString() };
  db.get('courses').push(course).write();
  res.json(course);
});

app.put('/api/courses/:id', auth, adminOnly, (req, res) => {
  const courses = db.get('courses').value();
  const idx = courses.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { name, emoji, whatsapp, subjects, image } = req.body;
  if (name) courses[idx].name = name;
  if (emoji !== undefined) courses[idx].emoji = emoji;
  if (whatsapp !== undefined) courses[idx].whatsapp = whatsapp;
  if (subjects) courses[idx].subjects = subjects;
  if (image !== undefined) courses[idx].image = image;
  db.set('courses', courses).write();
  res.json(courses[idx]);
});

app.delete('/api/courses/:id', auth, adminOnly, (req, res) => {
  db.set('courses', db.get('courses').value().filter(c => c.id !== req.params.id)).write();
  res.json({ success: true });
});

// ── MATERIALS ───────────────────────────────────────────────

app.get('/api/materials', (req, res) => {
  const { course, subject, search, sort } = req.query;
  let mats = db.get('materials').value();
  if (course && course !== 'all') mats = mats.filter(m => m.course === course);
  if (subject && subject !== 'all') mats = mats.filter(m => m.subject === subject);
  if (search) {
    const q = search.toLowerCase();
    mats = mats.filter(m => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.uploaderName.toLowerCase().includes(q));
  }
  mats.sort((a,b) => sort==='date' ? new Date(b.createdAt)-new Date(a.createdAt) : b.downloads-a.downloads);
  res.json(mats);
});

app.get('/api/materials/my', auth, (req, res) => {
  const mats = db.get('materials').value().filter(m => m.uploaderId === req.user.id);
  mats.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  res.json(mats);
});

app.post('/api/materials', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const { course, subject, description } = req.body;
  if (!course||!subject||!description) return res.status(400).json({ error: 'All fields required' });
  const user = db.get('users').find({ id: req.user.id }).value();
  const mat = {
    id: uuidv4(),
    title: path.basename(req.file.originalname, path.extname(req.file.originalname)),
    description, course, subject,
    uploaderId: req.user.id, uploaderName: user.username,
    date: new Date().toISOString().split('T')[0],
    fileType: getFileType(req.file.originalname),
    size: formatSize(req.file.size),
    filename: req.file.filename, originalName: req.file.originalname,
    downloads: 0, createdAt: new Date().toISOString()
  };
  db.get('materials').push(mat).write();
  res.json(mat);
});

app.get('/api/materials/:id/download', auth, (req, res) => {
  const mats = db.get('materials').value();
  const idx = mats.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  mats[idx].downloads++;
  db.set('materials', mats).write();
  const mat = mats[idx];
  if (mat.filename) {
    const filePath = path.join(uploadsDir, mat.filename);
    if (fs.existsSync(filePath)) {
      const originalName = mat.originalName || mat.filename;
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      return res.download(filePath, originalName, err => { if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' }); });
    }
  }
  res.json({ success: true, downloads: mat.downloads, demo: true });
});

app.get('/api/materials/:id/file', (req, res) => {
  const qToken = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!qToken) return res.status(401).json({ error: 'Authentication required' });
  try { jwt.verify(qToken, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }
  const mat = db.get('materials').find({ id: req.params.id }).value();
  if (!mat||!mat.filename) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(uploadsDir, mat.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  const originalName = mat.originalName || mat.filename;
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
  res.download(filePath, originalName, err => { if (err && !res.headersSent) res.status(500).json({ error: 'File serve failed' }); });
});

app.delete('/api/materials/:id', auth, (req, res) => {
  const mat = db.get('materials').find({ id: req.params.id }).value();
  if (!mat) return res.status(404).json({ error: 'Not found' });
  if (mat.uploaderId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  if (mat.filename) { const fp = path.join(uploadsDir, mat.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  db.set('materials', db.get('materials').value().filter(m => m.id !== req.params.id)).write();
  res.json({ success: true });
});

// ── ADMIN ───────────────────────────────────────────────────

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const users = db.get('users').value().filter(u => u.role === 'student');
  const materials = db.get('materials').value();
  const courses = db.get('courses').value();
  const byC = {}; materials.forEach(m => { byC[m.course] = (byC[m.course]||0)+1; });
  const byU = {}; materials.forEach(m => { byU[m.uploaderName] = (byU[m.uploaderName]||0)+1; });
  res.json({
    totalStudents: users.length, totalMaterials: materials.length,
    totalDownloads: materials.reduce((a,m) => a+m.downloads, 0), totalCourses: courses.length,
    courseBreakdown: courses.map(c => ({ ...c, count: byC[c.id]||0 })),
    topUploaders: Object.entries(byU).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([username,count])=>({username,count}))
  });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.get('users').value().filter(u => u.role === 'student');
  const materials = db.get('materials').value();
  res.json(users.map(u => {
    const mats = materials.filter(m => m.uploaderId === u.id);
    return { ...safeUser(u), uploads: mats.length, totalDownloads: mats.reduce((a,m)=>a+m.downloads,0) };
  }));
});

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.set('users', db.get('users').value().filter(u => u.id !== req.params.id)).write();
  res.json({ success: true });
});

// ── FEEDBACK ────────────────────────────────────────────────

app.post('/api/feedback', auth, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const user = db.get('users').find({ id: req.user.id }).value();
  db.get('feedback').push({ id: uuidv4(), userId: req.user.id, userName: user?.name||'Unknown', message, createdAt: new Date().toISOString() }).write();
  res.json({ success: true });
});

app.get('/api/feedback', auth, adminOnly, (req, res) => res.json(db.get('feedback').value()));
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', platform: 'TevetVault API' }));

app.get('/{*splat}', (req, res) => {
  const fp = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(fp)) res.sendFile(fp);
  else res.json({ error: 'Frontend not found' });
});

app.listen(PORT, () => console.log(`✅ TevetVault API running on port ${PORT}`));
module.exports = app;

