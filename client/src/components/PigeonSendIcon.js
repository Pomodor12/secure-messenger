import React from 'react';

export default function PigeonSendIcon({ size = 20, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* pigeon body */}
      <ellipse cx="11" cy="15" rx="7" ry="5" fill="currentColor" opacity="0.9" />
      {/* head */}
      <circle cx="16" cy="10" r="3.5" fill="currentColor" opacity="0.9" />
      {/* beak */}
      <path d="M19.5 10l2-1-2-1z" fill="currentColor" />
      {/* eye */}
      <circle cx="17" cy="9.5" r="0.7" fill="white" />
      {/* tail */}
      <path d="M4 14l-2-2 1 4z" fill="currentColor" opacity="0.9" />
      {/* wing */}
      <path d="M9 13 Q6 11 9 8" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.5" />
    </svg>
  );
}
