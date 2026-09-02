import { useState, useRef } from 'react';

export default function VoiceRecorder({ onSend }: { onSend:(blob:Blob, duration:number)=>void }){
  const [recording,setRecording] = useState(false);
  const [duration,setDuration] = useState(0);
  const mediaRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number|null>(null);
  const startTimeRef = useRef<number>(0);

  const start = async()=>{
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current=[];
      mr.ondataavailable = e=> chunksRef.current.push(e.data);
      mr.onstop = ()=>{
        const blob = new Blob(chunksRef.current, { type:'audio/webm' });
        const dur = Math.round((Date.now()-startTimeRef.current)/1000);
        onSend(blob, dur);
        stream.getTracks().forEach(t=>t.stop());
        setDuration(0);
        if(timerRef.current) window.clearInterval(timerRef.current);
      };
      mr.start();
      startTimeRef.current = Date.now();
      setRecording(true);
      timerRef.current = window.setInterval(()=> setDuration(Math.round((Date.now()-startTimeRef.current)/1000)), 1000);
    } catch(e){ alert('Mic permission denied'); }
  };

  const stop = ()=>{
    mediaRef.current?.stop();
    setRecording(false);
    if(timerRef.current) window.clearInterval(timerRef.current);
  };
  const cancel = ()=>{
    mediaRef.current?.stop();
    // prevent send by clearing chunks? we still have onstop; need to override
    if(mediaRef.current) mediaRef.current.onstop = ()=>{
      (mediaRef.current?.stream as any)?.getTracks?.().forEach((t:MediaStreamTrack)=>t.stop());
    };
    // hack: just reset
    setRecording(false);
    setDuration(0);
    if(timerRef.current) window.clearInterval(timerRef.current);
    // stop tracks
    try{ (mediaRef.current as any)?.stream?.getTracks()?.forEach((t:MediaStreamTrack)=>t.stop()); }catch{}
  };

  if(!recording){
    return (
      <button onClick={start} className="p-2.5 rounded-full bg-[#2a2a35] hover:bg-[#3a3a45] text-white transition" title="Record voice">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 rounded-full px-3 py-1.5">
      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
      <span className="text-sm font-mono text-red-400">{Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}</span>
      <button onClick={cancel} className="ml-2 text-xs px-2 py-1 bg-white/10 rounded-full hover:bg-white/20">Cancel</button>
      <button onClick={stop} className="text-xs px-3 py-1 bg-red-500 text-white rounded-full hover:bg-red-600">Send</button>
    </div>
  );
}
