import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../utils/api';
import { User } from '../types';

interface AuthCtx {
  user: User | null;
  token: string | null;
  login: (email:string,password:string)=>Promise<void>;
  register: (username:string,email:string,password:string)=>Promise<void>;
  logout: ()=>void;
  loading: boolean;
}

const Ctx = createContext<AuthCtx>(null as any);

export const AuthProvider: React.FC<{children:React.ReactNode}> = ({children})=>{
  const [user,setUser] = useState<User|null>(null);
  const [token,setToken] = useState<string | null>(localStorage.getItem('flux_token'));
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    if(token){
      api.get('/auth/me').then(res=> setUser(res.data)).catch(()=>{ localStorage.removeItem('flux_token'); setToken(null); }).finally(()=> setLoading(false));
    } else setLoading(false);
  },[]);

  const login = async(email:string,password:string)=>{
    const res = await api.post('/auth/login',{email,password});
    localStorage.setItem('flux_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  };
  const register = async(username:string,email:string,password:string)=>{
    const res = await api.post('/auth/register',{username,email,password});
    localStorage.setItem('flux_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  };
  const logout = async()=>{
    try{ await api.post('/auth/logout');}catch{}
    localStorage.removeItem('flux_token');
    setToken(null); setUser(null);
  };

  return <Ctx.Provider value={{user,token,login,register,logout,loading}}>{children}</Ctx.Provider>;
};

export const useAuth = ()=> useContext(Ctx);
