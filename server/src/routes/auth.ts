import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { signToken } from '../utils/jwt';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username (3-20 alphanumeric + _)' });

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ? OR username = ?', args: [email, username] });
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Username or email already exists' });

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    await db.execute({ sql: 'INSERT INTO users (id, username, email, password_hash, status) VALUES (?,?,?,?,?)', args: [id, username, email, hash, 'offline'] });
    await db.execute({ sql: 'INSERT INTO user_settings (user_id) VALUES (?)', args: [id] });

    const token = signToken({ id, username, email });
    res.status(201).json({ token, user: { id, username, email, avatar_url: null, status: 'offline' } });
  } catch (e:any) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user:any = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await db.execute({ sql: "UPDATE users SET status='online', last_seen=CURRENT_TIMESTAMP WHERE id=?", args: [user.id] });
    const token = signToken({ id: user.id, username: user.username, email: user.email });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, status: 'online' } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Me
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT id, username, email, avatar_url, status, last_seen, created_at FROM users WHERE id=?', args: [req.user!.id] });
    if (result.rows.length===0) return res.status(404).json({error:'User not found'});
    res.json(result.rows[0]);
  } catch(e){ res.status(500).json({error:'Server error'}); }
});

// Logout - set offline
router.post('/logout', authMiddleware, async (req: AuthRequest, res) => {
  await db.execute({ sql: "UPDATE users SET status='offline', last_seen=CURRENT_TIMESTAMP WHERE id=?", args: [req.user!.id] });
  res.json({ message: 'Logged out' });
});

// Search users
router.get('/users/search', authMiddleware, async (req: AuthRequest, res)=>{
  const q = (req.query.q as string) || '';
  if(!q) return res.json([]);
  const result = await db.execute({ sql: "SELECT id, username, email, avatar_url, status FROM users WHERE username LIKE ? AND id != ? LIMIT 20", args: [`%${q}%`, req.user!.id] });
  res.json(result.rows);
});

// Update profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res)=>{
  const { username, avatar_url } = req.body;
  if(username){
    await db.execute({ sql: 'UPDATE users SET username=? WHERE id=?', args:[username, req.user!.id] });
  }
  if(avatar_url !== undefined){
    await db.execute({ sql: 'UPDATE users SET avatar_url=? WHERE id=?', args:[avatar_url, req.user!.id] });
  }
  const r = await db.execute({ sql: 'SELECT id, username, email, avatar_url, status FROM users WHERE id=?', args:[req.user!.id] });
  res.json(r.rows[0]);
});

export default router;
