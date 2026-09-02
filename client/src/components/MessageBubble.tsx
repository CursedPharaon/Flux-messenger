import { Message } from '../types';
import VoicePlayer from './VoicePlayer';
import { useState } from 'react';

export default function MessageBubble({ msg, isOwn, onReact, onEdit, onDelete }: { msg: Message, isOwn:boolean, onReact:(emoji:string)=>void, onEdit:(content:string)=>void, onDelete:()=>void }){
  const [editing,setEditing] = useState(false);
  const [editVal,setEditVal] = useState(msg.content||'');
  const [showReactions,setShowReactions]= useState(false);
  const quick = ['👍','❤️','😂','😮','😢','🙏'];

  if(msg.is_deleted){
    return (
      <div className={`flex ${isOwn?'justify-end':'justify-start'} mb-2`}>
        <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-white/40 italic text-sm">This message was deleted</div>
      </div>
    );
  }

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  return (
    <div className={`group flex ${isOwn?'justify-end':'justify-start'} mb-3`}>
      <div className={`max-w-[75%] relative ${isOwn? 'bg-violet-600 text-white rounded-2xl rounded-br-sm':'bg-[#1e1e28] text-white border border-white/5 rounded-2xl rounded-bl-sm'} px-3 py-2 shadow`}>
        {/* sender for group */}
        {!isOwn && msg.sender_username && <div className="text-xs font-semibold text-violet-400 mb-1">{msg.sender_username}</div>}

        {msg.type==='image' && msg.file_url && (
          <img src={msg.file_url} alt="attachment" className="rounded-xl max-w-full max-h-72 object-contain mb-1 cursor-pointer" onClick={()=> window.open(msg.file_url,'_blank')} />
        )}
        {msg.type==='video' && msg.file_url && (
          <video src={msg.file_url} controls className="rounded-xl max-w-full max-h-72 mb-1" />
        )}
        {msg.type==='file' && msg.file_url && (
          <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-black/20 rounded-lg p-2 mb-1 hover:bg-black/30">
            <span className="w-8 h-8 bg-white/20 rounded flex items-center justify-center text-xs">📄</span>
            <span className="text-sm truncate">{msg.content||'Document'}</span>
          </a>
        )}
        {msg.type==='voice' && msg.file_url && (
          <VoicePlayer src={msg.file_url} duration={msg.duration} />
        )}
        {(msg.type==='text' || msg.type==='emoji') && msg.content && !editing && (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        {editing && (
          <div className="flex gap-2">
            <input value={editVal} onChange={e=>setEditVal(e.target.value)} className="flex-1 bg-black/20 rounded px-2 py-1 text-sm outline-none" autoFocus />
            <button onClick={()=>{onEdit(editVal); setEditing(false);}} className="text-xs bg-white text-violet-600 px-2 rounded font-semibold">Save</button>
            <button onClick={()=> setEditing(false)} className="text-xs text-white/60">Cancel</button>
          </div>
        )}

        <div className={`flex items-center gap-2 mt-1 ${isOwn? 'justify-end':'justify-start'}`}>
          <span className={`text-[10px] ${isOwn?'text-white/70':'text-white/40'}`}>{time}{msg.is_edited && ' (edited)'}</span>
          {isOwn && <span className="text-[10px] text-white/60">✓✓</span>}
        </div>

        {/* reactions */}
        {msg.reactions && msg.reactions.length>0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {Object.entries(msg.reactions.reduce((acc:any,cur:any)=>{acc[cur.emoji]=(acc[cur.emoji]||0)+1; return acc;},{} as Record<string,number>)).map(([emoji,count])=> (
              <span key={emoji} className="text-xs bg-black/20 rounded-full px-1.5 py-0.5">{emoji} {count as number}</span>
            ))}
          </div>
        )}

        {/* hover actions */}
        <div className={`absolute ${isOwn?'left-0 -translate-x-full':'right-0 translate-x-full'} top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-[#2a2a35] border border-white/10 rounded-full p-1 shadow-lg`}>
          {quick.map(e=> <button key={e} onClick={()=> onReact(e)} className="w-6 h-6 hover:bg-white/10 rounded-full text-sm">{e}</button>)}
          <button onClick={()=> setShowReactions(!showReactions)} className="w-6 h-6 text-xs">⋯</button>
          {isOwn && <>
            <button onClick={()=> setEditing(true)} className="p-1 hover:bg-white/10 rounded-full" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button onClick={onDelete} className="p-1 hover:bg-red-500/20 rounded-full text-red-400" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </>}
        </div>
      </div>
    </div>
  );
}
