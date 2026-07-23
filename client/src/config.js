const API_URL = process.env.NODE_ENV === 'production'
  ? window.location.origin
  : 'http://localhost:3001';

export { API_URL };
