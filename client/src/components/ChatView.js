import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../config';
import { getOrCreateKeyPair, encryptMessage, decryptMessage } from '../utils/crypto';
import { saveMessage, getMessagesByChatId } from '../utils/storage';
import { compressImage, sanitizeInput } from '../utils/helpers';
import ChatSettings from './ChatSettings';
import PigeonLogo from './PigeonLogo';
import PigeonSendIcon from './PigeonSendIcon';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function ImageTimer({ createdAt, onExpired }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    const created = new Date(createdAt).getTime();
    const expires = created + 2 * 60 * 1000;
    const update = () => {
      const left = Math.max(0, expires - Date.now());
      setRemaining(left);
      if (left <= 0) { onExpired(); return false; }
      return true;
    };
    update();
    const interval = setInterval(() => { if (!update()) clearInterval(interval); }, 1000);
    return () => clearInterval(interval);
  }, [createdAt, onExpired]);

  if (remaining === null || remaining <= 0) return null;
  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const pct = remaining / (2 * 60 * 1000);

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <svg width="14" height="14" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <circle cx="7" cy="7" r="6" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray={`${pct * 37.7} 37.7`} transform="rotate(-90 7 7)" />
      </svg>
      <span className="text-xs text-dark-500">{min}:{sec.toString().padStart(2, '0')}</span>
    </div>
  );
}

const FRAME_STYLES = {
  solid: { border: '1.5px solid currentColor', borderRadius: '8px', padding: '1px 6px' },
  dashed: { border: '1.5px dashed currentColor', borderRadius: '8px', padding: '1px 6px' },
  double: { border: '2px double currentColor', borderRadius: '8px', padding: '1px 6px' },
  rounded: { border: '1.5px solid currentColor', borderRadius: '20px', padding: '1px 6px' },
  cloud: { border: '1.5px solid currentColor', borderRadius: '12px 12px 12px 4px', padding: '1px 6px' },
};

