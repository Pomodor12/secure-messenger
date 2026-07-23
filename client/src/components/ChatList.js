import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { API_URL } from '../config';
import ChatView from './ChatView';
import NewChatModal from './NewChatModal';
import UserProfile from './UserProfile';

export default function ChatList() {
  const { user, token, logout } = useAuth();
  const { socket, onlineUsers } = useSocket();
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [status, setStatus] = useState(user?.status || '');

  useEffect(() => { 
    fetchChats(); 
  }, []);

  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setChats(data);
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  };

  const updateStatus = async () => {
    try {
      await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      setShowProfile(false);
    } catch (error) {
      console.error('Error updating status:', error);
    }
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
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  return (
    <div className="flex h-screen bg-dark-950">
      <div className={`${selectedChat ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-96 bg-dark-900 border-r border-dark-800`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold cursor-pointer hover:opacity-80" onClick={() => setShowProfile(true)}>
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-dark-900"></div>
            </div>
            <div>
              <h2 className="font-semibold text-white">{user?.username}</h2>
              <p className="text-xs text-dark-400 truncate max-w-[200px]">{user?.status}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNewChat(true)} className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors" title="New Chat">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            <button onClick={logout} className="p-2 text-dark-400 hover:text-red-400 hover:bg-dark-800 rounded-lg transition-colors" title="Logout">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>

        {/* Status editor */}
        {showProfile && (
          <div className="p-4 border-b border-dark-800 bg-dark-800/50">
            <label className="block text-sm font-medium text-dark-300 mb-1">Status</label>
            <div className="flex gap-2">
              <input type="text" value={status} onChange={(e) => setStatus(e.target.value)} className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Your status..." />
              <button onClick={updateStatus} className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors">Save</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-dark-800 border border-dark-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Search chats..." />
          </div>
        </div>

        {/* Chats list */}
        <div className="flex-1 overflow-y-auto">
          {filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-dark-400">
              <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <p className="text-sm">No chats found</p>
              <p className="text-xs mt-1">Start a new conversation</p>
            </div>
          ) : (
            filteredChats.map(chat => (
              <div key={chat.id} onClick={() => setSelectedChat(chat)} className={`chat-item flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${selectedChat?.id === chat.id ? 'bg-dark-800/80' : 'hover:bg-dark-800/50'}`}>
                <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {chat.is_group ? (chat.name?.charAt(0).toUpperCase() || 'G') : (chat.members?.split(',')[0]?.charAt(0).toUpperCase() || '?')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-white truncate">{chat.is_group ? chat.name : chat.members}</h3>
                    <span className="text-xs text-dark-500 flex-shrink-0 ml-2">{formatTime(chat.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-dark-400 truncate">{chat.last_message || 'No messages yet'}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat view */}
      {selectedChat ? (
        <div className="flex-1">
          <ChatView chat={selectedChat} onBack={() => setSelectedChat(null)} />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-dark-950">
          <div className="text-center text-dark-500">
            <svg className="w-24 h-24 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h2 className="text-xl font-semibold">Secure Messenger</h2>
            <p className="mt-2 text-sm">Select a chat or start a new conversation</p>
          </div>
        </div>
      )}

      {/* Modals */}
      {showNewChat && <NewChatModal onClose={() => { setShowNewChat(false); fetchChats(); }} />}
      {showProfile && selectedChat === null && (
        <UserProfile
          userId={user.id}
          onClose={() => setShowProfile(false)}
          isCurrentUser={true}
          token={token}
          onUpdateProfile={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}