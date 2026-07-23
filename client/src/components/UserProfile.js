import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import AvatarUpload from './AvatarUpload';

export default function UserProfile({ userId, onClose }) {
  const { user: currentUser, token } = useAuth();
  const { onlineUsers } = useSocket();
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-dark-900 rounded-2xl w-full max-w-sm border border-dark-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-800">
          <h2 className="text-lg font-semibold text-white">{isOwn ? 'Мой профиль' : 'Профиль пользователя'}</h2>
          <button onClick={onClose} className="p-1 text-dark-400 hover:text-white rounded-lg">
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
              {isOwn ? (
                <AvatarUpload currentAvatar={profile.avatar} onAvatarChange={() => {}} size="xl" />
              ) : (
                <div className="w-28 h-28 rounded-full overflow-hidden bg-primary-600 flex items-center justify-center">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt={profile.username} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-3xl">{profile.username?.charAt(0).toUpperCase()}</span>
                  )}
                </div>
              )}
              {!isOwn && (
                <div className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-dark-900 ${isOnline ? 'bg-green-500' : 'bg-dark-500'}`} />
              )}
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{profile.username}</h3>

            <div className="w-full bg-dark-800 rounded-xl p-4 mt-2">
              <p className="text-xs text-dark-500 mb-1">Статус</p>
              <p className="text-sm text-dark-200">{profile.status || 'Привет, я использую Голуби!'}</p>
            </div>

            <div className="w-full mt-3 bg-dark-800 rounded-xl p-4">
              <p className="text-xs text-dark-500 mb-1">Онлайн</p>
              <p className={`text-sm ${isOnline ? 'text-green-400' : 'text-dark-400'}`}>
                {isOnline ? 'В сети' : 'Не в сети'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
