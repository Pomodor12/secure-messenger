// IndexedDB Storage Utility
const DB_NAME = 'SecureMessengerDB';
const DB_VERSION = 1;

const STORES = {
  users: 'users',
  chats: 'chats',
  messages: 'messages',
  keys: 'encryption_keys',
  avatars: 'avatars',
  files: 'files'
};

let db = null;

// Initialize IndexedDB
export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Users store
      if (!database.objectStoreNames.contains(STORES.users)) {
        database.createObjectStore(STORES.users, { keyPath: 'id' });
      }

      // Chats store
      if (!database.objectStoreNames.contains(STORES.chats)) {
        const chatStore = database.createObjectStore(STORES.chats, { keyPath: 'id' });
        chatStore.createIndex('members', 'members', { unique: false });
      }

      // Messages store
      if (!database.objectStoreNames.contains(STORES.messages)) {
        const msgStore = database.createObjectStore(STORES.messages, { keyPath: 'id' });
        msgStore.createIndex('chatId', 'chat_id', { unique: false });
        msgStore.createIndex('createdAt', 'created_at', { unique: false });
      }

      // Encryption keys store
      if (!database.objectStoreNames.contains(STORES.keys)) {
        database.createObjectStore(STORES.keys, { keyPath: ['user_id', 'chat_id'] });
      }

      // Avatars store
      if (!database.objectStoreNames.contains(STORES.avatars)) {
        database.createObjectStore(STORES.avatars, { keyPath: 'userId' });
      }

      // Files store
      if (!database.objectStoreNames.contains(STORES.files)) {
        const fileStore = database.createObjectStore(STORES.files, { keyPath: 'id' });
        fileStore.createIndex('messageId', 'message_id', { unique: false });
      }
    };
  });
}

// Generic save function
function save(storeName, data) {
  return new Promise((resolve, reject) => {
    if (!db) reject(new Error('Database not initialized'));
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Generic get function
function get(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) reject(new Error('Database not initialized'));
    
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Generic getAll function
function getAll(storeName, index = null, range = null) {
  return new Promise((resolve, reject) => {
    if (!db) reject(new Error('Database not initialized'));
    
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = index ? store.index(index).getAll(range) : store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Generic delete function
function deleteRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) reject(new Error('Database not initialized'));
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// User operations
export const UserStorage = {
  save: (user) => save(STORES.users, user),
  get: (userId) => get(STORES.users, userId),
  getAll: () => getAll(STORES.users),
  delete: (userId) => deleteRecord(STORES.users, userId)
};

// Chat operations
export const ChatStorage = {
  save: (chat) => save(STORES.chats, chat),
  get: (chatId) => get(STORES.chats, chatId),
  getAll: () => getAll(STORES.chats),
  delete: (chatId) => deleteRecord(STORES.chats, chatId),
  getAllByMember: (userId) => getAll(STORES.chats, 'members', userId)
};

// Message operations
export const MessageStorage = {
  save: (message) => save(STORES.messages, message),
  get: (messageId) => get(STORES.messages, messageId),
  getAll: () => getAll(STORES.messages),
  getAllByChat: (chatId) => getAll(STORES.messages, 'chatId', chatId),
  delete: (messageId) => deleteRecord(STORES.messages, messageId),
  deleteByChat: async (chatId) => {
    const messages = await getAll(STORES.messages, 'chatId', chatId);
    return Promise.all(messages.map(msg => deleteRecord(STORES.messages, msg.id)));
  }
};

// Encryption key operations
export const KeyStorage = {
  save: (key) => save(STORES.keys, key),
  get: (userId, chatId) => get(STORES.keys, [userId, chatId]),
  getAll: () => getAll(STORES.keys),
  delete: (userId, chatId) => deleteRecord(STORES.keys, [userId, chatId])
};

// Avatar operations
export const AvatarStorage = {
  save: (userId, avatarData) => save(STORES.avatars, { userId, data: avatarData, timestamp: Date.now() }),
  get: (userId) => get(STORES.avatars, userId),
  getAll: () => getAll(STORES.avatars),
  delete: (userId) => deleteRecord(STORES.avatars, userId)
};

// File operations
export const FileStorage = {
  save: (file) => save(STORES.files, file),
  get: (fileId) => get(STORES.files, fileId),
  getAll: () => getAll(STORES.files),
  getByMessage: (messageId) => getAll(STORES.files, 'messageId', messageId),
  delete: (fileId) => deleteRecord(STORES.files, fileId)
};

// Clear all data
export async function clearAllData() {
  return new Promise((resolve, reject) => {
    if (!db) reject(new Error('Database not initialized'));
    
    const transaction = db.transaction(Object.values(STORES), 'readwrite');
    const storeNames = Object.values(STORES);
    let completed = 0;

    storeNames.forEach(storeName => {
      const request = transaction.objectStore(storeName).clear();
      request.onsuccess = () => {
        completed++;
        if (completed === storeNames.length) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
}