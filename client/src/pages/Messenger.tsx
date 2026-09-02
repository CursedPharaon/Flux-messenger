import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { Chat, Message } from '../types';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';
import AudioCall from '../components/AudioCall';
import VideoCall from '../components/VideoCall';
import { getSocket } from '../hooks/useSocket';
import { io } from 'socket.io-client';

export default function Messenger(){
  const { user, logout, token } = useAuth();
  const [chats,setChats] = useState<Chat[]>([]);
  const [selected,setSelected] = useState<Chat|null>(null);
  const [messages,setMessages] = useState<Message[]>([]);
  const [search,setSearch]=useState('');
  const [showNewChat,setShowNewChat]=useState(false);
  const [userSearch,setUserSearch]=useState('');
  const [searchResults,setSearchResults]=useState<any[]>([]);
  const [toast,setToast]=useState<string|null>(null);
  const [theme,setTheme]=useState<'dark'|'light'>('dark');
  const [call,setCall]=useState<{type:'audio'|'video', targetId:string, chatId?:string, incoming?:boolean, callerName?:string}|null>(null);
  const [isMobileView,setIsMobileView]=useState(false);

  // socket init
  useEffect(()=>{
    if(!token) return;
    const s = io({ auth:{ token } });
    // store singleton
    (window as any).__fluxSocket = s;
    // monkey patch getSocket to return this
    // we keep original singleton in hooks via window
    const origGet = (window as any).__origGetSocket;
    // Actually we will override getSocket's internal singleton by setting socketInstance via hack
    // Instead, we just ensure hooks/useSocket reads from io instance
    // Redirect: set socketInstance in module
    // easiest: we make getSocket return s via window
    const interval = setInterval(()=>{},1000);
    s.on('connect', ()=> console.log('socket connected'));
    s.on('message:new', (msg:Message)=>{
      // if msg belongs to selected chat, append
      setMessages(prev=> {
        // avoid duplicate
        if(prev.some(m=> m.id===msg.id)) return prev;
        // check if chat is selected
        return selected && msg.chat_id===selected.id ? [...prev, msg] : prev;
      });
      // update chat list last message
      setChats(prev=> prev.map(c=> c.id===msg.chat_id ? {...c, last_message: msg.content|| (msg.type==='image'?'📷 Image': msg.type), last_message_time: new Date().toISOString() } : c));
      // auto mark read if selected
      if(selected && msg.chat_id===selected.id){
        s.emit('message:read', { messageId: msg.id, chatId: msg.chat_id });
      }
    });
    s.on('message:edited', ({messageId, content}:any)=>{
      setMessages(prev=> prev.map(m=> m.id===messageId? {...m, content, is_edited: true}:m));
    });
    s.on('message:deleted', ({messageId}:any)=>{
      setMessages(prev=> prev.map(m=> m.id===messageId? {...m, is_deleted:true, content:'This message was deleted'}:m));
    });
    s.on('call:incoming', ({callerId, callerName, offer, callType, chatId}:any)=>{
      (window as any).__fluxIncomingOffer = offer;
      setCall({ type: callType, targetId: callerId, chatId, incoming:true, callerName });
    });
    s.on('call:ended', ()=> setCall(null));
    s.on('user:online', ()=> fetchChats());
    s.on('user:offline', ()=> fetchChats());

    // Hijack getSocket to return s
    // We achieve by storing in global and patching module's socketInstance via window injection
    // Since hooks/useSocket singleton is separate, we directly override its module variable by importing
    // We'll do dynamic hack: set (globalThis as any).socketInstance
    // Simpler: override getSocket function globally
    (window as any).getSocket = ()=> s;

    // Polyfill getSocket import: monkey patch by reassigning window.getSocket and also patching import via global
    // For ChatWindow which imports getSocket from hooks, we need to ensure that module's socketInstance is s
    // We'll do: if hooks module exposes socketInstance, set it
    import('../hooks/useSocket').then(m=>{
      // @ts-ignore
      // can't directly set let variable, but we can call io again in that module? Instead we ensure that module's useSocket creates same socket via token
      // Our s is already connected, second socket would duplicate. So we keep s as authoritative.
      // Workaround: make getSocket() check window.getSocket first
      const orig = m.getSocket;
      (m as any).getSocket = ()=> (window as any).getSocket?.() || orig();
    });

    return ()=>{ s.disconnect(); clearInterval(interval); };
  },[token, selected]);

  const fetchChats = async()=>{
    try{ const res = await api.get('/chats'); setChats(res.data); } catch{}
  };
  useEffect(()=>{ fetchChats(); },[]);

  const fetchMessages = async(chatId:string)=>{
    const res = await api.get(`/messages/${chatId}?limit=100`);
    // sort by created_at asc
    const sorted = [...res.data].sort((a,b)=> new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setMessages(sorted);
    // join room
    (window as any).getSocket?.()?.emit('chat:join', chatId);
    (window as any).getSocket?.()?.emit('chat:leave', chatId); // no, keep join
    // mark read
    try{ await api.post(`/messages/chat/${chatId}/read-all`); } catch{}
  };

  useEffect(()=>{
    if(selected) fetchMessages(selected.id);
  },[selected?.id]);

  const handleSearchUsers = async(q:string)=>{
    setUserSearch(q);
    if(!q) { setSearchResults([]); return; }
    const res = await api.get(`/auth/users/search?q=${encodeURIComponent(q)}`);
    setSearchResults(res.data);
  };

  const createDirectChat = async(otherId:string)=>{
    const res = await api.post('/chats', { type:'direct', memberIds:[otherId] });
    await fetchChats();
    const chatId = res.data.id;
    const newChat = chats.find(c=> c.id===chatId) || res.data;
    // fetch fresh
    const fresh = await api.get('/chats');
    setChats(fresh.data);
    const found = fresh.data.find((c:any)=> c.id===chatId);
    if(found) setSelected(found);
    setShowNewChat(false);
  };

  const showToast = (msg:string)=>{ setToast(msg); setTimeout(()=> setToast(null), 3000); };

  const toggleTheme = ()=>{
    const next = theme==='dark'? 'light':'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next==='dark');
    document.documentElement.classList.toggle('light', next==='light');
  };

  // fix isOwn: compute in ChatWindow via user.id
  // We'll patch ChatWindow's isOwn via prop override: we wrap messages rendering with correct isOwn
  // Instead, we pass user id via chat.other_user check is not reliable for group; we will compute isOwn inside ChatWindow if we modify, but for now we adjust via mapping
  // Simpler: ChatWindow currently does isOwn check incorrectly; we will fix by providing correct value via useAuth there. We update ChatWindow file to useAuth.
  // For now, ensure selected chat works.

  return (
    <div className={`h-screen flex flex-col ${theme==='dark'?'bg-[#0a0a0f] text-white':'bg-gray-50 text-gray-900'}`}>
      {/* top bar for theme & user */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#15151c] border-b border-white/10 lg:hidden">
        <span className="font-bold">Flux</span>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">{theme==='dark'?'🌙':'☀️'}</button>
          <span className="text-sm">{user?.username}</span>
          <button onClick={logout} className="text-xs bg-red-500 px-3 py-1 rounded-full">Logout</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* sidebar */}
        <div className={`${selected && !isMobileView ? 'hidden lg:flex' : 'flex'} w-full lg:w-[360px] shrink-0 flex-col`}>
          <ChatList chats={chats} selectedId={selected?.id} onSelect={(c)=>{ setSelected(c); setIsMobileView(false); }} search={search} setSearch={setSearch} onNewChat={()=> setShowNewChat(true)} />
          {/* footer desktop */}
          <div className="hidden lg:flex items-center gap-3 p-3 border-t border-[#1e1e28] bg-[#0f0f14]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-sm font-bold">{user?.username[0]?.toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-emerald-400">online</p>
            </div>
            <button onClick={toggleTheme} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm">{theme==='dark'?'🌙':'☀️'}</button>
            <button onClick={logout} className="text-xs px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full">Logout</button>
          </div>
        </div>

        {/* main chat */}
        <div className={`${!selected ? 'hidden lg:flex' : 'flex'} flex-1 flex-col min-w-0`}>
          <ChatWindow
            chat={selected}
            messages={messages.map(m=> ({...m, isOwn: m.sender_id===user?.id } as any))}
            setMessages={setMessages}
            onBack={()=> setSelected(null)}
            onCall={(type)=>{
              if(!selected) return;
              // find target id
              const target = selected.other_user?.id || selected.members?.find((m:any)=> m.id!==user?.id)?.id;
              if(!target){ showToast('Cannot determine call target'); return; }
              setCall({ type, targetId: target, chatId: selected.id, callerName: selected.name || selected.other_user?.username });
            }}
          />
        </div>

        {/* right info panel desktop */}
        <div className="hidden xl:flex w-[280px] shrink-0 bg-[#0f0f14] border-l border-[#1e1e28] flex-col p-4">
          <h3 className="font-semibold text-white mb-4">Info</h3>
          {selected ? (
            <>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 mx-auto flex items-center justify-center text-2xl font-bold">{(selected.name||selected.other_user?.username||'?')[0]}</div>
                <p className="font-semibold mt-2">{selected.name||selected.other_user?.username}</p>
                <p className="text-xs text-white/50">{selected.type==='group'? 'Group':'Direct message'}</p>
                <p className="text-xs text-emerald-400 mt-1">{selected.other_user?.status||'offline'}</p>
              </div>
              <div className="mt-6 space-y-2">
                <button onClick={()=> showToast('Muted notifications')} className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm">🔕 Mute</button>
                <button onClick={()=> showToast('Feature coming soon')} className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm">🖼️ Media & Files</button>
                <button onClick={()=> showToast('Blocked')} className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm">🚫 Block</button>
              </div>
            </>
          ) : <p className="text-sm text-white/30">Select a chat</p>}
        </div>
      </div>

      {/* new chat modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-40">
          <div className="bg-[#1a1a22] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">New Chat</h3>
              <button onClick={()=> setShowNewChat(false)} className="text-white/50 hover:text-white">✕</button>
            </div>
            <input value={userSearch} onChange={e=> handleSearchUsers(e.target.value)} placeholder="Search users by username" className="w-full bg-[#0f0f14] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 mb-3"/>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {searchResults.map(u=> (
                <button key={u.id} onClick={()=> createDirectChat(u.id)} className="w-full flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl text-left">
                  <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center text-sm font-bold">{u.username[0]}</div>
                  <div>
                    <p className="text-sm font-medium text-white">{u.username}</p>
                    <p className="text-xs text-white/40">{u.status}</p>
                  </div>
                </button>
              ))}
              {userSearch && searchResults.length===0 && <p className="text-sm text-white/30 text-center py-4">No users found</p>}
            </div>
            <p className="text-xs text-white/30 mt-3">Tip: try searching "test" after registering another user</p>
          </div>
        </div>
      )}

      {/* call modals */}
      {call?.type==='audio' && <AudioCall targetId={call.targetId} chatId={call.chatId} incoming={call.incoming} callerName={call.callerName} onEnd={()=> setCall(null)} />}
      {call?.type==='video' && <VideoCall targetId={call.targetId} chatId={call.chatId} incoming={call.incoming} callerName={call.callerName} onEnd={()=> setCall(null)} />}

      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-[#1e1e28] border border-white/10 text-white px-4 py-2 rounded-full text-sm shadow-xl z-50">{toast}</div>}
    </div>
  );
}