function SpeechBubble({ text, frame, isDark }) {
  if (!text) return null;
  const frameStyle = FRAME_STYLES[frame] || FRAME_STYLES.solid;
  const colorClass = isDark ? 'text-dark-300' : 'text-gray-600';
  return (
    <div className={colorClass} style={{ ...frameStyle, fontSize: '10px', lineHeight: '1.2', whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
}

function ReactionPicker({ onSelect, isDark }) {
  return (
    <div className={`absolute bottom-full mb-1 left-0 z-20 flex gap-1 px-2 py-1.5 rounded-xl shadow-lg ${isDark ? 'bg-dark-800 border border-dark-700' : 'bg-white border border-gray-200'}`} onClick={(e) => e.stopPropagation()}>
      {QUICK_REACTIONS.map(emoji => (
        <button key={emoji} onClick={(e) => { e.stopPropagation(); onSelect(emoji); }} className="text-lg hover:scale-125 transition-transform px-0.5">
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReplyPreview({ replyTo, isDark, onCancel }) {
  if (!replyTo) return null;
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 mb-1 rounded-t-xl text-xs border-l-2 border-primary-500 ${isDark ? 'bg-dark-800/50 text-dark-300' : 'bg-gray-100 text-gray-600'}`}>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-primary-400">{replyTo.username}</span>
        <p className="truncate opacity-70">{replyTo.content}</p>
      </div>
      <button onClick={onCancel} className={`flex-shrink-0 ${isDark ? 'text-dark-500 hover:text-dark-300' : 'text-gray-400 hover:text-gray-600'}`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

export default function ChatView({ chat, onBack, onShowProfile, onChatUpdated }) {
  const { user, token } = useAuth();
  const { socket, typingUsers, emojiChanges, statusFrameChanges } = useSocket();
  const { themeName } = useTheme();
  const isDark = themeName === 'dark';
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);
  const [activeMsgId, setActiveMsgId] = useState(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const keyPairRef = useRef(null);

  useEffect(() => {
    (async () => { keyPairRef.current = await getOrCreateKeyPair(); })();
  }, []);

  useEffect(() => {
    if (chat) {
      setLoading(true);
      setReplyTo(null);
      setActiveMsgId(null);
      setReactionPickerMsgId(null);
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
        } catch (e) { console.error('Load messages error:', e); }
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

      const handleChatDeleted = ({ chatId }) => { onChatUpdated?.(chatId, 'deleted'); };
      const handleChatRenamed = ({ chatId, name }) => { onChatUpdated?.(chatId, 'renamed', name); };
      const handleMemberRemoved = ({ chatId, userId }) => { if (userId === user.id) onChatUpdated?.(chatId, 'deleted'); };

      const handleReactionUpdate = ({ chatId: cId, messageId, reactions }) => {
        if (cId === chat.id) {
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        }
      };

      socket.on('new_message', handleMessage);
      socket.on('message_deleted', handleDelete);
      socket.on('chat_deleted', handleChatDeleted);
      socket.on('chat_renamed', handleChatRenamed);
      socket.on('member_removed', handleMemberRemoved);
      socket.on('reaction_updated', handleReactionUpdate);

      return () => {
        socket.off('new_message', handleMessage);
        socket.off('message_deleted', handleDelete);
        socket.off('chat_deleted', handleChatDeleted);
        socket.off('chat_renamed', handleChatRenamed);
        socket.off('member_removed', handleMemberRemoved);
        socket.off('reaction_updated', handleReactionUpdate);
        socket.emit('leave_chat', chat.id);
      };
    }
  }, [socket, chat]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const handler = (e) => {
      if (reactionPickerMsgId && !e.target.closest('.reaction-picker') && !e.target.closest('.reaction-toggle')) setReactionPickerMsgId(null);
      if (activeMsgId && !e.target.closest('.msg-actions') && !e.target.closest('.msg-bubble')) setActiveMsgId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerMsgId, activeMsgId]);

  const fetchPeerPublicKey = async (peerUserId) => {
    try {
      const res = await fetch(`${API_URL}/api/users/${peerUserId}/public-key`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      return data.publicKey || null;
    } catch (e) { return null; }
  };

  const sendEncrypted = useCallback(async (content, messageType = 'text') => {
    if (!socket || !chat) return;
    setSending(true);
    const payload = { chatId: chat.id, content, messageType };
    if (replyTo) payload.replyTo = replyTo.id;

    const peerId = chat.members?.split(',')[0]?.trim();
    if (peerId && keyPairRef.current) {
      const peerKey = await fetchPeerPublicKey(peerId);
      if (peerKey) {
        const encrypted = encryptMessage(content, peerKey, keyPairRef.current.secretKey);
        if (encrypted) { payload.encryptedContent = encrypted.encrypted; payload.iv = encrypted.nonce; }
      }
    }

    socket.emit('send_message', payload);
    socket.emit('stop_typing', { chatId: chat.id });
    setSending(false);
    setReplyTo(null);
    setActiveMsgId(null);
  }, [socket, chat, token, replyTo]);

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
    try { const compressed = await compressImage(file, 600, 0.7); await sendEncrypted(compressed, 'image'); }
    catch (err) { console.error('Image send failed:', err); }
    e.target.value = '';
  };

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Удалить это сообщение?')) return;
    await fetch(`${API_URL}/api/chats/${chat.id}/messages/${messageId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  };

  const handleImageExpired = async (messageId) => {
    await fetch(`${API_URL}/api/chats/${chat.id}/messages/${messageId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  };

  const handleReaction = async (messageId, emoji) => {
    setReactionPickerMsgId(null);
    try {
      await fetch(`${API_URL}/api/chats/${chat.id}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emoji })
      });
    } catch (e) { console.error('Reaction error:', e); }
  };

  const handleTyping = () => {
    if (socket) {
      socket.emit('typing', { chatId: chat.id });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => { socket.emit('stop_typing', { chatId: chat.id }); }, 2000);
    }
  };

  const getChatName = () => chat.name || chat.members || 'Неизвестный';
  const typingUser = typingUsers[chat.id];

  const getReactionCounts = (reactions) => {
    if (!reactions) return [];
    try {
      const parsed = typeof reactions === 'string' ? JSON.parse(reactions) : reactions;
      return Object.entries(parsed).map(([emoji, userIds]) => ({
        emoji, count: userIds.length, me: userIds.includes(user.id)
      }));
    } catch (e) { return []; }
  };

  return (
    <div className={`flex flex-col h-full ${isDark ? 'bg-dark-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b ${isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200'}`}>
        <button onClick={onBack} className={`flex-shrink-0 sm:hidden ${isDark ? 'text-dark-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
              <h3 className={`font-semibold truncate text-sm sm:text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {emojiChanges[chat.member_id] || chat.member_emoji || ''}{' '}
                {getChatName()}
              </h3>
              {chat.member_status && !chat.is_group && (
                <SpeechBubble text={chat.member_status} frame={statusFrameChanges[chat.member_id] || chat.member_frame} isDark={isDark} />
              )}
            </div>
            <p className={`text-xs truncate ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>
              {typingUser ? `${typingUser.username} печатает...` : (chat.is_group ? 'Группа' : 'В сети')}
            </p>
          </div>
        </button>
        <div className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg ${isDark ? 'bg-dark-800' : 'bg-gray-100'}`}>
          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
          <span className={`text-xs ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>E2E</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>
            <PigeonLogo size={64} className="mb-4 opacity-50" />
            <p>Пока нет сообщений</p>
            <p className="text-sm">Отправьте первое сообщение, чтобы начать разговор</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.user_id === user.id;
            const showAvatar = index === 0 || messages[index - 1]?.user_id !== msg.user_id;
            const reactionCounts = getReactionCounts(msg.reactions);
            const replyData = msg.reply_to_data || (msg.reply_to ? messages.find(m => m.id === msg.reply_to) : null);

            return (
              <div key={msg.id || index} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${showAvatar ? 'mt-3 sm:mt-4' : 'mt-1'}`}>
                <div className={`max-w-[85vw] sm:max-w-xs lg:max-w-md ${isOwn ? 'order-1' : ''}`}>
                  {!isOwn && showAvatar && (
                    <p className={`text-xs mb-1 ml-1 cursor-pointer hover:text-primary-400 ${isDark ? 'text-dark-400' : 'text-gray-500'}`} onClick={() => onShowProfile?.(msg.user_id)}>
                      {chat.member_emoji || ''} {msg.username}
                    </p>
                  )}

                  {/* Reply quote in message */}
                  {replyData && (
                    <div className={`mb-0.5 px-2.5 py-1 rounded-lg text-xs border-l-2 border-primary-500/50 ${isDark ? 'bg-dark-800/40 text-dark-400' : 'bg-gray-100/80 text-gray-500'}`}>
                      <span className="font-medium text-primary-400">{replyData.username}</span>
                      <p className="truncate opacity-70">{replyData.content}</p>
                    </div>
                  )}

                  <div className="group relative">
                    <div
                      className={`msg-bubble px-3 sm:px-4 py-2 rounded-2xl ${isOwn ? 'bg-primary-600 text-white rounded-br-md' : isDark ? 'bg-dark-800 text-dark-100 rounded-bl-md' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'}`}
                      onClick={() => { if (window.innerWidth < 640) setActiveMsgId(activeMsgId === msg.id ? null : msg.id); }}
                      onDoubleClick={() => setReplyTo({ id: msg.id, username: msg.username, content: msg.content })}
                    >
                      {msg.message_type === 'image' ? (
                        <div>
                          <img src={msg.content} alt="фото" className="rounded-lg max-w-full" />
                          {isOwn && <ImageTimer createdAt={msg.created_at} onExpired={() => handleImageExpired(msg.id)} />}
                        </div>
                      ) : (
                        <p className="break-words text-sm sm:text-base">{msg.content}</p>
                      )}
                    </div>

                    {/* Reaction picker button */}
                    <div className={`msg-actions absolute ${isOwn ? '-left-7' : '-right-7'} top-0 transition-opacity ${activeMsgId === msg.id ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100 opacity-0'}`}>
                      <button
                        className={`reaction-toggle p-1 rounded-full ${isDark ? 'hover:bg-dark-700 text-dark-400' : 'hover:bg-gray-200 text-gray-400'}`}
                        onClick={(e) => { e.stopPropagation(); setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id); }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </button>
                      {reactionPickerMsgId === msg.id && (
                        <div className="reaction-picker reaction-toggle">
                          <ReactionPicker onSelect={(emoji) => handleReaction(msg.id, emoji)} isDark={isDark} />
                        </div>
                      )}
                    </div>

                    {/* Delete button */}
                    {isOwn && (
                      <button onClick={() => handleDeleteMessage(msg.id)} className={`msg-actions absolute -top-2 -right-2 transition-opacity ${activeMsgId === msg.id ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100 opacity-0'} bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>

                  {/* Reaction badges */}
                  {reactionCounts.length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end mr-1' : 'ml-1'}`}>
                      {reactionCounts.map(({ emoji, count, me }) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(msg.id, emoji)}
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-colors ${me ? (isDark ? 'bg-primary-900/50 border border-primary-500/50' : 'bg-primary-100 border border-primary-300') : (isDark ? 'bg-dark-800 border border-dark-700 hover:border-dark-600' : 'bg-gray-100 border border-gray-200 hover:border-gray-300')}`}
                        >
                          <span>{emoji}</span>
                          {count > 1 && <span className={isDark ? 'text-dark-300' : 'text-gray-600'}>{count}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className={`text-xs mt-0.5 ${isOwn ? 'text-right mr-1' : 'ml-1'} ${isDark ? 'text-dark-500' : 'text-gray-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div className={`px-3 sm:px-4 py-2 border-t ${isDark ? 'bg-dark-800/80 border-dark-700' : 'bg-gray-50 border-gray-200'}`}>
          <ReplyPreview replyTo={replyTo} isDark={isDark} onCancel={() => setReplyTo(null)} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSendMessage} className={`p-2.5 sm:p-4 border-t ${isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 sm:gap-3">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSend} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className={`flex-shrink-0 p-2 rounded-lg transition-colors ${isDark ? 'text-dark-400 hover:text-white hover:bg-dark-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => { setNewMessage(e.target.value); handleTyping(); }}
            placeholder={replyTo ? `Ответ ${replyTo.username}...` : 'Введите сообщение...'}
            className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-dark-800 border-dark-700 text-white placeholder-dark-500' : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400'}`}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="flex-shrink-0 p-2.5 sm:p-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PigeonSendIcon size={20} />
          </button>
        </div>
      </form>

      {showSettings && (
        <ChatSettings
          chat={chat}
          onClose={() => setShowSettings(false)}
          onChatDeleted={(chatId) => { setShowSettings(false); onChatUpdated?.(chatId, 'deleted'); }}
        />
      )}
    </div>
  );
}
