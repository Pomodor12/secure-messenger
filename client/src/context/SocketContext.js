import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { API_URL } from '../config';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    if (token) {
      const newSocket = io(API_URL, {
        auth: { token }
      });

      newSocket.on('connect', () => console.log('Connected to server'));
      newSocket.on('disconnect', () => console.log('Disconnected from server'));

      newSocket.on('user_online', ({ userId, online }) => {
        setOnlineUsers(prev => {
          const next = new Set(prev);
          if (online) next.add(userId);
          else next.delete(userId);
          return next;
        });
      });

      newSocket.on('user_typing', ({ userId, username, chatId }) => {
        setTypingUsers(prev => ({
          ...prev,
          [chatId]: { userId, username, timestamp: Date.now() }
        }));
      });

      newSocket.on('user_stop_typing', ({ chatId }) => {
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
      });

      socketRef.current = newSocket;
      setSocket(newSocket);

      return () => {
        newSocket.close();
        socketRef.current = null;
      };
    }
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, onlineUsers, typingUsers }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
