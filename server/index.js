require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
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
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

const app = express();
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Слишком много запросов.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60, // 60 messages per minute
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

// --- Database ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'messenger.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    emoji TEXT DEFAULT NULL,
    public_key TEXT DEFAULT NULL,
    status TEXT DEFAULT 'Привет, я использую Голуби!',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    is_group INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER,
    user_id INTEGER,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    user_id INTEGER,
    content TEXT,
    content_encrypted TEXT,
    content_iv TEXT,
    content_tag TEXT,
    encrypted_content TEXT,
    iv TEXT,
    message_type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Migration: add server-side encryption columns
db.run("ALTER TABLE messages ADD COLUMN content_encrypted TEXT", () => {});
db.run("ALTER TABLE messages ADD COLUMN content_iv TEXT", () => {});
db.run("ALTER TABLE messages ADD COLUMN content_tag TEXT", () => {});

const onlineUsers = new Map();
const failedLogins = new Map(); // ip -> { count, lastAttempt }

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

function requireGroupCreator(req, res, next) {
  db.get('SELECT is_group, created_by FROM chats WHERE id = ?', [req.params.chatId], (err, chat) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (!chat.is_group) return res.status(400).json({ error: 'Нельзя редактировать личный чат' });
    if (chat.created_by !== req.user.id) return res.status(403).json({ error: 'Нет прав' });
    req.chat = chat;
    next();
  });
}

function requireChatMember(req, res, next) {
  db.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
    [req.params.chatId || req.params.id, req.user.id],
    (err, member) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!member) return res.status(403).json({ error: 'Вы не участник этого чата' });
      next();
    });
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
    db.run('INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка сервера' });
        }
        const token = jwt.sign({ id: this.lastID, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: { id: this.lastID, username } });
      });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { login, password } = req.body;

    // Brute force protection
    const attempts = failedLogins.get(ip);
    if (attempts && attempts.count >= 10 && Date.now() - attempts.lastAttempt < 30 * 60 * 1000) {
      return res.status(429).json({ error: 'Слишком много неудачных попыток. Попробуйте через 30 минут.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [login], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (!user) {
        // Still run bcrypt.compare to prevent timing attacks
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
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, username, emoji, status FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  });
});

app.put('/api/auth/profile', authenticateToken, (req, res) => {
  const { status } = req.body;
  const safeStatus = status ? sanitize(status).slice(0, 200) : null;
  db.run('UPDATE users SET status = COALESCE(?, status) WHERE id = ?',
    [safeStatus, req.user.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ message: 'Профиль обновлён' });
    });
});

app.put('/api/auth/emoji', authenticateToken, (req, res) => {
  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ error: 'Неверный эмодзи' });
  }
  db.run('UPDATE users SET emoji = ? WHERE id = ?', [emoji, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json({ message: 'Эмодзи обновлён', emoji });
  });
});

app.put('/api/auth/public-key', authenticateToken, (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Публичный ключ обязателен' });
  }
  db.run('UPDATE users SET public_key = ? WHERE id = ?', [publicKey, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json({ message: 'Ключ обновлён' });
  });
});

// --- User Endpoints ---
app.get('/api/users/search', authenticateToken, apiLimiter, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);
  db.all('SELECT id, username, emoji, status FROM users WHERE username LIKE ? AND id != ? LIMIT 20',
    [`%${sanitize(q)}%`, req.user.id],
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(users);
    });
});

app.get('/api/users/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Неверный ID' });
  db.get('SELECT id, username, emoji, status FROM users WHERE id = ?', [id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  });
});

app.get('/api/users/:id/public-key', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) return res.status(400).json({ error: 'Неверный ID' });
  db.get('SELECT public_key FROM users WHERE id = ?', [id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ publicKey: user.public_key });
  });
});

