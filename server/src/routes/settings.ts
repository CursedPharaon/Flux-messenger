import { Router } from 'express';
import { db } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res)=>{
  const r = await db.execute({ sql:'SELECT * FROM user_settings WHERE user_id=?', args:[req.user!.id]});
  if(r.rows.length===0){ await db.execute({ sql:'INSERT INTO user_settings (user_id) VALUES (?)', args:[req.user!.id]}); return res.json({ theme:'dark', notifications_enabled:1, privacy_settings:'{}' });}
  res.json(r.rows[0]);
});

router.put('/', authMiddleware, async (req: AuthRequest, res)=>{
  const { theme, notifications_enabled, privacy_settings } = req.body;
  await db.execute({ sql:`INSERT INTO user_settings (user_id, theme, notifications_enabled, privacy_settings) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, notifications_enabled=excluded.notifications_enabled, privacy_settings=excluded.privacy_settings`, args:[req.user!.id, theme||'dark', notifications_enabled?1:0, privacy_settings? JSON.stringify(privacy_settings): '{}']});
  const r = await db.execute({ sql:'SELECT * FROM user_settings WHERE user_id=?', args:[req.user!.id]});
  res.json(r.rows[0]);
});

export default router;
