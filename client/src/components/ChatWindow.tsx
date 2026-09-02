import { useEffect, useRef, useState } from 'react';
import { Chat, Message } from '../types';
import MessageBubble from './MessageBubble';
import EmojiPicker from './EmojiPicker';
import VoiceRecorder from './VoiceRecorder';
import FileUpload from './FileUpload';
import api from '../utils/api';
import { getSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';

function resolveSocket(){
  const w = (window as any).getSocket?.();
  return w || getSocket();
}

export default function ChatWindow({ chat, messages, setMessages, onBack, onCall }: {
  chat: Chat | null,
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  onBack?: ()=>void,
  onCall: (type:'audio'|'video')=>void
}){
  const [input,setInput] = useState('');
  const [showEmoji,setShowEmoji] = useState(false);
  const [showAttach,setShowAttach] = useState(false);
  const [typingUser,setTypingUser] = useState<string | null>(null);
  const [search,setSearch] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<number | null>(null);
  const { user } = useAuth();

  useEffect(()=>{ endRef.current?.scrollIntoView({ behavior:'smooth' }); },[messages, typingUser]);

  useEffect(()=>{
    const s = resolveSocket();
    if(!s || !chat) return;
    const onTypingStart = (d:any)=>{ if(d.chatId===chat.id) setTypingUser(d.username); };
    const onTypingStop = (d:any)=>{ if(d.chatId===chat.id) setTypingUser(null); };
    s.on('typing:start', onTypingStart);
    s.on('typing:stop', onTypingStop);
    return ()=>{ s.off('typing:start', onTypingStart); s.off('typing:stop', onTypingStop); };
  },[chat]);

  if(!chat) return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0f0f14] text-white/30 p-8">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-3xl mb-4">💬</div>
      <p className="text-lg font-medium text-white">Select a chat to start messaging</p>
      <p className="text-sm mt-1">Real-time, secure, fast.</p>
    </div>
  );

  const name = chat.name || chat.other_user?.username || 'Chat';
  const avatar = chat.avatar_url || chat.other_user?.avatar_url;

  const handleTyping = (val:string)=>{
    setInput(val);
    const s = resolveSocket();
    if(!s) return;
    s.emit('typing:start', { chatId: chat.id });
    if(typingTimeout.current) window.clearTimeout(typingTimeout.current);
    typingTimeout.current = window.setTimeout(()=> s.emit('typing:stop', { chatId: chat.id }), 1500);
  };

  const send = ()=>{
    if(!input.trim()) return;
    const content = input.trim();
    setInput('');
    const s = resolveSocket();
    if(s){
      const isEmojiOnly = content.length<=4 && /\p{Emoji}/u.test(content);
      s.emit('message:send', { chat_id: chat.id, type: isEmojiOnly ? 'emoji':'text', content, tempId: Date.now().toString() });
      s.emit('typing:stop', { chatId: chat.id });
    }
  };

  const handleFile = (url:string, meta:any)=>{
    const s = resolveSocket();
    const isImg = meta.type.startsWith('image/');
    const isVid = meta.type.startsWith('video/');
    const type = isImg ? 'image' : isVid ? 'video' : 'file';
    if(s) s.emit('message:send', { chat_id: chat.id, type, content: meta.name, file_url: url });
  };

  const handleVoice = async (blob: Blob, duration:number)=>{
    const fd = new FormData();
    fd.append('file', blob, `voice-${Date.now()}.webm`);
    try{
      const res = await api.post('/upload', fd, { headers:{ 'Content-Type':'multipart/form-data' }});
      const s = resolveSocket();
      if(s) s.emit('message:send', { chat_id: chat.id, type:'voice', content:'Voice message', file_url: res.data.url, duration });
    } catch(e){ console.error(e); }
  };

  const filteredMessages = search ? messages.filter(m=> m.content?.toLowerCase().includes(search.toLowerCase())) : messages;

  return (
    <div className="flex flex-col h-full bg-[#0f0f14]">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e28] bg-[#15151c] shrink-0">
        {onBack && <button onClick={onBack} className="lg:hidden p-2 -ml-2 text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white font-semibold overflow-hidden shrink-0">
          {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover"/> : name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{name}</p>
          <p className="text-xs text-emerald-400">{typingUser ? `${typingUser} is typing...` : chat.other_user?.status==='online' ? 'online' : 'offline'}</p>
        </div>
        <div className="flex items-center gap-1">
          <input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search" className="hidden md:block w-32 bg-[#1e1e28] border border-white/10 rounded-full px-3 py-1 text-xs text-white placeholder:text-white/30" />
          <button onClick={()=> onCall('audio')} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white" title="Audio call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button onClick={()=> onCall('video')} className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center text-white" title="Video call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 13 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </button>
        </div>
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gradient-to-b from-[#0f0f14] to-[#12121a]">
        {filteredMessages.map(m=> (
          <MessageBubble
            key={m.id}
            msg={m}
            isOwn={m.sender_id===user?.id}
            onReact={(emoji)=>{
              const s=resolveSocket(); if(s) s.emit('message:react', { messageId:m.id, emoji, chatId: chat.id });
            }}
            onEdit={(content)=>{
              const s=resolveSocket(); if(s) s.emit('message:edit', { messageId:m.id, content, chatId: chat.id });
              api.put(`/messages/${m.id}`, { content }).catch(console.error);
            }}
            onDelete={()=>{
              const s=resolveSocket(); if(s) s.emit('message:delete', { messageId:m.id, chatId: chat.id });
              api.delete(`/messages/${m.id}`).catch(console.error);
            }}
          />
        ))}
        {typingUser && <div className="text-xs text-white/40 italic">{typingUser} is typing...</div>}
        <div ref={endRef} />
      </div>

      {/* attach panel */}
      {showAttach && <div className="px-4 py-3 border-t border-[#1e1e28] bg-[#15151c]"><FileUpload onUploaded={handleFile} onClose={()=> setShowAttach(false)} /></div>}

      {/* input */}
      <div className="px-3 py-3 border-t border-[#1e1e28] bg-[#15151c] flex items-end gap-2 shrink-0">
        <button onClick={()=> setShowAttach(!showAttach)} className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white" title="Attach">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>

        <div className="flex-1 relative flex items-center bg-[#1e1e28] border border-white/10 rounded-2xl">
          <button onClick={()=> setShowEmoji(!showEmoji)} className="pl-3 pr-2 text-white/50 hover:text-white" title="Emoji">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
          <input
            value={input}
            onChange={e=> handleTyping(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }}
            placeholder="Type a message..."
            className="flex-1 bg-transparent py-3 pr-3 text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
          {showEmoji && <EmojiPicker onSelect={(e)=> handleTyping(input+e)} onClose={()=> setShowEmoji(false)} />}
        </div>

        <VoiceRecorder onSend={handleVoice} />

        <button onClick={send} className="p-3 rounded-full bg-violet-600 hover:bg-violet-700 text-white transition shrink-0" title="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  );
}
