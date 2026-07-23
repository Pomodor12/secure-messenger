import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const KEY_STORAGE_KEY = 'messenger_e2e_keys';
const PEER_KEYS_KEY = 'messenger_peer_keys';

export function generateKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

export async function getOrCreateKeyPair() {
  const stored = localStorage.getItem(KEY_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      publicKey: parsed.publicKey,
      secretKey: parsed.secretKey,
      publicKeyBytes: naclUtil.decodeBase64(parsed.publicKey),
      secretKeyBytes: naclUtil.decodeBase64(parsed.secretKey),
    };
  }
  const kp = generateKeyPair();
  localStorage.setItem(KEY_STORAGE_KEY, JSON.stringify(kp));
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyBytes: naclUtil.decodeBase64(kp.publicKey),
    secretKeyBytes: naclUtil.decodeBase64(kp.secretKey),
  };
}

export function savePeerPublicKey(userId, publicKeyBase64) {
  const peers = JSON.parse(localStorage.getItem(PEER_KEYS_KEY) || '{}');
  peers[userId] = publicKeyBase64;
  localStorage.setItem(PEER_KEYS_KEY, JSON.stringify(peers));
}

export function getPeerPublicKey(userId) {
  const peers = JSON.parse(localStorage.getItem(PEER_KEYS_KEY) || '{}');
  return peers[userId] || null;
}

export function encryptMessage(plainText, recipientPublicKeyBase64, senderSecretKeyBase64) {
  try {
    const recipientPk = naclUtil.decodeBase64(recipientPublicKeyBase64);
    const senderSk = naclUtil.decodeBase64(senderSecretKeyBase64);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const messageBytes = naclUtil.decodeUTF8(plainText);
    const encrypted = nacl.box(messageBytes, nonce, recipientPk, senderSk);
    return {
      encrypted: naclUtil.encodeBase64(encrypted),
      nonce: naclUtil.encodeBase64(nonce),
    };
  } catch (e) {
    console.error('Encryption failed:', e);
    return null;
  }
}

export function decryptMessage(encryptedBase64, nonceBase64, senderPublicKeyBase64, recipientSecretKeyBase64) {
  try {
    const encrypted = naclUtil.decodeBase64(encryptedBase64);
    const nonce = naclUtil.decodeBase64(nonceBase64);
    const senderPk = naclUtil.decodeBase64(senderPublicKeyBase64);
    const recipientSk = naclUtil.decodeBase64(recipientSecretKeyBase64);
    const decrypted = nacl.box.open(encrypted, nonce, senderPk, recipientSk);
    if (!decrypted) return null;
    return naclUtil.encodeUTF8(decrypted);
  } catch (e) {
    console.error('Decryption failed:', e);
    return null;
  }
}

export function encryptMessageSymmetric(plainText, key) {
  try {
    const keyBytes = nacl.hash(naclUtil.decodeUTF8(key)).slice(0, nacl.secretbox.keyLength);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = naclUtil.decodeUTF8(plainText);
    const encrypted = nacl.secretbox(messageBytes, nonce, keyBytes);
    return {
      encrypted: naclUtil.encodeBase64(encrypted),
      nonce: naclUtil.encodeBase64(nonce),
    };
  } catch (e) {
    console.error('Symmetric encryption failed:', e);
    return null;
  }
}

export function decryptMessageSymmetric(encryptedBase64, nonceBase64, key) {
  try {
    const keyBytes = nacl.hash(naclUtil.decodeUTF8(key)).slice(0, nacl.secretbox.keyLength);
    const encrypted = naclUtil.decodeBase64(encryptedBase64);
    const nonce = naclUtil.decodeBase64(nonceBase64);
    const decrypted = nacl.secretbox.open(encrypted, nonce, keyBytes);
    if (!decrypted) return null;
    return naclUtil.encodeUTF8(decrypted);
  } catch (e) {
    console.error('Symmetric decryption failed:', e);
    return null;
  }
}
