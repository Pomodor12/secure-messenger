const DB_NAME = 'SecureMessengerDB';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('chatId', 'chat_id', { unique: false });
        msgStore.createIndex('chatId_createdAt', ['chat_id', 'created_at'], { unique: false });
      }
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('avatars')) {
        db.createObjectStore('avatars', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id' });
      }
    };
  });
}

export async function saveMessages(messages) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  for (const msg of messages) {
    store.put(msg);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveMessage(message) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').put(message);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMessagesByChatId(chatId, limit = 50) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readonly');
  const store = tx.objectStore('messages');
  const index = store.index('chatId');
  return new Promise((resolve, reject) => {
    const request = index.getAll(chatId);
    request.onsuccess = () => {
      const messages = request.result.sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
      resolve(messages.slice(-limit));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveKeys(userId, publicKey, secretKey) {
  const db = await openDB();
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').put({ userId, publicKey, secretKey, updatedAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getKeys(userId) {
  const db = await openDB();
  const tx = db.transaction('keys', 'readonly');
  const request = tx.objectStore('keys').get(userId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAvatar(userId, avatarDataUrl) {
  const db = await openDB();
  const tx = db.transaction('avatars', 'readwrite');
  tx.objectStore('avatars').put({ userId, avatar: avatarDataUrl, updatedAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAvatar(userId) {
  const db = await openDB();
  const tx = db.transaction('avatars', 'readonly');
  const request = tx.objectStore('avatars').get(userId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.avatar || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChats(chats) {
  const db = await openDB();
  const tx = db.transaction('chats', 'readwrite');
  const store = tx.objectStore('chats');
  for (const chat of chats) {
    store.put(chat);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChats() {
  const db = await openDB();
  const tx = db.transaction('chats', 'readonly');
  const request = tx.objectStore('chats').getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
