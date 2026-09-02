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

app.use(cors());
app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health
app.get('/health', (_req,res)=> res.json({ status:'ok', timestamp:new Date().toISOString() }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/upload', uploadRoutes);

// Socket
setupSocket(io);

// 404
app.use((_req,res)=> res.status(404).json({ error:'Not found' }));

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
