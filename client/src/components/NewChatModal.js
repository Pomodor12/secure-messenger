import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

export default function NewChatModal({ onClose }) {
  const { token } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [chatName, setChatName] = useState('');
  const [isGroup, setIsGroup] = useState(false);

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
          name: isGroup ? chatName : null,
          isGroup: selectedUsers.length > 1 || isGroup,
          memberIds: selectedUsers.map(u => u.id)
        })
      });
      if (res.ok) onClose();
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-dark-900 rounded-2xl w-full max-w-md border border-dark-800 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-800">
          <h2 className="text-lg font-semibold text-white">New Chat</h2>
          <button onClick={onClose} className="p-1 text-dark-400 hover:text-white rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6">
          {selectedUsers.length > 1 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-dark-300 mb-1">Group Name</label>
              <input type="text" value={chatName} onChange={(e) => setChatName(e.target.value)} className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-xl text-white text-sm placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Enter group name" />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-dark-300 mb-1">Search Users</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-xl text-white text-sm placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Type a username..." autoFocus />
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
              <div key={user.id} onClick={() => toggleUser(user)} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${selectedUsers.find(u => u.id === user.id) ? 'bg-primary-600/20' : 'hover:bg-dark-800'}`}>
                <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-white font-semibold">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-white">{user.username}</h4>
                </div>
                {selectedUsers.find(u => u.id === user.id) && (
                  <svg className="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                )}
              </div>
            ))}
            {searchQuery && users.length === 0 && (
              <p className="text-center text-dark-500 py-4">No users found</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-dark-800">
          <button onClick={createChat} disabled={selectedUsers.length === 0} className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {selectedUsers.length > 1 ? `Create Group (${selectedUsers.length} members)` : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
