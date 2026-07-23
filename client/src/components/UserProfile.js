import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';

export default function UserProfile({ userId, onClose }) {
  const { user: currentUser, token } = useAuth();
  const { onlineUsers, emojiChanges } = useSocket();
  const { themeName } = useTheme();
  const isDark = themeName === 'dark';
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId) {
      fetch(`${process.env.REACT_APP_API_URL || window.location.origin}/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => { setProfile(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [userId, token]);

  const isOwn = currentUser?.id === userId;
  const isOnline = onlineUsers.has(userId);
  const userEmoji = emojiChanges[userId] || profile?.emoji || '🕊️';

  const panelBg = isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200';
  const textColor = isDark ? 'text-white' : 'text-gray-900';
  const mutedText = isDark ? 'text-dark-500' : 'text-gray-400';
  const cardBg = isDark ? 'bg-dark-800' : 'bg-gray-100';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`${panelBg} rounded-2xl w-full max-w-sm border shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-dark-800' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-semibold ${textColor}`}>{isOwn ? 'Мой профиль' : 'Профиль пользователя'}</h2>
          <button onClick={onClose} className={`p-1 rounded-lg ${isDark ? 'text-dark-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profile && (
          <div className="p-6 flex flex-col items-center">
            <div className="relative mb-4">
              <div className="text-7xl">{userEmoji}</div>
              {!isOwn && (
                <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 ${isDark ? 'border-dark-900' : 'border-white'} ${isOnline ? 'bg-green-500' : isDark ? 'bg-dark-500' : 'bg-gray-400'}`} />
              )}
            </div>

            <h3 className={`text-xl font-bold mb-1 ${textColor}`}>{profile.username}</h3>

            <div className={`w-full rounded-xl p-4 mt-2 ${cardBg}`}>
              <p className={`text-xs mb-1 ${mutedText}`}>Статус</p>
              <p className={`text-sm ${isDark ? 'text-dark-200' : 'text-gray-700'}`}>{profile.status || 'Общаюсь голубями'}</p>
            </div>

            <div className={`w-full mt-3 rounded-xl p-4 ${cardBg}`}>
              <p className={`text-xs mb-1 ${mutedText}`}>Онлайн</p>
              <p className={`text-sm ${isOnline ? 'text-green-400' : isDark ? 'text-dark-400' : 'text-gray-500'}`}>
                {isOnline ? 'В сети' : 'Не в сети'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
