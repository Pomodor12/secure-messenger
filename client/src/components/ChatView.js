import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import { getOrCreateKeyPair, encryptMessage, decryptMessage } from '../utils/crypto';
import { saveMessage, getMessagesByChatId } from '../utils/storage';
import { compressImage, sanitizeInput } from '../utils/helpers';
import ChatSettings from './ChatSettings';

export default function ChatView({ chat, onBack, onShowProfile, onChatUpdated }) {
  const { user, token } = useAuth();
  const { socket, typingUsers } = useSocket();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const keyPairRef = useRef(null);

  useEffect(() => {
    (async () => {
      keyPairRef.current = await getOrCreateKeyPair();
    })();
  }, []);

  useEffect(() => {
    if (chat) {
      setLoading(true);
      (async () => {
        try {
          const cached = await getMessagesByChatId(chat.id);
          if (cached.length > 0) setMessages(cached);

          const res = await fetch(`${API_URL}/api/chats/${chat.id}/messages`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          const decrypted = await Promise.all(data.map(async (msg) => {
            if (msg.encrypted_content && msg.iv && keyPairRef.current) {
              const senderKey = await fetchPeerPublicKey(msg.user_id);
              if (senderKey) {
                const content = decryptMessage(msg.encrypted_content, msg.iv, senderKey, keyPairRef.current.secretKey);
                if (content) return { ...msg, content };
              }
            }
            return msg;
          }));
          setMessages(decrypted);
          await saveMessages(decrypted);
        } catch (e) {
          console.error('Load messages error:', e);
        }
        setLoading(false);
      })();
    }
  }, [chat, token, user.id]);

  useEffect(() => {
    if (socket && chat) {
      socket.emit('join_chat', chat.id);
      const handleMessage = async (message) => {
        if (message.chat_id === chat.id) {
          if (message.encrypted_content && message.iv && keyPairRef.current) {
            const senderKey = await fetchPeerPublicKey(message.user_id);
            if (senderKey) {
              const content = decryptMessage(message.encrypted_content, message.iv, senderKey, keyPairRef.current.secretKey);
              if (content) message = { ...message, content };
            }
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          await saveMessage(message);
        }
      };

      const handleDelete = ({ messageId }) => {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      };

      const handleChatDeleted = ({ chatId }) => {
        onChatUpdated?.(chatId, 'deleted');
      };

      const handleChatRenamed = ({ chatId, name }) => {
        onChatUpdated?.(chatId, 'renamed', name);
      };

      const handleMemberRemoved = ({ chatId, userId }) => {
        if (userId === user.id) {
          onChatUpdated?.(chatId, 'deleted');
        }
      };

      socket.on('new_message', handleMessage);
      socket.on('message_deleted', handleDelete);
      socket.on('chat_deleted', handleChatDeleted);
      socket.on('chat_renamed', handleChatRenamed);
      socket.on('member_removed', handleMemberRemoved);

      return () => {
        socket.off('new_message', handleMessage);
        socket.off('message_deleted', handleDelete);
        socket.off('chat_deleted', handleChatDeleted);
        socket.off('chat_renamed', handleChatRenamed);
        socket.off('member_removed', handleMemberRemoved);
        socket.emit('leave_chat', chat.id);
      };
    }
  }, [socket, chat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchPeerPublicKey = async (peerUserId) => {
    try {
      const res = await fetch(`${API_URL}/api/users/${peerUserId}/public-key`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      return data.publicKey || null;
    } catch (e) {
      return null;
    }
  };

  const sendEncrypted = useCallback(async (content, messageType = 'text') => {
    if (!socket || !chat) return;
    setSending(true);
    const payload = {
      chatId: chat.id,
      content,
      messageType,
    };

    const peerId = chat.members?.split(',')[0]?.trim();
    if (peerId && keyPairRef.current) {
      const peerKey = await fetchPeerPublicKey(peerId);
      if (peerKey) {
        const encrypted = encryptMessage(content, peerKey, keyPairRef.current.secretKey);
        if (encrypted) {
          payload.encryptedContent = encrypted.encrypted;
          payload.iv = encrypted.nonce;
        }
      }
    }

    socket.emit('send_message', payload);
    socket.emit('stop_typing', { chatId: chat.id });
    setSending(false);
  }, [socket, chat, token]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const safe = sanitizeInput(newMessage.trim());
    await sendEncrypted(safe);
    setNewMessage('');
  };

  const handleImageSend = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 600, 0.7);
      await sendEncrypted(compressed, 'image');
    } catch (err) {
      console.error('Image send failed:', err);
    }
    e.target.value = '';
  };

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Удалить это сообщение?')) return;
    await fetch(`${API_URL}/api/chats/${chat.id}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const handleTyping = () => {
    if (socket) {
      socket.emit('typing', { chatId: chat.id });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stop_typing', { chatId: chat.id });
      }, 2000);
    }
  };

  const getChatName = () => chat.name || chat.members || 'Неизвестный';
  const typingUser = typingUsers[chat.id];

  const renderAvatar = (emoji, username, size = 'w-10 h-10') => (
    <div className={`${size} rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {emoji ? <span className={size === 'w-8 h-8' ? 'text-sm' : 'text-xl'}>{emoji}</span> : username?.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-dark-950">
      <div className="flex items-center gap-3 px-4 py-3 bg-dark-900 border-b border-dark-800">
        <button onClick={onBack} className="lg:hidden text-dark-400 hover:text-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={() => setShowSettings(true)} className="flex items-center gap-3 flex-1 min-w-0">
          {renderAvatar(chat.emoji, getChatName())}
          <div className="flex-1 text-left min-w-0">
            <h3 className="font-semibold text-white truncate">{getChatName()}</h3>
            <p className="text-xs text-dark-400 truncate">
              {typingUser ? `${typingUser.username} печатает...` : (chat.is_group ? 'Группа' : 'В сети')}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 px-2 py-1 bg-dark-800 rounded-lg">
          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
          <span className="text-xs text-dark-400">E2E</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <p>Пока нет сообщений</p>
            <p className="text-sm">Отправьте первое сообщение, чтобы начать разговор</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.user_id === user.id;
            const showAvatar = index === 0 || messages[index - 1]?.user_id !== msg.user_id;
            return (
              <div key={msg.id || index} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${showAvatar ? 'mt-4' : 'mt-1'}`}>
                {!isOwn && (
                  <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-xs font-semibold text-white mr-2 flex-shrink-0 cursor-pointer" onClick={() => onShowProfile?.(msg.user_id)}>
                    {showAvatar ? (msg.emoji || msg.username?.charAt(0).toUpperCase()) : ''}
                  </div>
                )}
                <div className={`max-w-xs lg:max-w-md ${isOwn ? 'order-1' : ''}`}>
                  {!isOwn && showAvatar && (
                    <p className="text-xs text-dark-400 mb-1 ml-1 cursor-pointer hover:text-primary-400" onClick={() => onShowProfile?.(msg.user_id)}>{msg.username}</p>
                  )}
                  <div className="group relative">
                    <div className={`px-4 py-2 rounded-2xl ${isOwn ? 'bg-primary-600 text-white rounded-br-md' : 'bg-dark-800 text-dark-100 rounded-bl-md'}`}>
                      {msg.message_type === 'image' ? (
                        <img src={msg.content} alt="фото" className="rounded-lg max-w-full" />
                      ) : (
                        <p className="break-words">{msg.content}</p>
                      )}
                    </div>
                    {isOwn && (
                      <button onClick={() => handleDeleteMessage(msg.id)} className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                  <p className={`text-xs text-dark-500 mt-1 ${isOwn ? 'text-right mr-1' : 'ml-1'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="p-4 bg-dark-900 border-t border-dark-800">
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSend} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => { setNewMessage(e.target.value); handleTyping(); }}
            placeholder="Введите сообщение..."
            className="flex-1 px-4 py-3 bg-dark-800 border border-dark-700 rounded-xl text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="p-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </div>
      </form>

      {showSettings && (
        <ChatSettings
          chat={chat}
          onClose={() => setShowSettings(false)}
          onChatDeleted={(chatId) => {
            setShowSettings(false);
            onChatUpdated?.(chatId, 'deleted');
          }}
        />
      )}
    </div>
  );
}
