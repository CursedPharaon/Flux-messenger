import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Get messages for chat with pagination & search
router.get('/:chatId', authMiddleware, async (req: AuthRequest, res)=>{
  try{
    const chatId = req.params.chatId;
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page-1)*limit;
    const search = req.query.search as string;

    const mem = await db.execute({ sql:'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', args:[chatId,userId]});
    if(mem.rows.length===0) return res.status(403).json({error:'Not a member'});

    let sql = `SELECT m.*, u.username as sender_username, u.avatar_url as sender_avatar FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.chat_id=?`;
    let args:any[]=[chatId];
    if(search){
      sql += ` AND m.content LIKE ?`;
      args.push(`%${search}%`);
    }
    sql += ` ORDER BY m.created_at ASC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const result = await db.execute({ sql, args });

    // Attach reactions and read status
    const messages:any[] = [];
    for(const row of result.rows as any[]){
      const reactions = await db.execute({ sql:'SELECT emoji, user_id FROM reactions WHERE message_id=?', args:[row.id]});
      const reads = await db.execute({ sql:'SELECT user_id, read_at FROM message_reads WHERE message_id=?', args:[row.id]});
      messages.push({ ...row, reactions: reactions.rows, reads: reads.rows, is_deleted: !!row.is_deleted, is_edited: !!row.is_edited });
    }
    res.json(messages);
  } catch(e:any){ console.error(e); res.status(500).json({error:'Server error'}); }
});

// Send message
router.post('/', authMiddleware, async (req: AuthRequest, res)=>{
  try{
    const { chat_id, type='text', content, file_url, duration } = req.body;
    const sender_id = req.user!.id;
    if(!chat_id) return res.status(400).json({error:'chat_id required'});
    const mem = await db.execute({ sql:'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', args:[chat_id,sender_id]});
    if(mem.rows.length===0) return res.status(403).json({error:'Not a member'});
    const id = uuidv4();
    await db.execute({ sql:`INSERT INTO messages (id, chat_id, sender_id, type, content, file_url, duration) VALUES (?,?,?,?,?,?,?)`, args:[id, chat_id, sender_id, type, content||null, file_url||null, duration||null]});
    if(type==='voice' && duration && file_url){
      await db.execute({ sql:'INSERT INTO voice_messages (id, message_id, duration_seconds, file_url) VALUES (?,?,?,?)', args:[uuidv4(), id, duration, file_url]});
    }
    const msg = await db.execute({ sql:'SELECT m.*, u.username as sender_username, u.avatar_url as sender_avatar FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?', args:[id]});
    res.status(201).json(msg.rows[0]);
  }catch(e:any){ console.error(e); res.status(500).json({error:'Server error'}); }
});

// Edit message
router.put('/:id', authMiddleware, async (req: AuthRequest, res)=>{
  const msgId = req.params.id;
  const { content } = req.body;
  const userId = req.user!.id;
  const msg = await db.execute({ sql:'SELECT * FROM messages WHERE id=?', args:[msgId]});
  if(msg.rows.length===0) return res.status(404).json({error:'Not found'});
  const m:any = msg.rows[0];
  if(m.sender_id !== userId) return res.status(403).json({error:'Not author'});
  if(m.is_deleted) return res.status(400).json({error:'Message deleted'});
  await db.execute({ sql:'UPDATE messages SET content=?, is_edited=1 WHERE id=?', args:[content, msgId]});
  const updated = await db.execute({ sql:'SELECT * FROM messages WHERE id=?', args:[msgId]});
  res.json(updated.rows[0]);
});

// Delete message (soft delete)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res)=>{
  const msgId = req.params.id;
  const userId = req.user!.id;
  const msg = await db.execute({ sql:'SELECT * FROM messages WHERE id=?', args:[msgId]});
  if(msg.rows.length===0) return res.status(404).json({error:'Not found'});
  const m:any = msg.rows[0];
  if(m.sender_id !== userId) return res.status(403).json({error:'Not author'});
  await db.execute({ sql:"UPDATE messages SET is_deleted=1, content='This message was deleted', file_url=NULL WHERE id=?", args:[msgId]});
  res.json({ message:'Deleted' });
});

// Reactions
router.post('/:id/reactions', authMiddleware, async (req: AuthRequest, res)=>{
  const messageId = req.params.id;
  const { emoji } = req.body;
  const userId = req.user!.id;
  if(!emoji) return res.status(400).json({error:'emoji required'});
  const id = uuidv4();
  try{
    await db.execute({ sql:'INSERT INTO reactions (id, message_id, user_id, emoji) VALUES (?,?,?,?)', args:[id, messageId, userId, emoji]});
  } catch(e){
    // if duplicate, remove
    await db.execute({ sql:'DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', args:[messageId,userId,emoji]});
    return res.json({ removed:true });
  }
  res.status(201).json({ id, emoji });
});

router.delete('/:id/reactions', authMiddleware, async (req: AuthRequest, res)=>{
  const messageId = req.params.id;
  const { emoji } = req.body;
  await db.execute({ sql:'DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', args:[messageId, req.user!.id, emoji]});
  res.json({ message:'Removed' });
});

// Mark as read
router.post('/:id/read', authMiddleware, async (req: AuthRequest, res)=>{
  const messageId = req.params.id;
  const userId = req.user!.id;
  await db.execute({ sql:'INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?,?)', args:[messageId, userId]});
  res.json({ message:'Read' });
});

router.post('/chat/:chatId/read-all', authMiddleware, async (req: AuthRequest, res)=>{
  const chatId = req.params.chatId;
  const userId = req.user!.id;
  const msgs = await db.execute({ sql:'SELECT id FROM messages WHERE chat_id=? AND sender_id != ? AND is_deleted=0', args:[chatId, userId]});
  for(const m of msgs.rows as any[]){
    await db.execute({ sql:'INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?,?)', args:[m.id, userId]});
  }
  res.json({ message:'All read' });
});

export default router;
