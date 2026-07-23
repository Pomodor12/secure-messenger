import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import { MessageStorage, AvatarStorage } from '../utils/storage';
import { validateFile, formatFileSize, compressImage } from '../utils/validation';
import UserProfile from './UserProfile';

export default function ChatView({ chat, onBack }) {
  const { user, token } = useAuth();
  const { socket, onlineUsers, typingUsers } = useSocket();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [avatars, setAvatars] = useState({});
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (chat) {
      loadMessages();
      loadAvatars();
    }
  }, [chat]);

  useEffect(() => {
    if (socket && chat) {
      socket.emit('join_chat', chat.id);

      const handleMessage = (message) => {
        if (message.chat_id === chat.id) {
          setMessages(prev => [...prev, message]);
          MessageStorage.save(message);
        }
      };
      socket.on('new_message', handleMessage);

      return () => {
        socket.off('new_message', handleMessage);
        socket.emit('leave_chat', chat.id);
      };
    }
  }, [socket, chat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chats/${chat.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setMessages(data);
      data.forEach(msg => MessageStorage.save(msg));
      setLoading(false);
    } catch (error) {
      console.error('Error loading messages:', error);
      setLoading(false);
    }
  };

  const loadAvatars = async () => {
    const avatarMap = {};
    if (chat.members) {
      const members = chat.members.split(',').map(m => m.trim());
      for (const member of members) {
        try {
          const stored = await AvatarStorage.get(member);
          if (stored) {
            avatarMap[member] = stored.data;
          }
        } catch (error) {
          console.log(`Could not load avatar for ${member}`);
        }
      }
    }
    setAvatars(avatarMap);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    socket.emit('send_message', {
      chatId: chat.id,
      content: newMessage,
      messageType: 'text'
    });
    setNewMessage('');
    socket.emit('stop_typing', { chatId: chat.id });
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      validateFile(file);
      
      let fileToSend = file;
      if (file.type.startsWith('image/')) {
        fileToSend = await compressImage(file);
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        socket.emit('send_message', {
          chatId: chat.id,
          content: base64,
          messageType: file.type.startsWith('image/') ? 'image' : 'file',
          fileName: file.name,
          fileSize: file.size
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(fileToSend);
    } catch (error) {
      alert(error.message);
    }
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

  const getChatName = () => {
    if (chat.name) return chat.name;
    return chat.members || 'Unknown';
  };

  const getChatAvatar = () => {
    const name = getChatName();
    return name.charAt(0).toUpperCase();
  };

  const typingUser = typingUsers[chat.id];
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '✨'];

  return (
    <div className="flex flex-col h-full bg-dark-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-dark-900 border-b border-dark-800">
        <button onClick={onBack} className="lg:hidden text-dark-400 hover:text-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold cursor-pointer hover:opacity-80" onClick={() => setSelectedProfile(chat.id)}>
          {getChatAvatar()}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">{getChatName()}</h3>
          <p className="text-xs text-dark-400">
            {typingUser ? `${typingUser.username} is typing...` : (chat.is_group ? 'Group chat' : 'Direct message')}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>No messages yet</p>
            <p className="text-sm">Send the first message to start the conversation</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.user_id === user.id;
            const showAvatar = index === 0 || messages[index - 1]?.user_id !== msg.user_id;
            const userAvatar = avatars[msg.username];

            return (
              <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${showAvatar ? 'mt-4' : 'mt-1'}`}>
                {!isOwn && (
                  <div 
                    className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-xs font-semibold text-white mr-2 flex-shrink-0 cursor-pointer hover:opacity-80 overflow-hidden"
                    onClick={() => setSelectedProfile(msg.user_id)}
                  >
                    {showAvatar ? (
                      userAvatar ? (
                        <img src={userAvatar} alt={msg.username} className="w-full h-full object-cover" />
                      ) : (
                        msg.username?.charAt(0).toUpperCase()
                      )
                    ) : ''}
                  </div>
                )}
                <div className={`max-w-xs lg:max-w-md ${isOwn ? 'order-1' : ''}`}>
                  {!isOwn && showAvatar && (
                    <p className="text-xs text-dark-400 mb-1 ml-1">{msg.username}</p>
                  )}
                  <div className={`px-4 py-2 rounded-2xl ${isOwn ? 'bg-primary-600 text-white rounded-br-md' : 'bg-dark-800 text-dark-100 rounded-bl-md'}`}>
                    {msg.message_type === 'image' ? (
                      <img src={msg.content} alt="image" className="max-w-full rounded-lg max-h-64" />
                    ) : msg.message_type === 'file' ? (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M8 16.5a2.5 2.5 0 11 0 5 2.5 2.5 0 010-5z" />
                        </svg>
                        <span className="text-sm">{msg.fileName}</span>
                      </div>
                    ) : (
                      <p className="break-words">{msg.content}</p>
                    )}
                  </div>
                  <p className={`text-xs text-dark-500 mt-1 ${isOwn ? 'text-right mr-1' : 'ml-1'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-4 bg-dark-900 border-t border-dark-800">
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors"
            title="Attach file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => { setNewMessage(e.target.value); handleTyping(); }}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 bg-dark-800 border border-dark-700 rounded-xl text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors"
            title="Emoji"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="p-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        {showEmojiPicker && (
          <div className="mt-2 flex gap-2 flex-wrap">
            {emojis.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setNewMessage(newMessage + emoji);
                  setShowEmojiPicker(false);
                }}
                className="text-2xl hover:scale-125 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfile
          userId={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          isCurrentUser={selectedProfile === user.id}
          token={token}
          onUpdateProfile={() => {}}
        />
      )}
    </div>
  );
}