require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'default_secret_change_me_in_production';
  console.warn('WARNING: JWT_SECRET not set, using default. Set JWT_SECRET env var!');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: blob: https:; connect-src 'self' https: wss: ws:; font-src 'self' data: https:;");
  next();
});

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"'\/]/g, '').trim().slice(0, 500);
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'messenger.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    status TEXT DEFAULT 'Hey, I am using Secure Messenger!',
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
    content TEXT NOT NULL,
    encrypted_content TEXT,
    iv TEXT,
    message_type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS encryption_keys (
    user_id INTEGER,
    chat_id INTEGER,
    public_key TEXT,
    private_key_encrypted TEXT,
    PRIMARY KEY (user_id, chat_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  )`);
});

const onlineUsers = new Map();

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

app.post('/api/auth/register', async (req, res) => {
  try {
    const username = sanitize(req.body.username);
    const password = req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-30 chars, alphanumeric and underscore only' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        const token = jwt.sign({ id: this.lastID, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: this.lastID, username } });
      });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?',
      [login],
      async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(400).json({ error: 'User not found' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid password' });
        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
          token,
          user: { id: user.id, username: user.username, avatar: user.avatar, status: user.status }
        });
      });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, username, avatar, status FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });
});

app.put('/api/auth/profile', authenticateToken, (req, res) => {
  const { status, avatar } = req.body;
  db.run('UPDATE users SET status = COALESCE(?, status), avatar = COALESCE(?, avatar) WHERE id = ?',
    [status, avatar, req.user.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Profile updated' });
    });
});

app.get('/api/users/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  db.all('SELECT id, username, avatar, status FROM users WHERE username LIKE ? AND id != ? LIMIT 20',
    [`%${q}%`, req.user.id],
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(users);
    });
});

app.get('/api/chats', authenticateToken, (req, res) => {
  db.all(`
    SELECT c.*, 
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
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(chats);
  });
});

app.post('/api/chats', authenticateToken, (req, res) => {
  const { name, isGroup, memberIds } = req.body;
  db.run('INSERT INTO chats (name, is_group, created_by) VALUES (?, ?, ?)',
    [name || null, isGroup ? 1 : 0, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      const chatId = this.lastID;
      const allMembers = [...new Set([req.user.id, ...(memberIds || [])])];
      const stmt = db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)');
      allMembers.forEach(userId => stmt.run(chatId, userId));
      stmt.finalize();
      res.json({ id: chatId, name, is_group: isGroup ? 1 : 0 });
    });
});

app.get('/api/chats/:chatId/messages', authenticateToken, (req, res) => {
  const { chatId } = req.params;
  const { before, limit = 50 } = req.query;
  let query = `
    SELECT m.*, u.username, u.avatar
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.chat_id = ?
  `;
  const params = [chatId];
  if (before) {
    query += ' AND m.id < ?';
    params.push(before);
  }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  db.all(query, params, (err, messages) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(messages.reverse());
  });
});

app.get('/api/users/:userId', authenticateToken, (req, res) => {
  db.get('SELECT id, username, avatar, status FROM users WHERE id = ?',
    [req.params.userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });
});

app.post('/api/chats/:chatId/members', authenticateToken, (req, res) => {
  const { userIds } = req.body;
  const stmt = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
  userIds.forEach(userId => stmt.run(req.params.chatId, userId));
  stmt.finalize();
  res.json({ message: 'Members added' });
});

app.get('/api/encryption/keys/:chatId', authenticateToken, (req, res) => {
  db.all('SELECT * FROM encryption_keys WHERE chat_id = ?',
    [req.params.chatId],
    (err, keys) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(keys);
    });
});

app.post('/api/encryption/keys', authenticateToken, (req, res) => {
  const { chatId, publicKey, privateKeyEncrypted } = req.body;
  db.run(`INSERT OR REPLACE INTO encryption_keys (user_id, chat_id, public_key, private_key_encrypted) 
    VALUES (?, ?, ?, ?)`,
    [req.user.id, chatId, publicKey, privateKeyEncrypted],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Keys stored' });
    });
});

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
  console.log(`User connected: ${socket.user.username}`);
  onlineUsers.set(socket.user.id, socket.id);

  io.emit('user_online', { userId: socket.user.id, online: true });

  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
  });

  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
  });

  socket.on('send_message', (data) => {
    const { chatId, content, encryptedContent, iv, messageType = 'text' } = data;
    db.run('INSERT INTO messages (chat_id, user_id, content, encrypted_content, iv, message_type) VALUES (?, ?, ?, ?, ?, ?)',
      [chatId, socket.user.id, content, encryptedContent || null, iv || null, messageType],
      function(err) {
        if (err) return console.error(err);
        db.get('SELECT * FROM messages WHERE id = ?', [this.lastID], (err, message) => {
          if (err) return console.error(err);
          db.get('SELECT username, avatar FROM users WHERE id = ?', [socket.user.id], (err, user) => {
            if (err) return console.error(err);
            io.to(`chat_${chatId}`).emit('new_message', {
              ...message,
              username: user.username,
              avatar: user.avatar
            });
          });
        });
      });
  });

  socket.on('typing', ({ chatId }) => {
    socket.to(`chat_${chatId}`).emit('user_typing', {
      userId: socket.user.id,
      username: socket.user.username,
      chatId
    });
  });

  socket.on('stop_typing', ({ chatId }) => {
    socket.to(`chat_${chatId}`).emit('user_stop_typing', {
      userId: socket.user.id,
      chatId
    });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.user.id);
    io.emit('user_online', { userId: socket.user.id, online: false });
    console.log(`User disconnected: ${socket.user.username}`);
  });
});

const fs = require('fs');
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const hasClientBuild = fs.existsSync(clientBuildPath);

if (hasClientBuild) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
  console.log('Serving client build from:', clientBuildPath);
} else {
  console.log('No client build found at:', clientBuildPath);
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
