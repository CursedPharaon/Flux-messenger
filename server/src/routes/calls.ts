import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res)=>{
  const userId = req.user!.id;
  const result = await db.execute({ sql:'SELECT * FROM call_logs WHERE caller_id=? OR callee_id=? ORDER BY started_at DESC LIMIT 50', args:[userId, userId]});
  res.json(result.rows);
});

router.post('/', authMiddleware, async (req: AuthRequest, res)=>{
  const { callee_id, chat_id, call_type='audio' } = req.body;
  const caller_id = req.user!.id;
  const id = uuidv4();
  await db.execute({ sql:'INSERT INTO call_logs (id, chat_id, caller_id, callee_id, call_type, status) VALUES (?,?,?,?,?,?)', args:[id, chat_id||null, caller_id, callee_id, call_type, 'initiated']});
  const call = await db.execute({ sql:'SELECT * FROM call_logs WHERE id=?', args:[id]});
  res.status(201).json(call.rows[0]);
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res)=>{
  const { status, duration_seconds } = req.body;
  const id = req.params.id;
  let sql = 'UPDATE call_logs SET status=?';
  const args:any[]=[status];
  if(duration_seconds) { sql+=', duration_seconds=?'; args.push(duration_seconds); }
  if(status==='ended'){ sql+=', ended_at=CURRENT_TIMESTAMP'; }
  sql+=' WHERE id=?'; args.push(id);
  await db.execute({ sql, args });
  const r = await db.execute({ sql:'SELECT * FROM call_logs WHERE id=?', args:[id]});
  res.json(r.rows[0]);
});

export default router;