// --- Chat Endpoints ---
app.get('/api/chats', authenticateToken, apiLimiter, (req, res) => {
  db.all(`
    SELECT c.*,
      (SELECT content_encrypted FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_enc,
      (SELECT content_iv FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_iv,
      (SELECT content_tag FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg_tag,
      (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
      (SELECT username FROM users WHERE id = (SELECT user_id FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1)) as last_message_by,
      (SELECT GROUP_CONCAT(u.username) FROM users u
        JOIN chat_members cm ON u.id = cm.user_id
        WHERE cm.chat_id = c.id AND cm.user_id != ?) as members
    FROM chats c
    JOIN chat_members cm ON c.id = cm.chat_id
    WHERE cm.user_id = ?
    ORDER BY last_message_at DESC
  `, [req.user.id, req.user.id],
  (err, chats) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    // Decrypt last messages
    const decrypted = chats.map(chat => {
      let last_message = chat.last_message;
      if (chat.last_msg_enc && chat.last_msg_iv && chat.last_msg_tag) {
        const dec = decryptServer(chat.last_msg_enc, chat.last_msg_iv, chat.last_msg_tag);
        if (dec) last_message = dec;
      }
      return { ...chat, last_message, last_msg_enc: undefined, last_msg_iv: undefined, last_msg_tag: undefined };
    });
    res.json(decrypted);
  });
});

app.post('/api/chats', authenticateToken, apiLimiter, (req, res) => {
  const { name, isGroup, memberIds } = req.body;
  if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'Укажите участников' });
  }
  if (memberIds.length > 50) {
    return res.status(400).json({ error: 'Максимум 50 участников' });
  }
  const safeName = name ? sanitize(name).slice(0, 100) : null;
  db.run('INSERT INTO chats (name, is_group, created_by) VALUES (?, ?, ?)',
    [safeName, isGroup ? 1 : 0, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      const chatId = this.lastID;
      const allMembers = [...new Set([req.user.id, ...memberIds])];
      const stmt = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
      allMembers.forEach(userId => stmt.run(chatId, userId));
      stmt.finalize();
      res.json({ id: chatId, name: safeName, is_group: isGroup ? 1 : 0, created_by: req.user.id });
    });
});

app.get('/api/chats/:chatId/members', authenticateToken, requireChatMember, (req, res) => {
  db.all(`
    SELECT u.id, u.username, u.emoji, u.status
    FROM users u
    JOIN chat_members cm ON u.id = cm.user_id
    WHERE cm.chat_id = ?
  `, [req.params.chatId], (err, members) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(members);
  });
});

app.post('/api/chats/:chatId/members', authenticateToken, requireGroupCreator, (req, res) => {
  const { userIds } = req.body;
  if (!userIds || !Array.isArray(userIds)) {
    return res.status(400).json({ error: 'Неверный формат' });
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
  userIds.forEach(userId => stmt.run(req.params.chatId, userId));
  stmt.finalize();
  res.json({ message: 'Участники добавлены' });
});

app.delete('/api/chats/:chatId/members/:userId', authenticateToken, (req, res) => {
  db.get('SELECT is_group, created_by FROM chats WHERE id = ?', [req.params.chatId], (err, chat) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
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

    db.run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', [req.params.chatId, targetUserId], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      io.to(`chat_${req.params.chatId}`).emit('member_removed', { chatId: parseInt(req.params.chatId), userId: targetUserId });
      res.json({ message: isLeaving ? 'Вы вышли из группы' : 'Участник удалён' });
    });
  });
});

app.post('/api/chats/:chatId/leave', authenticateToken, (req, res) => {
  db.get('SELECT is_group, created_by FROM chats WHERE id = ?', [req.params.chatId], (err, chat) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (!chat.is_group) return res.status(400).json({ error: 'Нельзя покинуть личный чат' });
    if (chat.created_by === req.user.id) {
      return res.status(400).json({ error: 'Создатель не может выйти. Удалите группу.' });
    }
    db.run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', [req.params.chatId, req.user.id], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      io.to(`chat_${req.params.chatId}`).emit('member_removed', { chatId: parseInt(req.params.chatId), userId: req.user.id });
      res.json({ message: 'Вы вышли из группы' });
    });
  });
});

app.put('/api/chats/:chatId', authenticateToken, requireGroupCreator, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название' });
  const safeName = sanitize(name.trim()).slice(0, 100);
  db.run('UPDATE chats SET name = ? WHERE id = ?', [safeName, req.params.chatId], (err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    io.to(`chat_${req.params.chatId}`).emit('chat_renamed', { chatId: parseInt(req.params.chatId), name: safeName });
    res.json({ message: 'Группа переименована' });
  });
});

