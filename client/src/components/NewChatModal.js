import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../config';

export default function NewChatModal({ onClose }) {
  const { token } = useAuth();
  const { themeName } = useTheme();
  const isDark = themeName === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [chatName, setChatName] = useState('');

  useEffect(() => {
    if (searchQuery.length > 0) {
      const timer = setTimeout(() => searchUsers(), 300);
      return () => clearTimeout(timer);
    } else {
      setUsers([]);
    }
  }, [searchQuery]);

  const searchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/users/search?q=${searchQuery}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setUsers(data);
    } catch (error) {
      console.error('Error searching users:', error);
    }
  };

  const toggleUser = (user) => {
    setSelectedUsers(prev => {
      const exists = prev.find(u => u.id === user.id);
      if (exists) return prev.filter(u => u.id !== user.id);
      return [...prev, user];
    });
  };

  const createChat = async () => {
    if (selectedUsers.length === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: selectedUsers.length > 1 ? chatName : null,
          isGroup: selectedUsers.length > 1,
          memberIds: selectedUsers.map(u => u.id)
        })
      });
      if (res.ok) onClose();
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  const panelBg = isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200';
  const textColor = isDark ? 'text-white' : 'text-gray-900';
  const mutedText = isDark ? 'text-dark-300' : 'text-gray-600';
  const inputBg = isDark ? 'bg-dark-800 border-dark-700 text-white placeholder-dark-500' : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400';
  const hoverBg = isDark ? 'hover:bg-dark-800' : 'hover:bg-gray-100';
  const selectedBg = isDark ? 'bg-primary-600/20' : 'bg-primary-100';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`${panelBg} rounded-2xl w-full max-w-md border shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-dark-800' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-semibold ${textColor}`}>Новый чат</h2>
          <button onClick={onClose} className={`p-1 rounded-lg ${isDark ? 'text-dark-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6">
          {selectedUsers.length > 1 && (
            <div className="mb-4">
              <label className={`block text-sm font-medium mb-1 ${mutedText}`}>Название группы</label>
              <input type="text" value={chatName} onChange={(e) => setChatName(e.target.value)} className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${inputBg}`} placeholder="Введите название группы" autoFocus />
            </div>
          )}

          <div className="mb-4">
            <label className={`block text-sm font-medium mb-1 ${mutedText}`}>Поиск пользователей</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${inputBg}`} placeholder="Введите имя пользователя..." autoFocus />
          </div>

          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {selectedUsers.map(user => (
                <div key={user.id} className="flex items-center gap-1 px-3 py-1 bg-primary-600/20 text-primary-400 rounded-full text-sm">
                  {user.username}
                  <button onClick={() => toggleUser(user)} className="hover:text-white">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            {users.map(user => (
              <div key={user.id} onClick={() => toggleUser(user)} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${selectedUsers.find(u => u.id === user.id) ? selectedBg : hoverBg}`}>
                <div className="text-2xl">{user.emoji || '🕊️'}</div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-medium ${textColor}`}>{user.username} <span className="text-base">{user.emoji || '🕊️'}</span></h4>
                </div>
                {selectedUsers.find(u => u.id === user.id) && (
                  <svg className="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                )}
              </div>
            ))}
            {searchQuery && users.length === 0 && (
              <p className={`text-center py-4 ${isDark ? 'text-dark-500' : 'text-gray-400'}`}>Пользователи не найдены</p>
            )}
          </div>
        </div>

        <div className={`px-6 py-4 border-t ${isDark ? 'border-dark-800' : 'border-gray-200'}`}>
          <button onClick={createChat} disabled={selectedUsers.length === 0} className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {selectedUsers.length > 1 ? `Создать группу (${selectedUsers.length} чел.)` : 'Начать чат'}
          </button>
        </div>
      </div>
    </div>
  );
}
