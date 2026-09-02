import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initDatabase } from './config/database';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chats';
import messageRoutes from './routes/messages';
import contactRoutes from './routes/contacts';
import settingsRoutes from './routes/settings';
import callRoutes from './routes/calls';
import uploadRoutes from './routes/upload';
import { setupSocket } from './socket';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health
app.get('/health', (_req,res)=> res.json({ status:'ok', timestamp:new Date().toISOString() }));

// Routes - all API under /api/*
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/upload', uploadRoutes);

// Socket
setupSocket(io);

// Serve frontend static files (client/dist) - for single-service Render deploy
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// Fallback route for React Router - serve index.html for any non-API route
// Must be after all API routes and static middleware
app.get('/*', (req, res) => {
  // If it's an API route that wasn't matched, return JSON 404
  if (req.path.startsWith('/api/') || req.path === '/api') {
    return res.status(404).json({ error: 'Not found' });
  }
  // Don't intercept socket.io, health or uploads that missed
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/health') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

async function start(){
  try{
    await initDatabase();
    httpServer.listen(PORT, ()=> console.log(`Flux server running on http://localhost:${PORT}`));
  } catch(e){
    console.error('Failed to start', e);
    process.exit(1);
  }
}
start();

export { app, io };
