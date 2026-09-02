import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all chats for user
router.get('/', authMiddleware, async (req: AuthRequest, res)=>{
  try {
    const userId = req.user!.id;
    const result = await db.execute({ sql: `
      SELECT c.id, c.type, c.name, c.avatar_url, c.created_at,
        (SELECT content FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages m LEFT JOIN message_reads mr ON m.id=mr.message_id AND mr.user_id=?
         WHERE m.chat_id=c.id AND m.sender_id != ? AND mr.message_id IS NULL AND m.is_deleted=0) as unread_count
      FROM chats c
      JOIN chat_members cm ON c.id=cm.chat_id
      WHERE cm.user_id=?
      ORDER BY last_message_time DESC
    `, args:[userId, userId, userId] });

    // For direct chats, enrich with other participant
    const chats:any[] = [];
    for(const row of result.rows as any[]){
      let chat = {...row};
      if(row.type==='direct'){
        const member = await db.execute({ sql: `SELECT u.id, u.username, u.avatar_url, u.status, u.last_seen FROM users u JOIN chat_members cm ON u.id=cm.user_id WHERE cm.chat_id=? AND u.id != ? LIMIT 1`, args:[row.id, userId] });
        if(member.rows[0]){
          const other:any = member.rows[0];
          chat.name = other.username;
          chat.avatar_url = other.avatar_url;
          chat.other_user = other;
        }
      }
      // members count for group
      chats.push(chat);
    }
    res.json(chats);
  } catch(e:any){ console.error(e); res.status(500).json({error:'Server error'}); }
});

// Create chat (direct or group)
router.post('/', authMiddleware, async (req: AuthRequest, res)=>{
  try{
    const { type, name, memberIds } = req.body; // type direct/group, for direct memberIds = [otherUserId]
    const creatorId = req.user!.id;
    if(!type) return res.status(400).json({error:'type required'});
    const chatId = uuidv4();
    if(type==='direct'){
      const otherId = memberIds?.[0];
      if(!otherId) return res.status(400).json({error:'memberIds required for direct chat'});
      if(otherId===creatorId) return res.status(400).json({error:'Cannot chat with yourself'});
      // check existing direct chat
      const existing = await db.execute({ sql: `
        SELECT c.id FROM chats c
        JOIN chat_members cm1 ON c.id=cm1.chat_id AND cm1.user_id=?
        JOIN chat_members cm2 ON c.id=cm2.chat_id AND cm2.user_id=?
        WHERE c.type='direct' LIMIT 1
      `, args:[creatorId, otherId] });
      if(existing.rows.length>0) return res.json({ id: (existing.rows[0] as any).id, existing:true });
      await db.execute({ sql:'INSERT INTO chats (id,type) VALUES (?,?)', args:[chatId,'direct']});
      await db.execute({ sql:'INSERT INTO chat_members (chat_id,user_id,role) VALUES (?,?,?)', args:[chatId, creatorId,'admin']});
      await db.execute({ sql:'INSERT INTO chat_members (chat_id,user_id,role) VALUES (?,?,?)', args:[chatId, otherId,'member']});
    } else {
      if(!name) return res.status(400).json({error:'name required for group'});
      await db.execute({ sql:'INSERT INTO chats (id,type,name) VALUES (?,?,?)', args:[chatId,'group',name]});
      await db.execute({ sql:'INSERT INTO chat_members (chat_id,user_id,role) VALUES (?,?,?)', args:[chatId, creatorId,'admin']});
      if(memberIds?.length){
        for(const mid of memberIds){
          await db.execute({ sql:'INSERT OR IGNORE INTO chat_members (chat_id,user_id) VALUES (?,?)', args:[chatId,mid]});
        }
      }
    }
    const chat = await db.execute({ sql:'SELECT * FROM chats WHERE id=?', args:[chatId] });
    res.status(201).json(chat.rows[0]);
  } catch(e:any){ console.error(e); res.status(500).json({error:'Server error'}); }
});

// Get chat detail
router.get('/:id', authMiddleware, async (req: AuthRequest, res)=>{
  const chatId = req.params.id;
  const userId = req.user!.id;
  const mem = await db.execute({ sql:'SELECT * FROM chat_members WHERE chat_id=? AND user_id=?', args:[chatId,userId]});
  if(mem.rows.length===0) return res.status(403).json({error:'Not a member'});
  const chat = await db.execute({ sql:'SELECT * FROM chats WHERE id=?', args:[chatId]});
  if(chat.rows.length===0) return res.status(404).json({error:'Chat not found'});
  const members = await db.execute({ sql:'SELECT u.id, u.username, u.avatar_url, u.status, cm.role FROM users u JOIN chat_members cm ON u.id=cm.user_id WHERE cm.chat_id=?', args:[chatId]});
  res.json({ ...chat.rows[0] as any, members: members.rows });
});

// Add member to group
router.post('/:id/members', authMiddleware, async (req: AuthRequest, res)=>{
  const chatId = req.params.id;
  const { userId } = req.body;
  await db.execute({ sql:'INSERT OR IGNORE INTO chat_members (chat_id,user_id) VALUES (?,?)', args:[chatId,userId]});
  res.json({ message:'Added' });
});

// Leave chat
router.delete('/:id/members/me', authMiddleware, async (req: AuthRequest, res)=>{
  await db.execute({ sql:'DELETE FROM chat_members WHERE chat_id=? AND user_id=?', args:[req.params.id, req.user!.id]});
  res.json({ message:'Left' });
});

export default router;
