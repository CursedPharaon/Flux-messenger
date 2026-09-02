import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const uploadDir = path.join(__dirname, '../../uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive:true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb)=> cb(null, uploadDir),
  filename: (_req, file, cb)=>{
    const ext = path.extname(file.originalname);
    cb(null, uuidv4()+ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50*1024*1024 },
  fileFilter: (_req, file, cb)=>{
    cb(null,true);
  }
});

router.post('/', authMiddleware, upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'No file'});
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

router.post('/multiple', authMiddleware, upload.array('files',10), (req,res)=>{
  const files = req.files as Express.Multer.File[];
  const result = files.map(f=>({ url:`/uploads/${f.filename}`, filename:f.originalname, size:f.size, mimetype:f.mimetype }));
  res.json(result);
});

export default router;
