import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

const THEMES = {
  dark: {
    name: 'Тёмная',
    bg950: '#020617',
    bg900: '#0f172a',
    bg800: '#1e293b',
    bg700: '#334155',
    bg600: '#475569',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textDim: '#64748b',
    border: '#1e293b',
    inputBg: '#1e293b',
    inputBorder: '#334155',
    hoverBg: '#1e293b',
    msgOwn: 'bg-primary-600 text-white',
    msgOther: 'bg-dark-800 text-dark-100',
    sidebarBg: 'bg-dark-900',
    bodyBg: 'bg-dark-950',
    cardBg: 'bg-dark-900',
  },
  light: {
    name: 'Светлая',
    bg950: '#f8fafc',
    bg900: '#ffffff',
    bg800: '#f1f5f9',
    bg700: '#e2e8f0',
    bg600: '#cbd5e1',
    text: '#1e293b',
    textMuted: '#475569',
    textDim: '#94a3b8',
    border: '#e2e8f0',
    inputBg: '#f1f5f9',
    inputBorder: '#e2e8f0',
    hoverBg: '#f1f5f9',
    msgOwn: 'bg-primary-600 text-white',
    msgOther: 'bg-white text-gray-800 border border-gray-200',
    sidebarBg: 'bg-white',
    bodyBg: 'bg-gray-50',
    cardBg: 'bg-white',
  },
};

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    localStorage.setItem('theme', themeName);
    const t = THEMES[themeName];
    document.documentElement.style.setProperty('--bg950', t.bg950);
    document.documentElement.style.setProperty('--bg900', t.bg900);
    document.documentElement.style.setProperty('--bg800', t.bg800);
    document.documentElement.style.setProperty('--bg700', t.bg700);
    document.documentElement.style.setProperty('--text-color', t.text);
  }, [themeName]);

  const theme = THEMES[themeName];

  return (
    <ThemeContext.Provider value={{ themeName, theme, setThemeName, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
