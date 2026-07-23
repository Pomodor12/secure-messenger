import React from 'react';

export default function PigeonLogo({ size = 64, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="32" cy="32" r="30" fill="#22c55e" />
      {/* body */}
      <ellipse cx="26" cy="38" rx="14" ry="9" fill="white" />
      {/* head */}
      <circle cx="38" cy="26" r="7" fill="white" />
      {/* beak */}
      <path d="M45 26l5-2-5-2z" fill="#fbbf24" />
      {/* eye */}
      <circle cx="40" cy="25" r="1.5" fill="#166534" />
      {/* tail */}
      <path d="M12 36l-6-4 2 8z" fill="white" />
      {/* wing line */}
      <path d="M18 34 Q14 30 18 26" stroke="#dcfce7" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
