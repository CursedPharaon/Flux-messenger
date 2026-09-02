import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import { db } from '../config/database';

const onlineUsers = new Map<string,string>(); // userId -> socketId
const socketToUser = new Map<string,string>(); // socketId -> userId

export function setupSocket(io: Server){
  io.use((socket, next)=>{
    const token = socket.handshake.auth?.token || socket.handshake.query?.token as string;
    if(!token) return next(new Error('No token'));
    try{
      const decoded = verifyToken(token);
      (socket as any).user = decoded;
      next();
    } catch(e){
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket)=>{
    const user = (socket as any).user;
    console.log(`User connected: ${user.username} (${socket.id})`);
    onlineUsers.set(user.id, socket.id);
    socketToUser.set(socket.id, user.id);

    // Update status online
    db.execute({ sql:"UPDATE users SET status='online' WHERE id=?", args:[user.id]});
    // Broadcast online
    socket.broadcast.emit('user:online', { userId: user.id });

    // Join user's chats
    socket.on('chat:join', async (chatId:string)=>{
      socket.join(chatId);
      console.log(`${user.username} joined ${chatId}`);
    });
    socket.on('chat:leave', (chatId:string)=> socket.leave(chatId));

    // Real-time message
    socket.on('message:send', async (data:{ chat_id:string, type?:string, content:string, file_url?:string, duration?:number, tempId?:string })=>{
      try{
        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const type = data.type || 'text';
        await db.execute({ sql:'INSERT INTO messages (id, chat_id, sender_id, type, content, file_url, duration) VALUES (?,?,?,?,?,?,?)', args:[id, data.chat_id, user.id, type, data.content||null, data.file_url||null, data.duration||null]});
        const msg = await db.execute({ sql:'SELECT m.*, u.username as sender_username, u.avatar_url as sender_avatar FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?', args:[id]});
        const payload = { ...msg.rows[0] as any, tempId: data.tempId };
        io.to(data.chat_id).emit('message:new', payload);
        // Also emit to participants who might not be in room but online (for chat list update)
        // Find members
        const members = await db.execute({ sql:'SELECT user_id FROM chat_members WHERE chat_id=?', args:[data.chat_id]});
        for(const m of members.rows as any[]){
          const sid = onlineUsers.get(m.user_id);
          if(sid) io.to(sid).emit('message:new', payload);
        }
      } catch(e){ console.error('message:send error', e); socket.emit('error', { message:'Failed to send' }); }
    });

    socket.on('message:edit', async ({ messageId, content, chatId })=>{
      await db.execute({ sql:'UPDATE messages SET content=?, is_edited=1 WHERE id=? AND sender_id=?', args:[content, messageId, user.id]});
      io.to(chatId).emit('message:edited', { messageId, content });
    });

    socket.on('message:delete', async ({ messageId, chatId })=>{
      await db.execute({ sql:"UPDATE messages SET is_deleted=1, content='This message was deleted', file_url=NULL WHERE id=? AND sender_id=?", args:[messageId, user.id]});
      io.to(chatId).emit('message:deleted', { messageId });
    });

    socket.on('message:react', async ({ messageId, emoji, chatId })=>{
      try{
        const { v4: uuidv4 } = await import('uuid');
        await db.execute({ sql:'INSERT INTO reactions (id, message_id, user_id, emoji) VALUES (?,?,?,?)', args:[uuidv4(), messageId, user.id, emoji]});
      } catch{
        await db.execute({ sql:'DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', args:[messageId, user.id, emoji]});
      }
      io.to(chatId).emit('message:reaction', { messageId, userId: user.id, emoji });
    });

    socket.on('typing:start', ({ chatId })=> socket.to(chatId).emit('typing:start', { chatId, userId: user.id, username: user.username }));
    socket.on('typing:stop', ({ chatId })=> socket.to(chatId).emit('typing:stop', { chatId, userId: user.id }));

    socket.on('message:read', async ({ messageId, chatId })=>{
      await db.execute({ sql:'INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?,?)', args:[messageId, user.id]});
      socket.to(chatId).emit('message:read', { messageId, userId: user.id });
    });

    // WebRTC signaling
    socket.on('call:initiate', ({ calleeId, offer, callType, chatId })=>{
      const calleeSocket = onlineUsers.get(calleeId);
      if(calleeSocket){
        io.to(calleeSocket).emit('call:incoming', { callerId: user.id, callerName: user.username, offer, callType, chatId });
      } else {
        socket.emit('call:failed', { reason:'User offline' });
      }
    });

    socket.on('call:answer', ({ callerId, answer })=>{
      const callerSocket = onlineUsers.get(callerId);
      if(callerSocket) io.to(callerSocket).emit('call:answered', { answer, calleeId: user.id });
    });

    socket.on('call:decline', ({ callerId })=>{
      const callerSocket = onlineUsers.get(callerId);
      if(callerSocket) io.to(callerSocket).emit('call:declined', { calleeId: user.id });
    });

    socket.on('call:ice-candidate', ({ targetId, candidate })=>{
      const targetSocket = onlineUsers.get(targetId);
      if(targetSocket) io.to(targetSocket).emit('call:ice-candidate', { candidate, from: user.id });
    });

    socket.on('call:end', ({ targetId, chatId })=>{
      const targetSocket = onlineUsers.get(targetId);
      if(targetSocket) io.to(targetSocket).emit('call:ended', { from: user.id, chatId });
      if(chatId) socket.to(chatId).emit('call:ended', { from: user.id, chatId });
    });

    socket.on('disconnect', async ()=>{
      console.log(`User disconnected: ${user.username}`);
      onlineUsers.delete(user.id);
      socketToUser.delete(socket.id);
      await db.execute({ sql:"UPDATE users SET status='offline', last_seen=CURRENT_TIMESTAMP WHERE id=?", args:[user.id]});
      socket.broadcast.emit('user:offline', { userId: user.id });
    });
  });
}
