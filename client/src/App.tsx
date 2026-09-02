import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Messenger from './pages/Messenger';

function Protected({ children }: { children: React.ReactNode }){
  const { user, loading } = useAuth();
  if(loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white">Loading Flux...</div>;
  if(!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
function PublicOnly({ children }: { children: React.ReactNode }){
  const { user, loading } = useAuth();
  if(loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white">Loading Flux...</div>;
  if(user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App(){
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login/></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><Register/></PublicOnly>} />
          <Route path="/" element={<Protected><Messenger/></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
