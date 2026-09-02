import { useRef, useState } from 'react';
import api from '../utils/api';

export default function FileUpload({ onUploaded, onClose }:{ onUploaded:(url:string, meta:any)=>void, onClose?:()=>void }){
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver,setDragOver] = useState(false);
  const [uploading,setUploading] = useState(false);

  const upload = async (files: FileList)=>{
    setUploading(true);
    for(const file of Array.from(files)){
      if(file.size > 50*1024*1024){ alert('File too large >50MB'); continue; }
      // image compression simple via canvas for images
      let toUpload: File | Blob = file;
      if(file.type.startsWith('image/') && file.size > 500*1024){
        try{
          const img = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          const maxW = 1280;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width*scale;
          canvas.height = img.height*scale;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          const blob = await new Promise<Blob| null>(res=> canvas.toBlob(res,'image/jpeg',0.8));
          if(blob) toUpload = new File([blob], file.name.replace(/\.\w+$/,'.jpg'), { type:'image/jpeg' });
        } catch{}
      }
      const fd = new FormData();
      fd.append('file', toUpload);
      try{
        const res = await api.post('/upload', fd, { headers:{ 'Content-Type':'multipart/form-data' }});
        onUploaded(res.data.url, { name:file.name, size:file.size, type:file.type });
      } catch(e){ console.error(e); }
    }
    setUploading(false);
    onClose?.();
  };

  return (
    <div>
      <input ref={inputRef} type="file" multiple hidden onChange={e=> e.target.files && upload(e.target.files)} />
      <div
        onDragOver={e=>{e.preventDefault(); setDragOver(true);}}
        onDragLeave={()=> setDragOver(false)}
        onDrop={e=>{e.preventDefault(); setDragOver(false); if(e.dataTransfer.files) upload(e.dataTransfer.files);}}
        onClick={()=> inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${dragOver? 'border-violet-500 bg-violet-500/10':'border-white/10 hover:border-white/20 bg-white/5'}`}
      >
        {uploading ? <p className="text-sm text-violet-300">Uploading...</p> : <>
          <p className="text-sm text-white/80">Click or drag & drop files here</p>
          <p className="text-xs text-white/40 mt-1">Images, videos, docs up to 50MB</p>
        </>}
      </div>
    </div>
  );
}
