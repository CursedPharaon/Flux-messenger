import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

export default function Register(){
  const { register } = useAuth();
  const nav = useNavigate();
  const [username,setUsername]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);

  const submit = async(e:React.FormEvent)=>{
    e.preventDefault(); setErr(''); setLoading(true);
    try{ await register(username,email,password); nav('/'); } catch(e:any){ setErr(e.response?.data?.error || 'Register failed'); } finally{ setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#15151c] border border-white/10 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold mx-auto mb-3">⚡</div>
          <h1 className="text-2xl font-bold text-white">Join Flux</h1>
          <p className="text-sm text-white/50 mt-1">Create your account</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input value={username} onChange={e=> setUsername(e.target.value)} placeholder="Username (3-20 chars, letters/numbers/_)" required className="w-full bg-[#1e1e28] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-600"/>
          <input value={email} onChange={e=> setEmail(e.target.value)} placeholder="Email" type="email" required className="w-full bg-[#1e1e28] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-600"/>
          <input value={password} onChange={e=> setPassword(e.target.value)} placeholder="Password (min 6 chars)" type="password" required className="w-full bg-[#1e1e28] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-600"/>
          {err && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
          <button disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition">
            {loading? 'Creating...':'Create Account'}
          </button>
        </form>
        <p className="text-center text-sm text-white/50 mt-6">Already have account? <Link to="/login" className="text-violet-400 hover:underline">Sign in</Link></p>
      </div>
    </div>
  );
}
