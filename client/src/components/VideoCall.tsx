import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../hooks/useSocket';
function resolveSocket(){ const w=(window as any).getSocket?.() || (window as any).__fluxSocket; return w || getSocket(); }

export default function VideoCall({ targetId, chatId, onEnd, incoming, callerName }:{
  targetId:string, chatId?:string, onEnd:()=>void, incoming?:boolean, callerName?:string
}){
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const localStreamRef = useRef<MediaStream|null>(null);
  const [status,setStatus] = useState(incoming? 'incoming':'calling');
  const [muted,setMuted]=useState(false);
  const [camOff,setCamOff]=useState(false);
  const [duration,setDuration]=useState(0);
  const [pip,setPip]=useState(false);
  const timerRef = useRef<number|null>(null);

  const fmt = (s:number)=> `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  const createPC = ()=>{
    const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    pc.onicecandidate = e=>{ if(e.candidate) resolveSocket()?.emit('call:ice-candidate', { targetId, candidate:e.candidate }); };
    pc.ontrack = e=>{ if(remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pcRef.current = pc; return pc;
  };

  const startCall = async()=>{
    const pc = createPC();
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user' }, audio:true });
    localStreamRef.current=stream;
    if(localVideoRef.current) localVideoRef.current.srcObject=stream;
    stream.getTracks().forEach(t=> pc.addTrack(t, stream));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    resolveSocket()?.emit('call:initiate', { calleeId: targetId, offer, callType:'video', chatId });
    setStatus('ringing');
  };

  const accept = async(offer:RTCSessionDescriptionInit)=>{
    const pc = createPC();
    const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    localStreamRef.current=stream;
    if(localVideoRef.current) localVideoRef.current.srcObject=stream;
    stream.getTracks().forEach(t=> pc.addTrack(t, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    resolveSocket()?.emit('call:answer', { callerId: targetId, answer });
    setStatus('connected');
    timerRef.current = window.setInterval(()=> setDuration(d=>d+1),1000);
  };

  useEffect(()=>{
    if(!incoming) startCall();
    const s=resolveSocket(); if(!s) return;
    const onAnswered = async({answer}:any)=>{
      if(pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus('connected'); timerRef.current = window.setInterval(()=> setDuration(d=>d+1),1000);
    };
    const onIce = async({candidate,from}:any)=>{
      if(from===targetId && pcRef.current && candidate) await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    };
    const onEnded = ()=> { cleanup(); onEnd(); };
    const onDeclined = ()=>{ setStatus('declined'); setTimeout(onEnd,1000); };
    s.on('call:answered', onAnswered);
    s.on('call:ice-candidate', onIce);
    s.on('call:ended', onEnded);
    s.on('call:declined', onDeclined);
    return ()=>{ s.off('call:answered', onAnswered); s.off('call:ice-candidate', onIce); s.off('call:ended', onEnded); s.off('call:declined', onDeclined); cleanup(); };
  },[]);

  useEffect(()=>{
    (window as any).__fluxAcceptVideo = accept;
    return ()=>{ delete (window as any).__fluxAcceptVideo; };
  },[targetId]);

  const cleanup = ()=>{
    if(timerRef.current) window.clearInterval(timerRef.current);
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t=> t.stop());
  };

  const hangup = ()=>{
    resolveSocket()?.emit('call:end', { targetId, chatId });
    cleanup(); onEnd();
  };

  const toggleCam = ()=>{
    const vTrack = localStreamRef.current?.getVideoTracks()[0];
    if(vTrack) { vTrack.enabled = camOff; setCamOff(!camOff); }
  };
  const toggleMic = ()=>{
    const aTrack = localStreamRef.current?.getAudioTracks()[0];
    if(aTrack) { aTrack.enabled = muted; setMuted(!muted); }
  };
  const switchCamera = async()=>{
    try{
      const newStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: pip? 'user':'environment' }, audio:true });
      const sender = pcRef.current?.getSenders().find(s=> s.track?.kind==='video');
      const newTrack = newStream.getVideoTracks()[0];
      if(sender) await sender.replaceTrack(newTrack);
      localStreamRef.current?.getVideoTracks().forEach(t=> t.stop());
      localStreamRef.current = newStream;
      if(localVideoRef.current) localVideoRef.current.srcObject = newStream;
      setPip(!pip);
    } catch(e){ console.error(e); }
  };
  const shareScreen = async()=>{
    try{
      const screen = await navigator.mediaDevices.getDisplayMedia({ video:true });
      const track = screen.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s=> s.track?.kind==='video');
      if(sender) await sender.replaceTrack(track);
      if(localVideoRef.current) localVideoRef.current.srcObject = screen;
      track.onended = async()=>{
        // revert to camera
        const cam = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
        const camTrack = cam.getVideoTracks()[0];
        if(sender) await sender.replaceTrack(camTrack);
        if(localVideoRef.current) localVideoRef.current.srcObject = cam;
        localStreamRef.current = cam;
      };
    } catch(e){ console.error(e); }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex-1 relative bg-[#070708]">
        <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        {!remoteVideoRef.current?.srcObject && <div className="absolute inset-0 flex items-center justify-center text-white/40">Waiting for peer...</div>}
        <video ref={localVideoRef} autoPlay playsInline muted className={`absolute ${pip? 'inset-0 w-full h-full':'bottom-20 right-4 w-32 h-44 md:w-48 md:h-64'} object-cover rounded-2xl border-2 border-white/20 shadow-xl bg-black`} onClick={()=> setPip(!pip)} />

        <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
          <div>
            <p className="text-white font-semibold">{callerName || 'Flux User'}</p>
            <p className="text-white/60 text-xs">{status==='incoming'? 'Incoming video call' : status==='ringing'? 'Ringing...' : status==='connected'? fmt(duration): status}</p>
          </div>
          <button onClick={hangup} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white">✕</button>
        </div>
      </div>

      <div className="bg-[#1a1a22] border-t border-white/10 p-4 flex items-center justify-center gap-3">
        <button onClick={toggleMic} className={`w-12 h-12 rounded-full flex items-center justify-center ${muted? 'bg-red-500 text-white':'bg-white/10 text-white'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/></svg>
        </button>
        <button onClick={toggleCam} className={`w-12 h-12 rounded-full flex items-center justify-center ${camOff? 'bg-red-500 text-white':'bg-white/10 text-white'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        </button>
        <button onClick={hangup} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/></svg>
        </button>
        <button onClick={switchCamera} className="w-12 h-12 rounded-full bg-white/10 text-white flex items-center justify-center" title="Switch camera">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
        <button onClick={shareScreen} className="w-12 h-12 rounded-full bg-white/10 text-white flex items-center justify-center" title="Share screen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
      </div>

      {status==='incoming' && (
        <div className="absolute bottom-24 inset-x-4 flex gap-3">
          <button onClick={hangup} className="flex-1 py-3 bg-red-500 rounded-full text-white font-semibold">Decline</button>
          <button onClick={()=> {
            const offer = (window as any).__fluxIncomingOffer;
            if(offer) (window as any).__fluxAcceptVideo?.(offer);
          }} className="flex-1 py-3 bg-emerald-500 rounded-full text-white font-semibold">Accept</button>
        </div>
      )}
    </div>
  );
}
