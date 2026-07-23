import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { API_URL } from '../config';

export default function ChatSettings({ chat, onClose, onChatDeleted }) {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(chat.name || '');
  const [inviteMode, setInviteMode] = useState(false);
  const [selectedInvite, setSelectedInvite] = useState([]);

  const isCreator = chat.created_by === user.id;

  useEffect(() => {
    loadMembers();
    loadUsers();
  }, [chat.id]);

  const loadMembers = async () => {
    const res = await fetch(`${API_URL}/api/chats/${chat.id}/members`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setMembers(data);
    setLoading(false);
  };

  const loadUsers = async () => {
    const res = await fetch(`${API_URL}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setAllUsers(data.filter(u => u.id !== user.id));
  };

  const handleRename = async () => {
    if (!newName.trim()) return;
    await fetch(`${API_URL}/api/chats/${chat.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName.trim() })
    });
    setRenaming(false);
  };

  const handleDeleteChat = async () => {
    if (!window.confirm('Удалить этот чат и все сообщения?')) return;
    await fetch(`${API_URL}/api/chats/${chat.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    onChatDeleted?.(chat.id);
  };

  const handleRemoveMember = async (userId) => {
    await fetch(`${API_URL}/api/chats/${chat.id}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    loadMembers();
  };

  const handleInvite = async () => {
    if (selectedInvite.length === 0) return;
    await fetch(`${API_URL}/api/chats/${chat.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userIds: selectedInvite })
    });
    setSelectedInvite([]);
    setInviteMode(false);
    loadMembers();
  };

  const handleLeave = async () => {
    if (!window.confirm('Покинуть эту группу?')) return;
    await fetch(`${API_URL}/api/chats/${chat.id}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    onChatDeleted?.(chat.id);
  };

  const toggleInvite = (userId) => {
    setSelectedInvite(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  if (!chat.is_group) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-dark-900 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-semibold text-white mb-4">Информация о чате</h2>
          <div className="text-dark-300 mb-4">
            <p>Участники: {chat.members}</p>
          </div>
          <button onClick={handleDeleteChat} className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg mb-2">Удалить чат</button>
          <button onClick={onClose} className="w-full py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg">Закрыть</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-dark-900 rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Настройки группы</h2>
          <button onClick={onClose} className="text-dark-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mb-4">
          {renaming ? (
            <div className="flex gap-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} className="flex-1 px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-white" autoFocus />
              <button onClick={handleRename} className="px-3 py-2 bg-primary-600 text-white rounded-lg">Сохранить</button>
              <button onClick={() => setRenaming(false)} className="px-3 py-2 bg-dark-700 text-white rounded-lg">Отмена</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-dark-300">{chat.name || 'Без названия'}</span>
              {isCreator && <button onClick={() => setRenaming(true)} className="text-primary-400 hover:text-primary-300 text-sm">Переименовать</button>}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-dark-300">Участники ({members.length})</span>
            <button onClick={() => setInviteMode(!inviteMode)} className="text-primary-400 hover:text-primary-300 text-sm">+ Пригласить</button>
          </div>

          {inviteMode && (
            <div className="mb-3 p-3 bg-dark-800 rounded-lg max-h-40 overflow-y-auto">
              {allUsers.filter(u => !members.some(m => m.id === u.id)).map(u => (
                <label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-dark-700 rounded px-2">
                  <input type="checkbox" checked={selectedInvite.includes(u.id)} onChange={() => toggleInvite(u.id)} className="rounded" />
                  <span className="text-white text-sm">{u.username}</span>
                </label>
              ))}
              <button onClick={handleInvite} disabled={selectedInvite.length === 0} className="mt-2 w-full py-1.5 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">Добавить</button>
            </div>
          )}

          {loading ? (
            <div className="text-dark-400 text-sm">Загрузка...</div>
          ) : (
            members.map(m => (
                <div key={m.id} className="flex items-center justify-between py-2 px-2 hover:bg-dark-800 rounded">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-xs text-white">
                    {m.emoji ? <span className="text-sm">{m.emoji}</span> : m.avatar ? <img src={m.avatar} alt="" className="w-8 h-8 rounded-full" /> : m.username?.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-white text-sm">{m.username}</span>
                  {m.id === chat.created_by && <span className="text-xs text-primary-400">(создатель)</span>}
                </div>
                {(isCreator || m.id === user.id) && m.id !== chat.created_by && (
                  <button onClick={() => handleRemoveMember(m.id)} className="text-red-400 hover:text-red-300 text-xs">
                    {m.id === user.id ? 'Выйти' : 'Удалить'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          {!isCreator && <button onClick={handleLeave} className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg">Покинуть группу</button>}
          {isCreator && <button onClick={handleDeleteChat} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg">Удалить группу</button>}
          <button onClick={onClose} className="flex-1 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg">Закрыть</button>
        </div>
      </div>
    </div>
  );
}
