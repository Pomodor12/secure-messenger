import React, { useRef } from 'react';
import { compressImage } from '../utils/helpers';
import { saveAvatar } from '../utils/storage';
import { useAuth } from '../context/AuthContext';

export default function AvatarUpload({ currentAvatar, onAvatarChange, size = 'lg' }) {
  const { user, token } = useAuth();
  const fileInputRef = useRef(null);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-20 h-20',
    xl: 'w-28 h-28',
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    try {
      const compressed = await compressImage(file, 400, 0.8);
      await saveAvatar(user.id, compressed);
      await fetch(`${process.env.REACT_APP_API_URL || window.location.origin}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatar: compressed }),
      });
      onAvatarChange(compressed);
    } catch (err) {
      console.error('Avatar upload failed:', err);
    }
  };

  return (
    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden bg-primary-600 flex items-center justify-center`}>
        {currentAvatar ? (
          <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <span className="text-white font-bold text-lg">{user?.username?.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
    </div>
  );
}