app.delete('/api/chats/:chatId', authenticateToken, (req, res) => {
  db.get('SELECT created_by, is_group FROM chats WHERE id = ?', [req.params.chatId], (err, chat) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });

    // For direct chats, check membership; for groups, check creator
    if (chat.is_group && chat.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Только создатель может удалить группу' });
    }
    if (!chat.is_group) {
      db.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', [req.params.chatId, req.user.id], (err, member) => {
        if (!member) return res.status(403).json({ error: 'Вы не участник этого чата' });
        doDelete();
      });
      return;
    }
    doDelete();

    function doDelete() {
      db.run('DELETE FROM messages WHERE chat_id = ?', [req.params.chatId], () => {
        db.run('DELETE FROM chat_members WHERE chat_id = ?', [req.params.chatId], () => {
          db.run('DELETE FROM chats WHERE id = ?', [req.params.chatId], (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка сервера' });
            io.to(`chat_${req.params.chatId}`).emit('chat_deleted', { chatId: parseInt(req.params.chatId) });
            res.json({ message: 'Чат удалён' });
          });
        });
      });
    }
  });
});

// --- Message Endpoints ---
app.get('/api/chats/:chatId/messages', authenticateToken, requireChatMember, (req, res) => {
  const { chatId } = req.params;
  const { before, limit = 50 } = req.query;
  const parsedLimit = Math.min(parseInt(limit) || 50, 100);
  let query = `
    SELECT m.id, m.chat_id, m.user_id, m.content, m.content_encrypted, m.content_iv, m.content_tag,
           m.encrypted_content, m.iv, m.message_type, m.created_at, u.username, u.emoji
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.chat_id = ?
  `;
  const params = [chatId];
  if (before) {
    query += ' AND m.id < ?';
    params.push(parseInt(before));
  }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parsedLimit);
  db.all(query, params, (err, messages) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    // Decrypt messages
    const decrypted = messages.map(msg => {
      let content = msg.content;
      if (msg.content_encrypted && msg.content_iv && msg.content_tag) {
        const dec = decryptServer(msg.content_encrypted, msg.content_iv, msg.content_tag);
        if (dec) content = dec;
      }
      return { ...msg, content, content_encrypted: undefined, content_iv: undefined, content_tag: undefined };
    });
    res.json(decrypted.reverse());
  });
});

app.delete('/api/chats/:chatId/messages/:messageId', authenticateToken, (req, res) => {
  const messageId = parseInt(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: 'Неверный ID' });

  db.get('SELECT user_id FROM messages WHERE id = ? AND chat_id = ?', [messageId, req.params.chatId], (err, msg) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

    // Only owner can delete their messages
    if (msg.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    }

    db.run('DELETE FROM messages WHERE id = ?', [messageId], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      io.to(`chat_${req.params.chatId}`).emit('message_deleted', { chatId: parseInt(req.params.chatId), messageId });
      res.json({ message: 'Сообщение удалено' });
    });
  });
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

  socket.on('join_chat', (chatId) => {
    // Verify membership before joining room
    db.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
      [chatId, socket.user.id],
      (err, member) => {
        if (member) {
          socket.join(`chat_${chatId}`);
        }
      });
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
  });

  socket.on('send_message', (data) => {
    const { chatId, content, encryptedContent, iv, messageType = 'text' } = data;

    // Validate
    if (!chatId || !content || typeof content !== 'string') return;
    if (content.length > 5000) return; // Max message length

    // Verify membership
    db.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
      [chatId, socket.user.id],
      (err, member) => {
        if (!member) return;

        // Server-side encryption of content
        const encrypted = encryptServer(content);

        db.run('INSERT INTO messages (chat_id, user_id, content, content_encrypted, content_iv, content_tag, encrypted_content, iv, message_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            chatId,
            socket.user.id,
            null, // Don't store plaintext
            encrypted?.encrypted || null,
            encrypted?.iv || null,
            encrypted?.tag || null,
            encryptedContent || null,
            iv || null,
            messageType
          ],
          function(err) {
            if (err) return console.error(err);
            db.get('SELECT * FROM messages WHERE id = ?', [this.lastID], (err, message) => {
              if (err) return console.error(err);
              db.get('SELECT username, emoji FROM users WHERE id = ?', [socket.user.id], (err, user) => {
                if (err) return console.error(err);
                io.to(`chat_${chatId}`).emit('new_message', {
                  ...message,
                  content: content, // Send plaintext to clients (E2E handles transport)
                  username: user.username,
                  emoji: user.emoji
                });
              });
            });
          });
      });
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
