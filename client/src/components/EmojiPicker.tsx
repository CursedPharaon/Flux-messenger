const emojis = ['😀','😂','❤️','👍','👏','🔥','😍','🥳','😎','🤔','😢','😡','🙏','💯','✨','🎉','👌','🤩','😇','🤗','🫡','🤝','💜','⚡','🌟','🍀'];

export default function EmojiPicker({ onSelect, onClose }:{ onSelect:(e:string)=>void, onClose?:()=>void }){
  return (
    <div className="absolute bottom-14 left-2 bg-[#1e1e28] border border-[#2a2a35] rounded-xl p-3 shadow-2xl z-50 w-64">
      <div className="grid grid-cols-7 gap-1">
        {emojis.map(e=> (
          <button key={e} onClick={()=>{onSelect(e); onClose?.();}} className="text-xl hover:bg-white/10 rounded-lg p-1.5 transition">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
