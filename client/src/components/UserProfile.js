import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { AvatarStorage } from '../utils/storage';
import { compressImage } from '../utils/validation';

export default function UserProfile({ userId, onClose, isCurrentUser = false, onUpdateProfile, token }) {
  const [user, setUser] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    loadUser();
  }, [userId]);

  const loadUser = async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userData = await response.json();
      setUser(userData);
      setStatus(userData.status || '');

      const storedAvatar = await AvatarStorage.get(userId);
      if (storedAvatar) {
        setAvatar(storedAvatar.data);
      }
      setLoading(false);
    } catch (err) {
      console.error('Error loading user:', err);
      setError('Failed to load user profile');
      setLoading(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError('');
      
      const compressed = await compressImage(file, 256, 256, 0.8);
      const reader = new FileReader();

      reader.onload = async (event) => {
        const base64 = event.target.result;
        setAvatar(base64);
        await AvatarStorage.save(userId, base64);
        setUploading(false);
      };

      reader.readAsDataURL(compressed);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!isCurrentUser) return;

    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        setUser({ ...user, status });
        setEditing(false);
        setError('');
        onUpdateProfile?.({ status });
      }
    } catch (err) {
      setError('Failed to update status');
      console.error('Error updating status:', err);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-dark-900 rounded-2xl p-8 max-w-md w-full">
          <div className="flex justify-center">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-dark-900 rounded-2xl p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
          <p className="text-red-400">User not found</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-dark-900 rounded-2xl max-w-md w-full border border-dark-800 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-800">
          <h2 className="text-lg font-semibold text-white">Profile</h2>
          <button onClick={onClose} className="text-dark-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div className="p-6">
          <div className="flex flex-col items-center mb-6">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center overflow-hidden border-4 border-dark-800">
                {avatar ? (
                  <img src={avatar} alt={user.username} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-white">{user.username?.charAt(0).toUpperCase()}</span>
                )}
              </div>
              {isCurrentUser && (
                <label className="absolute bottom-0 right-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center cursor-pointer hover:bg-primary-700 transition-colors border-2 border-dark-900">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" disabled={uploading} />
                </label>
              )}
            </div>
            {uploading && <p className="text-xs text-primary-400">Uploading...</p>}
          </div>

          <div className="mb-4">
            <h3 className="text-xl font-semibold text-white text-center">{user.username}</h3>
            <p className="text-sm text-dark-400 text-center">{user.email}</p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-dark-300 mb-2">Status</label>
            {editing && isCurrentUser ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  maxLength={100}
                  className="flex-1 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Enter your status..."
                />
                <button
                  onClick={handleStatusUpdate}
                  className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="p-3 bg-dark-800/50 rounded-lg">
                <p className="text-sm text-dark-200">{user.status || 'No status set'}</p>
              </div>
            )}
          </div>

          {isCurrentUser && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="w-full py-2 text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
            >
              Edit Status
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 mt-6 pt-6 border-t border-dark-800">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary-400">ID</p>
              <p className="text-xs text-dark-400 truncate">{user.id}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-dark-400">Member since</p>
              <p className="text-sm font-medium text-white">
                {new Date(user.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-dark-800">
          <button
            onClick={onClose}
            className="w-full py-2 text-dark-300 hover:text-white text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}