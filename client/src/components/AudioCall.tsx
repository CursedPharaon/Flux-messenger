import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../hooks/useSocket';
function resolveSocket(){ const w=(window as any).getSocket?.() || (window as any).__fluxSocket; return w || getSocket(); }

export default function AudioCall({ targetId, chatId, onEnd, incoming, callerName }:{
  targetId:string, chatId?:string, onEnd:()=>void, incoming?:boolean, callerName?:string
}){
  const [status,setStatus] = useState(incoming? 'incoming':'calling');
  const [muted,setMuted]= useState(false);
  const [speaker,setSpeaker]= useState(false);
  const [duration,setDuration]= useState(0);
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const localRef = useRef<MediaStream|null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<number|null>(null);

  const startTimer = ()=>{
    setStatus('connected');
    timerRef.current = window.setInterval(()=> setDuration(d=>d+1), 1000);
  };

  const createPC = ()=>{
    const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    pc.onicecandidate = e=>{
      if(e.candidate) resolveSocket()?.emit('call:ice-candidate', { targetId, candidate: e.candidate });
    };
    pc.ontrack = e=>{
      if(remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
    };
    pcRef.current = pc;
    return pc;
  };

  const startCall = async()=>{
    const pc = createPC();
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    localRef.current = stream;
    stream.getTracks().forEach(t=> pc.addTrack(t, stream));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    resolveSocket()?.emit('call:initiate', { calleeId: targetId, offer, callType:'audio', chatId });
    setStatus('ringing');
  };

  const accept = async (offer:RTCSessionDescriptionInit)=>{
    const pc = createPC();
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    localRef.current = stream;
    stream.getTracks().forEach(t=> pc.addTrack(t, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    // need callerId; we have targetId as caller
    resolveSocket()?.emit('call:answer', { callerId: targetId, answer });
    startTimer();
  };

  useEffect(()=>{
    if(!incoming) startCall();
    const s = resolveSocket();
    if(!s) return;
    const onAnswered = async ({ answer }:any)=>{
      if(pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      startTimer();
    };
    const onIce = async ({ candidate, from }:any)=>{
      if(from===targetId && pcRef.current && candidate) await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    };
    const onDeclined = ()=>{ setStatus('declined'); setTimeout(onEnd,1500); };
    const onEnded = ()=> { cleanup(); onEnd(); };
    s.on('call:answered', onAnswered);
    s.on('call:ice-candidate', onIce);
    s.on('call:declined', onDeclined);
    s.on('call:ended', onEnded);
    // incoming offer handling: if incoming true, we need to have offer stored
    // For incoming, parent passes offer via custom event? We'll handle via incoming prop and socket event already delivered
    // Instead, listen for incoming with offer if this component is reused
    return ()=>{
      s.off('call:answered', onAnswered);
      s.off('call:ice-candidate', onIce);
      s.off('call:declined', onDeclined);
      s.off('call:ended', onEnded);
      cleanup();
    };
    // eslint-disable-next-line
  },[]);

  // Expose accept method for parent to call when incoming offer available
  // We'll attach to window for simplicity; parent can call acceptOffer
  useEffect(()=>{
    (window as any).__fluxAcceptAudio = accept;
    return ()=>{ delete (window as any).__fluxAcceptAudio; };
  },[targetId]);

  const cleanup = ()=>{
    if(timerRef.current) window.clearInterval(timerRef.current);
    pcRef.current?.close();
    localRef.current?.getTracks().forEach(t=>t.stop());
  };

  const hangup = ()=>{
    resolveSocket()?.emit('call:end', { targetId, chatId });
    cleanup();
    onEnd();
  };

  const toggleMute = ()=>{
    localRef.current?.getAudioTracks().forEach(t=> t.enabled = muted);
    setMuted(!muted);
  };

  const fmt = (s:number)=> `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a22] border border-white/10 rounded-3xl p-8 w-full max-w-sm text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4">
          {callerName?.[0] || '?'}
        </div>
        <h3 className="text-white font-semibold text-lg">{callerName || 'Flux User'}</h3>
        <p className="text-white/50 text-sm mt-1 capitalize">{status==='incoming'? 'Incoming audio call...' : status==='ringing'? 'Ringing...' : status==='connected'? fmt(duration) : status}</p>

        <div className="flex items-center justify-center gap-4 mt-8">
          <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center ${muted? 'bg-red-500 text-white':'bg-white/10 text-white'}`} title="Mute">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>{muted && <line x1="1" y1="1" x2="23" y2="23"/>}</svg>
          </button>
          <button onClick={hangup} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
          </button>
          <button onClick={()=> setSpeaker(!speaker)} className={`w-12 h-12 rounded-full flex items-center justify-center ${speaker? 'bg-violet-600 text-white':'bg-white/10 text-white'}`} title="Speaker">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
        </div>

        {status==='incoming' && (
          <div className="flex gap-3 mt-6">
            <button onClick={hangup} className="flex-1 py-3 bg-white/10 rounded-full text-white">Decline</button>
            <button onClick={()=> {
              const offer = (window as any).__fluxIncomingOffer;
              if(offer) (window as any).__fluxAcceptAudio?.(offer);
            }} className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-full text-white font-semibold">Accept</button>
          </div>
        )}

        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>
    </div>
  );
}
