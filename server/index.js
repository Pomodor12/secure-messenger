require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// --- Security: JWT Secret ---
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'default_secret_change_me_in_production') {
  process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
  console.warn('WARNING: JWT_SECRET was not set. Generated random secret. Set JWT_SECRET env var for persistence!');
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// --- Security: CORS ---
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001'];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    try {
      const { hostname } = require('url').parse(origin);
      if (hostname === 'localhost' || hostname === '127.0.0.1') return callback(null, true);
    } catch (e) {}
    callback(null, true);
  },
  credentials: true,
};

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// --- Security: Helmet ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors(corsOptions));

// --- Security: Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Слишком много запросов.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Слишком много сообщений.' },
});

app.use(express.json({ limit: '1mb' }));

// --- Security: Additional Headers ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// --- Utilities ---
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"'\/\\]/g, '').trim().slice(0, 300);
}

function encryptServer(text) {
  try {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), tag };
  } catch (e) {
    return null;
  }
}

function decryptServer(encrypted, ivHex, tagHex) {
  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

// --- Database (PostgreSQL) ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      emoji TEXT DEFAULT NULL,
      public_key TEXT DEFAULT NULL,
      status TEXT DEFAULT 'Общаюсь голубями',
      status_frame TEXT DEFAULT 'solid',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id SERIAL PRIMARY KEY,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      content TEXT,
      content_encrypted TEXT,
      content_iv TEXT,
      content_tag TEXT,
      encrypted_content TEXT,
      iv TEXT,
      message_type TEXT DEFAULT 'text',
      reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      reactions TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migration: add reply_to and reactions if missing
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL`).catch(() => {});
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions TEXT DEFAULT '{}'`).catch(() => {});

  console.log('Database initialized');
}

const onlineUsers = new Map();
const failedLogins = new Map();

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

async function requireGroupCreator(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT is_group, created_by FROM chats WHERE id = $1', [req.params.chatId]);
    const chat = rows[0];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (!chat.is_group) return res.status(400).json({ error: 'Нельзя редактировать личный чат' });
    if (chat.created_by !== req.user.id) return res.status(403).json({ error: 'Нет прав' });
    req.chat = chat;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
}

async function requireChatMember(req, res, next) {
  try {
    const chatId = req.params.chatId || req.params.id;
    const { rows } = await pool.query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]);
    if (rows.length === 0) return res.status(403).json({ error: 'Вы не участник этого чата' });
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
}

