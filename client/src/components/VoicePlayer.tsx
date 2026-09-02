import { useEffect, useRef, useState } from 'react';

export default function VoicePlayer({ src, duration }: { src:string, duration?:number }){
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing,setPlaying] = useState(false);
  const [current,setCurrent] = useState(0);
  const [dur,setDur] = useState(duration||0);

  useEffect(()=>{
    const a = audioRef.current;
    if(!a) return;
    const onTime = ()=> setCurrent(a.currentTime);
    const onLoaded = ()=> setDur(a.duration||duration||0);
    const onEnded = ()=> setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('ended', onEnded);
    return ()=>{ a.removeEventListener('timeupdate', onTime); a.removeEventListener('loadedmetadata', onLoaded); a.removeEventListener('ended', onEnded); };
  },[duration]);

  const toggle = ()=>{
    if(!audioRef.current) return;
    if(playing){ audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  const progress = dur ? (current/dur)*100 : 0;

  // fake waveform bars
  const bars = Array.from({length:24}, (_,i)=> {
    const h = 8 + Math.sin(i*1.2)*6 + Math.random()*6;
    const active = (i/24)*100 < progress;
    return <div key={i} style={{height: `${h}px`}} className={`w-[3px] rounded-full ${active? 'bg-violet-400':'bg-white/20' }`} />;
  });

  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      <button onClick={toggle} className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center text-white shrink-0">
        {playing ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
      </button>
      <div className="flex items-center gap-[2px] flex-1">{bars}</div>
      <span className="text-xs font-mono text-white/70 w-10 text-right">
        {playing ? `${Math.floor(current/60)}:${String(Math.floor(current%60)).padStart(2,'0')}` : `${Math.floor(dur/60)}:${String(Math.floor(dur%60)).padStart(2,'0')}`}
      </span>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}
