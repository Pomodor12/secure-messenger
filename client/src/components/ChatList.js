import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../config';
import { isDuplicateChat, sanitizeInput } from '../utils/helpers';
import { getOrCreateKeyPair } from '../utils/crypto';
import { saveChats as cacheChats, getChats as loadCachedChats } from '../utils/storage';
import ChatView from './ChatView';
import NewChatModal from './NewChatModal';
import UserProfile from './UserProfile';
import EmojiPicker from './EmojiPicker';
import PigeonLogo from './PigeonLogo';

export default function ChatList() {
  const { user, token, logout } = useAuth();
  const { socket, onlineUsers } = useSocket();
  const { themeName, setThemeName, themes } = useTheme();
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [viewProfileUserId, setViewProfileUserId] = useState(null);
  const [status, setStatus] = useState(user?.status || '');
  const [statusFrame, setStatusFrame] = useState(user?.status_frame || 'solid');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await loadCachedChats();
      if (cached.length > 0) setChats(cached);
      fetchChats();
      getOrCreateKeyPair();
    })();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleChatDeleted = ({ chatId }) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      setSelectedChat(prev => prev?.id === chatId ? null : prev);
    };

    const handleChatRenamed = ({ chatId, name }) => {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, name } : c));
      setSelectedChat(prev => prev?.id === chatId ? { ...prev, name } : prev);
    };

    const handleMemberRemoved = ({ chatId, userId }) => {
      if (userId === user.id) {
        setChats(prev => prev.filter(c => c.id !== chatId));
        setSelectedChat(prev => prev?.id === chatId ? null : prev);
      }
    };

    socket.on('chat_deleted', handleChatDeleted);
    socket.on('chat_renamed', handleChatRenamed);
    socket.on('member_removed', handleMemberRemoved);

    return () => {
      socket.off('chat_deleted', handleChatDeleted);
      socket.off('chat_renamed', handleChatRenamed);
      socket.off('member_removed', handleMemberRemoved);
    };
  }, [socket, user.id]);

  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setChats(data);
        await cacheChats(data);
      }
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  };

  const updateStatus = async () => {
    try {
      await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: sanitizeInput(status) })
      });
      setShowProfile(false);
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const setEmoji = async (emoji) => {
    try {
      await fetch(`${API_URL}/api/auth/emoji`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emoji })
      });
      user.emoji = emoji;
    } catch (error) {
      console.error('Error setting emoji:', error);
    }
  };

  const updateStatusFrame = async (frame) => {
    try {
      await fetch(`${API_URL}/api/auth/status-frame`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ statusFrame: frame })
      });
      setStatusFrame(frame);
    } catch (error) {
      console.error('Error updating status frame:', error);
    }
  };

  const handleNewChat = (newChat) => {
    if (isDuplicateChat(chats, (newChat.members || '').split(','))) {
      return;
    }
    setChats((prev) => [newChat, ...prev]);
    fetchChats();
  };

  const filteredChats = chats.filter(chat =>
    (chat.name?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (chat.members?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const isDark = themeName === 'dark';

  return (
    <div className={`flex h-screen ${isDark ? 'bg-dark-950' : 'bg-gray-50'}`}>
      <div className={`${selectedChat ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-96 ${isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200'} border-r`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-dark-800' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setViewProfileUserId(user.id)}>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {user?.username}
              </h2>
              <p className={`text-xs truncate max-w-[200px] ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>{user?.status}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNewChat(true)} className={`p-2 rounded-lg transition-colors ${isDark ? 'text-dark-400 hover:text-white hover:bg-dark-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`} title="Новый чат">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            <button onClick={() => setShowProfile(!showProfile)} className={`p-2 rounded-lg transition-colors ${isDark ? 'text-dark-400 hover:text-white hover:bg-dark-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <button onClick={logout} className={`p-2 rounded-lg transition-colors ${isDark ? 'text-dark-400 hover:text-red-400 hover:bg-dark-800' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'}`} title="Выйти">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>

        {/* Profile panel */}
        {showProfile && (
          <div className={`p-4 border-b ${isDark ? 'border-dark-800 bg-dark-800/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-3 mb-3">
              <button onClick={() => setShowEmojiPicker(true)} className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl transition-colors ${isDark ? 'bg-dark-700 hover:bg-dark-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
                {user?.emoji || '😀'}
              </button>
              <span className={`text-sm ${isDark ? 'text-dark-300' : 'text-gray-600'}`}>Нажмите, чтобы выбрать эмодзи</span>
            </div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-dark-300' : 'text-gray-700'}`}>Статус</label>
            <div className="flex gap-2">
              <input type="text" value={status} onChange={(e) => setStatus(e.target.value)} className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${isDark ? 'bg-dark-700 border-dark-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} placeholder="Ваш статус" />
              <button onClick={updateStatus} className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors">Сохранить</button>
            </div>
            {/* Comic frame picker */}
            <div className="mt-3">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-dark-300' : 'text-gray-700'}`}>Рамка статуса</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'solid', label: '▬', title: 'Сплошная' },
                  { id: 'dashed', label: '┄', title: 'Пунктирная' },
                  { id: 'double', label: '═', title: 'Двойная' },
                  { id: 'rounded', label: '〇', title: 'Скруглённая' },
                  { id: 'cloud', label: '☁', title: 'Облачко' },
                ].map(f => (
                  <button key={f.id} onClick={() => updateStatusFrame(f.id)} title={f.title}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFrame === f.id ? 'bg-primary-600 text-white' : isDark ? 'bg-dark-700 text-dark-300 hover:bg-dark-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Theme toggle */}
            <div className="mt-3">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-dark-300' : 'text-gray-700'}`}>Тема оформления</label>
              <div className="flex gap-2">
                <button onClick={() => setThemeName('dark')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${themeName === 'dark' ? 'bg-primary-600 text-white' : isDark ? 'bg-dark-700 text-dark-300 hover:bg-dark-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                  Тёмная
                </button>
                <button onClick={() => setThemeName('light')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${themeName === 'light' ? 'bg-primary-600 text-white' : isDark ? 'bg-dark-700 text-dark-300 hover:bg-dark-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                  Светлая
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-dark-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${isDark ? 'bg-dark-800 border-dark-700 text-white placeholder-dark-500' : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400'}`} placeholder="Поиск чатов..." />
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {filteredChats.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-64 ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>
              <PigeonLogo size={48} className="mb-3 opacity-50" />
              <p className="text-sm">Нет чатов</p>
              <p className="text-xs mt-1">Начните новый разговор</p>
            </div>
          ) : (
            filteredChats.map(chat => (
              <div key={chat.id} onClick={() => setSelectedChat(chat)} className={`chat-item flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${selectedChat?.id === chat.id ? 'active' : ''} ${isDark ? 'hover:bg-dark-800' : 'hover:bg-gray-100'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className={`font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {chat.is_group ? chat.name : chat.members}
                    </h3>
                    <span className={`text-xs flex-shrink-0 ml-2 ${isDark ? 'text-dark-500' : 'text-gray-400'}`}>{formatTime(chat.last_message_at)}</span>
                  </div>
                  <p className={`text-sm truncate ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>{chat.last_message || 'Нет сообщений'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedChat ? (
        <div className="flex-1">
          <ChatView
            chat={selectedChat}
            onBack={() => setSelectedChat(null)}
            onShowProfile={(uid) => setViewProfileUserId(uid)}
            onChatUpdated={(chatId, action, data) => {
              if (action === 'deleted') {
                setChats(prev => prev.filter(c => c.id !== chatId));
                setSelectedChat(null);
              } else if (action === 'renamed') {
                setChats(prev => prev.map(c => c.id === chatId ? { ...c, name: data } : c));
                setSelectedChat(prev => prev?.id === chatId ? { ...prev, name: data } : prev);
              }
            }}
          />
        </div>
      ) : (
        <div className={`hidden lg:flex flex-1 items-center justify-center ${isDark ? 'bg-dark-950' : 'bg-gray-50'}`}>
          <div className={`text-center ${isDark ? 'text-dark-500' : 'text-gray-400'}`}>
            <PigeonLogo size={96} className="mx-auto mb-4 opacity-50" />
            <h2 className="text-xl font-semibold">Голуби</h2>
            <p className="mt-2 text-sm">Зашифрованный обмен сообщениями</p>
            <p className={`mt-1 text-xs ${isDark ? 'text-dark-600' : 'text-gray-400'}`}>Выберите чат или начните новый разговор</p>
          </div>
        </div>
      )}

      {showNewChat && <NewChatModal onClose={() => { setShowNewChat(false); fetchChats(); }} />}

      {viewProfileUserId && <UserProfile userId={viewProfileUserId} onClose={() => setViewProfileUserId(null)} />}

      {showEmojiPicker && <EmojiPicker onSelect={setEmoji} onClose={() => setShowEmojiPicker(false)} />}
    </div>
  );
}