// --- Auth Endpoints ---
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const username = sanitize(req.body.username);
    const password = req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
    }
    if (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Имя: 3-30 символов, только буквы, цифры и _' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    }
    if (password.length > 100) {
      return res.status(400).json({ error: 'Пароль слишком длинный' });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
      [username, hashedPassword]
    );
    const userId = rows[0].id;
    const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, username } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { login, password } = req.body;

    const attempts = failedLogins.get(ip);
    if (attempts && attempts.count >= 10 && Date.now() - attempts.lastAttempt < 30 * 60 * 1000) {
      return res.status(429).json({ error: 'Слишком много неудачных попыток. Попробуйте через 30 минут.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [login]);
    const user = rows[0];

    if (!user) {
      await bcrypt.compare(password, '$2a$12$fakehashforanti');
      failedLogins.set(ip, { count: (attempts?.count || 0) + 1, lastAttempt: Date.now() });
      return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      failedLogins.set(ip, { count: (attempts?.count || 0) + 1, lastAttempt: Date.now() });
      return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
    }

    failedLogins.delete(ip);
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, emoji: user.emoji, status: user.status }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, emoji, status FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const safeStatus = status ? sanitize(status).slice(0, 200) : null;
  try {
    await pool.query('UPDATE users SET status = COALESCE($1, status) WHERE id = $2', [safeStatus, req.user.id]);
    res.json({ message: 'Профиль обновлён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/auth/emoji', authenticateToken, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ error: 'Неверный эмодзи' });
  }
  try {
    await pool.query('UPDATE users SET emoji = $1 WHERE id = $2', [emoji, req.user.id]);
    io.emit('emoji_changed', { userId: req.user.id, emoji });
    res.json({ message: 'Эмодзи обновлён', emoji });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/auth/status-frame', authenticateToken, async (req, res) => {
  const { statusFrame } = req.body;
  const allowed = ['solid', 'dashed', 'double', 'rounded', 'cloud'];
  const frame = allowed.includes(statusFrame) ? statusFrame : 'solid';
  try {
    await pool.query('UPDATE users SET status_frame = $1 WHERE id = $2', [frame, req.user.id]);
    io.emit('status_frame_changed', { userId: req.user.id, statusFrame: frame });
    res.json({ message: 'Рамка статуса обновлена', statusFrame: frame });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/auth/public-key', authenticateToken, async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Публичный ключ обязателен' });
  }
  try {
    await pool.query('UPDATE users SET public_key = $1 WHERE id = $2', [publicKey, req.user.id]);
    res.json({ message: 'Ключ обновлён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- User Endpoints ---
app.get('/api/users', authenticateToken, apiLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, emoji, status, status_frame FROM users WHERE id != $1 LIMIT 100', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/users/search', authenticateToken, apiLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);
  try {
    const { rows } = await pool.query(
      'SELECT id, username, emoji, status FROM users WHERE username LIKE $1 AND id != $2 LIMIT 20',
      [`%${sanitize(q)}%`, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Неверный ID' });
  try {
    const { rows } = await pool.query('SELECT id, username, emoji, status FROM users WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/users/:id/public-key', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Неверный ID' });
  try {
    const { rows } = await pool.query('SELECT public_key FROM users WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ publicKey: rows[0].public_key });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- Chat Endpoints ---
app.get('/api/chats', authenticateToken, apiLimiter, async (req, res) => {
  try {
    const { rows: chats } = await pool.query(`
      SELECT c.*,
        (SELECT content_encrypted FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_enc,
        (SELECT content_iv FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_iv,
        (SELECT content_tag FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_tag,
        (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT username FROM users WHERE id = (SELECT user_id FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1)) as last_message_by,
        (SELECT STRING_AGG(u.username, ',') FROM users u
          JOIN chat_members cm ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1) as members,
        (SELECT u.emoji FROM users u
          JOIN chat_members cm ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1 LIMIT 1) as member_emoji,
        (SELECT u.id FROM users u
          JOIN chat_members cm ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1 LIMIT 1) as member_id,
        (SELECT u.status FROM users u
          JOIN chat_members cm ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1 LIMIT 1) as member_status,
        (SELECT u.status_frame FROM users u
          JOIN chat_members cm ON u.id = cm.user_id
          WHERE cm.chat_id = c.id AND cm.user_id != $1 LIMIT 1) as member_frame
      FROM chats c
      JOIN chat_members cm ON c.id = cm.chat_id
      WHERE cm.user_id = $1
      ORDER BY last_message_at DESC
    `, [req.user.id]);

    const decrypted = chats.map(chat => {
      let last_message = chat.last_message;
      if (chat.last_msg_enc && chat.last_msg_iv && chat.last_msg_tag) {
        const dec = decryptServer(chat.last_msg_enc, chat.last_msg_iv, chat.last_msg_tag);
        if (dec) last_message = dec;
      }
      return { ...chat, last_message, last_msg_enc: undefined, last_msg_iv: undefined, last_msg_tag: undefined };
    });
    res.json(decrypted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/chats', authenticateToken, apiLimiter, async (req, res) => {
  const { name, isGroup, memberIds } = req.body;
  if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'Укажите участников' });
  }
  if (memberIds.length > 50) {
    return res.status(400).json({ error: 'Максимум 50 участников' });
  }
  const safeName = name ? sanitize(name).slice(0, 100) : null;
  try {
    const { rows } = await pool.query(
      'INSERT INTO chats (name, is_group, created_by) VALUES ($1, $2, $3) RETURNING id',
      [safeName, isGroup ? 1 : 0, req.user.id]
    );
    const chatId = rows[0].id;
    const allMembers = [...new Set([req.user.id, ...memberIds])];
    for (const userId of allMembers) {
      await pool.query(
        'INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [chatId, userId]
      );
    }
    res.json({ id: chatId, name: safeName, is_group: isGroup ? 1 : 0, created_by: req.user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/chats/:chatId/members', authenticateToken, requireChatMember, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.emoji, u.status
      FROM users u
      JOIN chat_members cm ON u.id = cm.user_id
      WHERE cm.chat_id = $1
    `, [req.params.chatId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/chats/:chatId/members', authenticateToken, requireGroupCreator, async (req, res) => {
  const { userIds } = req.body;
  if (!userIds || !Array.isArray(userIds)) {
    return res.status(400).json({ error: 'Неверный формат' });
  }
  try {
    for (const userId of userIds) {
      await pool.query(
        'INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.chatId, userId]
      );
    }
    res.json({ message: 'Участники добавлены' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/chats/:chatId/members/:userId', authenticateToken, async (req, res) => {
  try {
    const { rows: chatRows } = await pool.query('SELECT is_group, created_by FROM chats WHERE id = $1', [req.params.chatId]);
    const chat = chatRows[0];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (!chat.is_group) return res.status(400).json({ error: 'Нельзя удалять из личного чата' });

    const targetUserId = parseInt(req.params.userId);
    const isLeaving = targetUserId === req.user.id;

    if (!isLeaving && chat.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Только создатель может удалять участников' });
    }
    if (chat.created_by === targetUserId && !isLeaving) {
      return res.status(403).json({ error: 'Нельзя удалить создателя' });
    }

    await pool.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.params.chatId, targetUserId]);
    io.to(`chat_${req.params.chatId}`).emit('member_removed', { chatId: parseInt(req.params.chatId), userId: targetUserId });
    res.json({ message: isLeaving ? 'Вы вышли из группы' : 'Участник удалён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/chats/:chatId/leave', authenticateToken, async (req, res) => {
  try {
    const { rows: chatRows } = await pool.query('SELECT is_group, created_by FROM chats WHERE id = $1', [req.params.chatId]);
    const chat = chatRows[0];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (!chat.is_group) return res.status(400).json({ error: 'Нельзя покинуть личный чат' });
    if (chat.created_by === req.user.id) {
      return res.status(400).json({ error: 'Создатель не может выйти. Удалите группу.' });
    }
    await pool.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.params.chatId, req.user.id]);
    io.to(`chat_${req.params.chatId}`).emit('member_removed', { chatId: parseInt(req.params.chatId), userId: req.user.id });
    res.json({ message: 'Вы вышли из группы' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/chats/:chatId', authenticateToken, requireGroupCreator, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название' });
  const safeName = sanitize(name.trim()).slice(0, 100);
  try {
    await pool.query('UPDATE chats SET name = $1 WHERE id = $2', [safeName, req.params.chatId]);
    io.to(`chat_${req.params.chatId}`).emit('chat_renamed', { chatId: parseInt(req.params.chatId), name: safeName });
    res.json({ message: 'Группа переименована' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/chats/:chatId', authenticateToken, async (req, res) => {
  try {
    const { rows: chatRows } = await pool.query('SELECT created_by, is_group FROM chats WHERE id = $1', [req.params.chatId]);
    const chat = chatRows[0];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });

    if (chat.is_group && chat.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Только создатель может удалить группу' });
    }
    if (!chat.is_group) {
      const { rows: memberRows } = await pool.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [req.params.chatId, req.user.id]
      );
      if (memberRows.length === 0) return res.status(403).json({ error: 'Вы не участник этого чата' });
    }

    await pool.query('DELETE FROM messages WHERE chat_id = $1', [req.params.chatId]);
    await pool.query('DELETE FROM chat_members WHERE chat_id = $1', [req.params.chatId]);
    await pool.query('DELETE FROM chats WHERE id = $1', [req.params.chatId]);
    io.to(`chat_${req.params.chatId}`).emit('chat_deleted', { chatId: parseInt(req.params.chatId) });
    res.json({ message: 'Чат удалён' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- Message Endpoints ---
app.get('/api/chats/:chatId/messages', authenticateToken, requireChatMember, async (req, res) => {
  const { chatId } = req.params;
  const { before, limit = 50 } = req.query;
  const parsedLimit = Math.min(parseInt(limit) || 50, 100);
  try {
    let query = `
      SELECT m.id, m.chat_id, m.user_id, m.content, m.content_encrypted, m.content_iv, m.content_tag,
             m.encrypted_content, m.iv, m.message_type, m.reply_to, m.reactions, m.created_at,
             u.username, u.emoji,
             rm.content AS reply_content, ru.username AS reply_username
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];
    let paramIdx = 2;
    if (before) {
      query += ` AND m.id < $${paramIdx}`;
      params.push(parseInt(before));
      paramIdx++;
    }
    query += ` ORDER BY m.created_at DESC LIMIT $${paramIdx}`;
    params.push(parsedLimit);

    const { rows: messages } = await pool.query(query, params);
    const decrypted = messages.map(msg => {
      let content = msg.content;
      if (msg.content_encrypted && msg.content_iv && msg.content_tag) {
        const dec = decryptServer(msg.content_encrypted, msg.content_iv, msg.content_tag);
        if (dec) content = dec;
      }
      return { ...msg, content, content_encrypted: undefined, content_iv: undefined, content_tag: undefined };
    });
    res.json(decrypted.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/chats/:chatId/messages/:messageId', authenticateToken, async (req, res) => {
  const messageId = parseInt(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: 'Неверный ID' });

  try {
    const { rows } = await pool.query('SELECT user_id FROM messages WHERE id = $1 AND chat_id = $2', [messageId, req.params.chatId]);
    const msg = rows[0];
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    }
    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
    io.to(`chat_${req.params.chatId}`).emit('message_deleted', { chatId: parseInt(req.params.chatId), messageId });
    res.json({ message: 'Сообщение удалено' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/chats/:chatId/messages/:messageId/reactions', authenticateToken, async (req, res) => {
  const messageId = parseInt(req.params.messageId);
  const { emoji } = req.body;
  if (!messageId || !emoji || typeof emoji !== 'string') return res.status(400).json({ error: 'Неверные данные' });

  try {
    const { rows } = await pool.query('SELECT reactions FROM messages WHERE id = $1 AND chat_id = $2', [messageId, req.params.chatId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Сообщение не найдено' });

    let reactions = {};
    try { reactions = JSON.parse(rows[0].reactions || '{}'); } catch (e) {}

    const userId = req.user.id.toString();
    if (reactions[emoji] && reactions[emoji].includes(userId)) {
      reactions[emoji] = reactions[emoji].filter(id => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...(reactions[emoji] || []), userId];
    }

    await pool.query('UPDATE messages SET reactions = $1 WHERE id = $2', [JSON.stringify(reactions), messageId]);
    io.to(`chat_${req.params.chatId}`).emit('reaction_updated', { chatId: parseInt(req.params.chatId), messageId, reactions });
    res.json({ reactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- Socket.IO Security ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  onlineUsers.set(socket.user.id, socket.id);
  io.emit('user_online', { userId: socket.user.id, online: true });

  socket.on('join_chat', async (chatId) => {
    try {
      const { rows } = await pool.query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, socket.user.id]);
      if (rows.length > 0) {
        socket.join(`chat_${chatId}`);
      }
    } catch (err) {}
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
  });

  socket.on('send_message', async (data) => {
    const { chatId, content, encryptedContent, iv, messageType = 'text', replyTo } = data;

    if (!chatId || !content || typeof content !== 'string') return;
    if (content.length > 500000) return;

    try {
      const { rows: memberRows } = await pool.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, socket.user.id]
      );
      if (memberRows.length === 0) return;

      const encrypted = encryptServer(content);
      const safeReplyTo = replyTo ? parseInt(replyTo) : null;

      const { rows: msgRows } = await pool.query(
        `INSERT INTO messages (chat_id, user_id, content, content_encrypted, content_iv, content_tag, encrypted_content, iv, message_type, reply_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          chatId,
          socket.user.id,
          null,
          encrypted?.encrypted || null,
          encrypted?.iv || null,
          encrypted?.tag || null,
          encryptedContent || null,
          iv || null,
          messageType,
          safeReplyTo
        ]
      );
      const message = msgRows[0];

      const { rows: userRows } = await pool.query('SELECT username, emoji FROM users WHERE id = $1', [socket.user.id]);
      const user = userRows[0];

      let replyData = null;
      if (safeReplyTo) {
        const { rows: replyRows } = await pool.query(
          'SELECT m.id, m.content, m.content_encrypted, m.content_iv, m.content_tag, u.username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
          [safeReplyTo]
        );
        if (replyRows.length > 0) {
          const rm = replyRows[0];
          let replyContent = rm.content;
          if (rm.content_encrypted && rm.content_iv && rm.content_tag) {
            const dec = decryptServer(rm.content_encrypted, rm.content_iv, rm.content_tag);
            if (dec) replyContent = dec;
          }
          replyData = { id: rm.id, content: replyContent, username: rm.username };
        }
      }

      io.to(`chat_${chatId}`).emit('new_message', {
        ...message,
        content: content,
        username: user.username,
        emoji: user.emoji,
        reply_to_data: replyData
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('typing', ({ chatId }) => {
    if (!chatId) return;
    socket.to(`chat_${chatId}`).emit('user_typing', {
      userId: socket.user.id,
      username: socket.user.username,
      chatId
    });
  });

  socket.on('stop_typing', ({ chatId }) => {
    if (!chatId) return;
    socket.to(`chat_${chatId}`).emit('user_stop_typing', {
      userId: socket.user.id,
      chatId
    });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.user.id);
    io.emit('user_online', { userId: socket.user.id, online: false });
  });
});

// --- Serve Client ---
const fs = require('fs');
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const hasClientBuild = fs.existsSync(clientBuildPath);

if (hasClientBuild) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  app.get('*', (req, res) => {
    res.json({ message: 'API is running. Client build not found.' });
  });
}

// --- Start ---
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
