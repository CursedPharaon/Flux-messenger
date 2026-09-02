import { Chat } from '../types';

export default function ChatList({ chats, selectedId, onSelect, search, setSearch, onNewChat }: {
  chats: Chat[], selectedId?: string, onSelect:(c:Chat)=>void, search:string, setSearch:(s:string)=>void, onNewChat:()=>void
}){
  const filtered = chats.filter(c=>{
    const name = (c.name || c.other_user?.username || '').toLowerCase();
    return name.includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full bg-[#0f0f14] border-r border-[#1e1e28]">
      <div className="p-4 border-b border-[#1e1e28]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-lg flex items-center justify-center text-sm">⚡</span>
            Flux
          </h1>
          <button onClick={onNewChat} className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center text-white">+</button>
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search chats" className="w-full bg-[#1a1a22] border border-[#2a2a35] rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-violet-600" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length===0 && <p className="text-center text-white/30 text-sm mt-8">No chats yet</p>}
        {filtered.map(chat=> {
          const isActive = chat.id===selectedId;
          const name = chat.name || chat.other_user?.username || 'Unknown';
          const avatar = chat.avatar_url || chat.other_user?.avatar_url;
          const last = chat.last_message || '';
          const unread = chat.unread_count || 0;
          const status = chat.other_user?.status;
          return (
            <button key={chat.id} onClick={()=> onSelect(chat)} className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition text-left border-b border-white/[0.03] ${isActive?'bg-violet-600/10 border-l-2 border-l-violet-600':''}`}>
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white font-semibold overflow-hidden">
                  {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover"/> : name[0]?.toUpperCase()}
                </div>
                {status==='online' && <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0f0f14] rounded-full"></span>}
                {status==='offline' && <span className="absolute bottom-0 right-0 w-3 h-3 bg-gray-500 border-2 border-[#0f0f14] rounded-full"></span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white truncate">{name}</span>
                  {chat.last_message_time && <span className="text-[11px] text-white/40 shrink-0 ml-2">{new Date(chat.last_message_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50 truncate pr-2">{last || (chat.type==='group' ? 'Group chat' : status==='online' ? 'online' : 'offline')}</span>
                  {unread>0 && <span className="bg-violet-600 text-white text-[11px] min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5">{unread}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
