import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PigeonLogo from '../components/PigeonLogo';

export default function Login({ onSwitch }) {
  const { login } = useAuth();
  const { themeName } = useTheme();
  const isDark = themeName === 'dark';
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(loginInput, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-dark-950' : 'bg-gray-50'}`}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4">
            <PigeonLogo size={80} />
          </div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Голуби</h1>
          <p className={`mt-1 ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>Зашифрованный мессенджер</p>
        </div>

        <form onSubmit={handleSubmit} className={`${isDark ? 'bg-dark-900 border-dark-800' : 'bg-white border-gray-200'} rounded-2xl p-6 shadow-xl border`}>
          <h2 className={`text-xl font-semibold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Вход</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl mb-4 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-dark-300' : 'text-gray-700'}`}>Имя пользователя</label>
              <input
                type="text"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-dark-800 border-dark-700 text-white placeholder-dark-500' : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400'}`}
                placeholder="Введите имя пользователя"
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-dark-300' : 'text-gray-700'}`}>Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-dark-800 border-dark-700 text-white placeholder-dark-500' : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400'}`}
                placeholder="Введите пароль"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>

          <p className={`text-center mt-4 ${isDark ? 'text-dark-400' : 'text-gray-500'}`}>
            Нет аккаунта?{' '}
            <button type="button" onClick={onSwitch} className="text-primary-400 hover:text-primary-300">
              Регистрация
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
