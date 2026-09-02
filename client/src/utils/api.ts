import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg=>{
  const token = localStorage.getItem('flux_token');
  if(token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export default api;

export const getSocketUrl = () => {
  // vite proxy handles /socket.io, so use same origin
  return window.location.origin;
};
