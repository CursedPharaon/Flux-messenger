import { Router } from 'express';
import { db } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res)=>{
  const result = await db.execute({ sql:`SELECT u.id, u.username, u.avatar_url, u.status, u.last_seen FROM users u JOIN user_contacts uc ON u.id=uc.contact_user_id WHERE uc.user_id=?`, args:[req.user!.id]});
  res.json(result.rows);
});

router.post('/', authMiddleware, async (req: AuthRequest, res)=>{
  const { contact_user_id } = req.body;
  if(!contact_user_id) return res.status(400).json({error:'contact_user_id required'});
  await db.execute({ sql:'INSERT OR IGNORE INTO user_contacts (user_id, contact_user_id) VALUES (?,?)', args:[req.user!.id, contact_user_id]});
  res.status(201).json({ message:'Contact added' });
});

router.delete('/:contactId', authMiddleware, async (req: AuthRequest, res)=>{
  await db.execute({ sql:'DELETE FROM user_contacts WHERE user_id=? AND contact_user_id=?', args:[req.user!.id, req.params.contactId]});
  res.json({ message:'Removed' });
});

export default router;
