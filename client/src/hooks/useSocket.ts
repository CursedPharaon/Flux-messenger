import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

let socketInstance: Socket | null = null;

export function useSocket(){
  const { token } = useAuth();
  const ref = useRef<Socket | null>(socketInstance);

  useEffect(()=>{
    if(token && !socketInstance){
      socketInstance = io({ auth: { token } });
      ref.current = socketInstance;
    }
    if(!token && socketInstance){
      socketInstance.disconnect();
      socketInstance=null;
      ref.current=null;
    }
    return ()=> {
      // keep singleton
    };
  },[token]);

  return ref.current;
}

export function getSocket(){
  const w = (globalThis as any).getSocket?.() || (typeof window !== 'undefined' ? (window as any).__fluxSocket : null);
  return w || socketInstance;
}
