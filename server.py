#!/usr/bin/env python3
"""
Flux Messenger — Fullstack Server
FastAPI • Turso (libSQL) • WebSockets • JWT • React static

Single file that runs entire app: DB init + API + WS + static serve
"""
import os
import re
import uuid
import json
import time
import sqlite3
import hashlib
import mimetypes
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

import jwt  # PyJWT
from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect, Depends,
    HTTPException, UploadFile, File, Form, Query, Header, Request, status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from passlib.context import CryptContext

# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "libsql://flux-messenger-cursedd.aws-eu-west-1.turso.io")
AUTH_TOKEN = os.getenv("DATABASE_AUTH_TOKEN", os.getenv("AUTH_TOKEN", "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg0NDcwOTksImlkIjoiMDFhMDYyODUtMTAwMS03NmVlLThhMjItYTA3MGJkY2YxZGRiIiwia2lkIjoicWpYbEhLbElGQmJNX29uRDlaWEkyWFVfazVBT3h3X3JIMF9TcUZ6MmU0ZyIsInJpZCI6IjlkMDkxZjkyLTAyMTYtNDFhNi1iMDhiLWYzNDc1MmQ3MTUwNiJ9.mrjXD8kqB4qNR4gTDnWZPX5relsgOkJh5pLpLk84ImGD9SAAA-NYqjYwmNko5VeETX-mJoluokywMjLyWfCGBw"))
JWT_SECRET = os.getenv("JWT_SECRET", "flux-super-secret-jwt-key-change-in-production-32chars!")
JWT_ALGO = "HS256"
ACCESS_EXPIRE_MIN = 60 * 24  # 24h
REFRESH_EXPIRE_DAYS = 30
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
DB_FILE = Path("flux.db")
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

# ─────────────────────────────────────────────────────────────
# DB layer — Turso via libsql if available, else local sqlite
# ─────────────────────────────────────────────────────────────
_use_turso = False
_turso_client = None
try:
    import libsql_experimental as libsql
    if DATABASE_URL.startswith("libsql://"):
        # libsql_experimental expects libsql:// url
        _turso_client = libsql.connect(database=DATABASE_URL, auth_token=AUTH_TOKEN)
        _use_turso = True
        print(f"[DB] Connected to Turso: {DATABASE_URL}")
except Exception as e:
    print(f"[DB] Turso not available ({e}), using local sqlite {DB_FILE}")

_lock = threading.Lock()

def db_conn():
    if _use_turso and _turso_client:
        return _turso_client
    conn = sqlite3.connect(str(DB_FILE), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

# local sqlite connection singleton for non-turso
_local_conn = None
def get_local():
    global _local_conn
    if _local_conn is None:
        _local_conn = sqlite3.connect(str(DB_FILE), check_same_thread=False)
        _local_conn.row_factory = sqlite3.Row
        _local_conn.execute("PRAGMA foreign_keys=ON")
        _local_conn.execute("PRAGMA journal_mode=WAL")
    return _local_conn

def q_exec(sql: str, params=()):
    with _lock:
        if _use_turso and _turso_client:
            # libsql-experimental sync API: execute returns cursor
            cur = _turso_client.execute(sql, params)
            # need commit? libsql auto?
            try:
                _turso_client.commit()
            except: pass
            return cur
        else:
            conn = get_local()
            cur = conn.execute(sql, params)
            conn.commit()
            return cur

def q_fetchall(sql: str, params=()):
    with _lock:
        if _use_turso and _turso_client:
            cur = _turso_client.execute(sql, params)
            rows = cur.fetchall()
            # convert to dict-like
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, r)) for r in rows]
        else:
            conn = get_local()
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
            return [dict(r) for r in rows]

def q_fetchone(sql: str, params=()):
    rows = q_fetchall(sql, params)
    return rows[0] if rows else None

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def gen_id():
    return str(uuid.uuid4())

# ─────────────────────────────────────────────────────────────
# Init DB — create tables
# ─────────────────────────────────────────────────────────────
def init_db():
    stmts = [
        # users
        """CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            bio TEXT,
            last_seen TEXT,
            is_online INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)""",
        """CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)""",
        # chats
        """CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('private','group','channel')),
            title TEXT,
            avatar_url TEXT,
            created_by TEXT REFERENCES users(id),
            invite_link TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        # chat_participants
        """CREATE TABLE IF NOT EXISTS chat_participants (
            chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('member','admin','creator')),
            joined_at TEXT NOT NULL,
            last_read_message_id TEXT,
            is_muted INTEGER DEFAULT 0,
            PRIMARY KEY (chat_id, user_id)
        )""",
        # messages
        """CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
            sender_id TEXT REFERENCES users(id),
            reply_to_message_id TEXT REFERENCES messages(id),
            text TEXT,
            media_type TEXT DEFAULT 'none' CHECK(media_type IN ('none','image','video','audio','file','voice')),
            media_url TEXT,
            media_size INTEGER,
            is_edited INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at)""",
        # message_statuses
        """CREATE TABLE IF NOT EXISTS message_statuses (
            message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('sent','delivered','read')),
            updated_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id)
        )""",
        # contacts
        """CREATE TABLE IF NOT EXISTS contacts (
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            contact_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            nickname TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, contact_user_id)
        )""",
        # reactions
        """CREATE TABLE IF NOT EXISTS reactions (
            message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id, emoji)
        )""",
        # blocks
        """CREATE TABLE IF NOT EXISTS blocks (
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            blocked_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, blocked_user_id)
        )""",
        # calls
        """CREATE TABLE IF NOT EXISTS calls (
            id TEXT PRIMARY KEY,
            chat_id TEXT REFERENCES chats(id),
            caller_id TEXT REFERENCES users(id),
            callee_id TEXT REFERENCES users(id),
            type TEXT CHECK(type IN ('audio','video')),
            status TEXT CHECK(status IN ('initiated','answered','declined','ended','missed')),
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration INTEGER
        )""",
        # refresh tokens (simple)
        """CREATE TABLE IF NOT EXISTS refresh_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""",
    ]
    for s in stmts:
        q_exec(s)
    # seed demo users if empty
    cnt = q_fetchone("SELECT COUNT(*) as c FROM users")
    if cnt and cnt["c"] == 0:
        seed()

def seed():
    print("[DB] Seeding demo data...")
    now = now_iso()
    demo = [
        ("alice", "+70000000001", "Alice", "alice123"),
        ("bob", "+70000000002", "Bob", "bob12345"),
        ("charlie", "+70000000003", "Charlie", "charlie123"),
    ]
    ids = {}
    for uname, phone, disp, pwd in demo:
        uid = gen_id()
        ids[uname] = uid
        q_exec("INSERT INTO users (id,username,phone,password_hash,display_name,avatar_url,bio,last_seen,is_online,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
               (uid, uname, phone, pwd_ctx.hash(pwd), disp, None, f"Hi, I'm {disp}!", now, 0, now, now))
    # create private chat alice-bob
    chat_id = gen_id()
    q_exec("INSERT INTO chats (id,type,title,created_by,invite_link,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
           (chat_id, "private", None, ids["alice"], gen_id()[:8], now, now))
    for u in ["alice","bob"]:
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)",
               (chat_id, ids[u], "member", now))
    # group
    g_id = gen_id()
    q_exec("INSERT INTO chats (id,type,title,created_by,invite_link,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
           (g_id, "group", "Flux Team", ids["alice"], gen_id()[:8], now, now))
    for u in demo:
        role = "creator" if u[0]=="alice" else "member"
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)",
               (g_id, ids[u[0]], role, now))
    # messages
    for i, txt in enumerate(["Привет! Это Flux Messenger ⚡", "Как дела? Готов к тесту?", "Да, всё работает! 🚀"]):
        mid = gen_id()
        sender = ids["alice"] if i%2==0 else ids["bob"]
        q_exec("INSERT INTO messages (id,chat_id,sender_id,text,media_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
               (mid, chat_id, sender, txt, "none", now, now))
    print("[DB] Seed done")

# ─────────────────────────────────────────────────────────────
# Auth helpers
# ─────────────────────────────────────────────────────────────
def hash_pwd(p): return pwd_ctx.hash(p)
def verify_pwd(p, h): return pwd_ctx.verify(p, h)

def create_access_token(user_id: str):
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MIN)
    payload = {"sub": user_id, "exp": exp, "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def create_refresh_token(user_id: str):
    exp = datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": exp, "type": "refresh", "jti": gen_id()}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
    q_exec("INSERT INTO refresh_tokens (token,user_id,expires_at,created_at) VALUES (?,?,?,?)",
           (token, user_id, exp.isoformat(), now_iso()))
    return token

def decode_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(401, "Missing token")
    payload = decode_token(creds.credentials)
    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid access token")
    user = q_fetchone("SELECT * FROM users WHERE id=?", (payload["sub"],))
    if not user:
        raise HTTPException(401, "User not found")
    return user

def get_user_by_token(token: str):
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return q_fetchone("SELECT * FROM users WHERE id=?", (payload["sub"],))
    except:
        return None

def user_public(u: dict):
    if not u: return None
    return {
        "id": u["id"],
        "username": u["username"],
        "phone": u["phone"],
        "display_name": u["display_name"],
        "avatar_url": u["avatar_url"],
        "bio": u["bio"],
        "last_seen": u["last_seen"],
        "is_online": bool(u["is_online"]),
        "created_at": u["created_at"],
    }

# ─────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────
app = FastAPI(title="Flux Messenger API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

# ─────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    username: str
    phone: str
    password: str
    display_name: Optional[str] = None

class LoginIn(BaseModel):
    phone: str
    password: str

class RefreshIn(BaseModel):
    refresh_token: str

class VerifyIn(BaseModel):
    phone: str
    code: str = "1234"

class ForgotIn(BaseModel):
    phone: str

class ResetIn(BaseModel):
    phone: str
    code: str
    new_password: str

class CreateChatIn(BaseModel):
    type: str  # private, group, channel
    title: Optional[str] = None
    member_ids: Optional[List[str]] = None
    username: Optional[str] = None
    phone: Optional[str] = None

class SendMessageIn(BaseModel):
    chat_id: str
    text: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    media_type: str = "none"
    media_url: Optional[str] = None
    media_size: Optional[int] = None

class EditMessageIn(BaseModel):
    text: str

class ReactionIn(BaseModel):
    emoji: str

class UpdateUserIn(BaseModel):
    display_name: Optional[str] = None
    username: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None

class UpdateChatIn(BaseModel):
    title: Optional[str] = None
    avatar_url: Optional[str] = None

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
def is_participant(chat_id: str, user_id: str):
    return q_fetchone("SELECT * FROM chat_participants WHERE chat_id=? AND user_id=?", (chat_id, user_id))

def ensure_participant(chat_id, user_id):
    if not is_participant(chat_id, user_id):
        raise HTTPException(403, "Not a participant")

def chat_with_details(chat: dict, cur_user_id: str):
    participants = q_fetchall("""
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_online, u.last_seen, cp.role
        FROM chat_participants cp JOIN users u ON u.id=cp.user_id
        WHERE cp.chat_id=?
    """, (chat["id"],))
    last_msg = q_fetchone("SELECT * FROM messages WHERE chat_id=? AND is_deleted=0 ORDER BY created_at DESC LIMIT 1", (chat["id"],))
    unread = q_fetchone("""
        SELECT COUNT(*) as c FROM messages m
        WHERE m.chat_id=? AND m.sender_id != ? AND m.is_deleted=0
        AND m.id NOT IN (SELECT message_id FROM message_statuses WHERE user_id=? AND status='read')
    """, (chat["id"], cur_user_id, cur_user_id))
    # title for private: show other user name
    title = chat["title"]
    avatar = chat["avatar_url"]
    if chat["type"] == "private":
        other = next((p for p in participants if p["id"] != cur_user_id), None)
        if other:
            title = other["display_name"] or other["username"]
            avatar = other["avatar_url"]
    return {
        "id": chat["id"],
        "type": chat["type"],
        "title": title,
        "avatar_url": avatar,
        "created_by": chat["created_by"],
        "invite_link": chat["invite_link"],
        "created_at": chat["created_at"],
        "updated_at": chat["updated_at"],
        "participants": participants,
        "last_message": last_msg,
        "unread_count": unread["c"] if unread else 0,
    }

def message_with_details(msg: dict):
    sender = q_fetchone("SELECT id, username, display_name, avatar_url FROM users WHERE id=?", (msg["sender_id"],))
    reactions = q_fetchall("SELECT emoji, user_id FROM reactions WHERE message_id=?", (msg["id"],))
    # group reactions
    grouped = {}
    for r in reactions:
        grouped[r["emoji"]] = grouped.get(r["emoji"], 0) + 1
    # statuses
    statuses = q_fetchall("SELECT user_id, status FROM message_statuses WHERE message_id=?", (msg["id"],))
    reply = None
    if msg["reply_to_message_id"]:
        reply = q_fetchone("SELECT id, text, sender_id FROM messages WHERE id=?", (msg["reply_to_message_id"],))
        if reply:
            rs = q_fetchone("SELECT display_name FROM users WHERE id=?", (reply["sender_id"],))
            reply["sender_name"] = rs["display_name"] if rs else "?"
    return {
        **msg,
        "is_edited": bool(msg["is_edited"]),
        "is_deleted": bool(msg["is_deleted"]),
        "is_pinned": bool(msg["is_pinned"]),
        "sender": sender,
        "reactions": reactions,
        "reactions_grouped": grouped,
        "statuses": statuses,
        "reply_to": reply,
    }

# ─────────────────────────────────────────────────────────────
# WebSocket manager
# ─────────────────────────────────────────────────────────────
class WSManager:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}  # user_id -> ws
        self.chat_rooms: Dict[str, set] = {}  # chat_id -> set(user_id)

    async def connect(self, ws: WebSocket, user_id: str):
        await ws.accept()
        self.active[user_id] = ws
        # mark online
        q_exec("UPDATE users SET is_online=1, last_seen=? WHERE id=?", (now_iso(), user_id))
        # broadcast online
        await self.broadcast({"type":"user:online","user_id":user_id}, exclude=user_id)

    def disconnect(self, user_id: str):
        self.active.pop(user_id, None)
        q_exec("UPDATE users SET is_online=0, last_seen=? WHERE id=?", (now_iso(), user_id))

    async def broadcast(self, data: dict, exclude: str=None):
        dead=[]
        for uid, ws in self.active.items():
            if exclude and uid==exclude: continue
            try:
                await ws.send_json(data)
            except:
                dead.append(uid)
        for d in dead: self.active.pop(d, None)

    async def send_to(self, user_id: str, data: dict):
        ws = self.active.get(user_id)
        if ws:
            try: await ws.send_json(data)
            except: self.active.pop(user_id, None)

    async def send_to_chat(self, chat_id: str, data: dict, exclude=None):
        part = q_fetchall("SELECT user_id FROM chat_participants WHERE chat_id=?", (chat_id,))
        for p in part:
            uid = p["user_id"]
            if exclude and uid==exclude: continue
            await self.send_to(uid, data)

ws_manager = WSManager()

# ─────────────────────────────────────────────────────────────
# Routes — Health
# ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status":"ok","db":"turso" if _use_turso else "sqlite","time":now_iso()}

@app.get("/api/health")
def api_health(): return health()

# ─────────────────────────────────────────────────────────────
# Auth routes
# ─────────────────────────────────────────────────────────────
@app.post("/api/auth/register")
def register(inp: RegisterIn):
    if q_fetchone("SELECT id FROM users WHERE username=?", (inp.username,)):
        raise HTTPException(400, "Username taken")
    if q_fetchone("SELECT id FROM users WHERE phone=?", (inp.phone,)):
        raise HTTPException(400, "Phone already registered")
    if len(inp.password) < 4:
        raise HTTPException(400, "Password too short")
    uid = gen_id()
    now = now_iso()
    disp = inp.display_name or inp.username
    q_exec("INSERT INTO users (id,username,phone,password_hash,display_name,created_at,updated_at,last_seen,is_online) VALUES (?,?,?,?,?,?,?,?,?)",
           (uid, inp.username, inp.phone, hash_pwd(inp.password), disp, now, now, now, 0))
    user = q_fetchone("SELECT * FROM users WHERE id=?", (uid,))
    access = create_access_token(uid)
    refresh = create_refresh_token(uid)
    return {"access_token": access, "refresh_token": refresh, "user": user_public(user)}

@app.post("/api/auth/verify")
def verify(inp: VerifyIn):
    # stub: any code 1234 passes if phone exists
    if inp.code != "1234" and inp.code != "0000":
        raise HTTPException(400, "Invalid code")
    user = q_fetchone("SELECT * FROM users WHERE phone=?", (inp.phone,))
    if not user: raise HTTPException(404, "User not found")
    return {"ok": True, "message": "Verified"}

@app.post("/api/auth/login")
def login(inp: LoginIn):
    user = q_fetchone("SELECT * FROM users WHERE phone=?", (inp.phone,))
    if not user or not verify_pwd(inp.password, user["password_hash"]):
        raise HTTPException(401, "Invalid phone or password")
    access = create_access_token(user["id"])
    refresh = create_refresh_token(user["id"])
    q_exec("UPDATE users SET is_online=1, last_seen=? WHERE id=?", (now_iso(), user["id"]))
    return {"access_token": access, "refresh_token": refresh, "user": user_public(user)}

@app.post("/api/auth/refresh")
def refresh(inp: RefreshIn):
    payload = decode_token(inp.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid refresh token")
    # check exists
    exists = q_fetchone("SELECT * FROM refresh_tokens WHERE token=?", (inp.refresh_token,))
    if not exists:
        raise HTTPException(401, "Refresh token revoked")
    user = q_fetchone("SELECT * FROM users WHERE id=?", (payload["sub"],))
    if not user: raise HTTPException(401, "User not found")
    access = create_access_token(user["id"])
    return {"access_token": access}

@app.post("/api/auth/logout")
def logout(user=Depends(get_current_user), creds: Optional[HTTPAuthorizationCredentials]=Depends(security)):
    # revoke refresh tokens for user? simplified
    q_exec("DELETE FROM refresh_tokens WHERE user_id=?", (user["id"],))
    q_exec("UPDATE users SET is_online=0, last_seen=? WHERE id=?", (now_iso(), user["id"]))
    return {"ok": True}

@app.post("/api/auth/forgot")
def forgot(inp: ForgotIn):
    user = q_fetchone("SELECT * FROM users WHERE phone=?", (inp.phone,))
    if not user: raise HTTPException(404, "User not found")
    # stub: send code 1234
    return {"ok": True, "code": "1234", "message": "Code sent (stub 1234)"}

@app.post("/api/auth/reset")
def reset(inp: ResetIn):
    if inp.code not in ("1234","0000"):
        raise HTTPException(400, "Invalid code")
    user = q_fetchone("SELECT * FROM users WHERE phone=?", (inp.phone,))
    if not user: raise HTTPException(404, "User not found")
    q_exec("UPDATE users SET password_hash=?, updated_at=? WHERE id=?", (hash_pwd(inp.new_password), now_iso(), user["id"]))
    return {"ok": True}

@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    return user_public(user)

@app.get("/api/users/search")
def search_users(q: str = Query(""), user=Depends(get_current_user)):
    if not q: return []
    rows = q_fetchall("SELECT * FROM users WHERE (username LIKE ? OR display_name LIKE ? OR phone LIKE ?) AND id != ? LIMIT 20",
                      (f"%{q}%", f"%{q}%", f"%{q}%", user["id"]))
    # filter blocked
    blocked = {r["blocked_user_id"] for r in q_fetchall("SELECT blocked_user_id FROM blocks WHERE user_id=?", (user["id"],))}
    out=[]
    for r in rows:
        if r["id"] in blocked: continue
        out.append(user_public(r))
    return out

@app.get("/api/users/{uid}")
def get_user(uid: str, user=Depends(get_current_user)):
    u = q_fetchone("SELECT * FROM users WHERE id=?", (uid,))
    if not u: raise HTTPException(404, "Not found")
    return user_public(u)

@app.put("/api/users/me")
def update_me(inp: UpdateUserIn, user=Depends(get_current_user)):
    fields=[]
    params=[]
    if inp.display_name is not None:
        fields.append("display_name=?"); params.append(inp.display_name)
    if inp.username is not None:
        if q_fetchone("SELECT id FROM users WHERE username=? AND id != ?", (inp.username, user["id"])):
            raise HTTPException(400, "Username taken")
        fields.append("username=?"); params.append(inp.username)
    if inp.bio is not None:
        fields.append("bio=?"); params.append(inp.bio)
    if inp.avatar_url is not None:
        fields.append("avatar_url=?"); params.append(inp.avatar_url)
    if fields:
        fields.append("updated_at=?"); params.append(now_iso())
        params.append(user["id"])
        q_exec(f"UPDATE users SET {', '.join(fields)} WHERE id=?", tuple(params))
    return user_public(q_fetchone("SELECT * FROM users WHERE id=?", (user["id"],)))

@app.delete("/api/users/me")
def delete_me(user=Depends(get_current_user)):
    q_exec("DELETE FROM users WHERE id=?", (user["id"],))
    return {"ok": True}

# ─────────────────────────────────────────────────────────────
# Chats
# ─────────────────────────────────────────────────────────────
@app.get("/api/chats")
def list_chats(search: Optional[str]=None, user=Depends(get_current_user)):
    rows = q_fetchall("""
        SELECT c.* FROM chats c
        JOIN chat_participants cp ON cp.chat_id=c.id
        WHERE cp.user_id=?
        ORDER BY c.updated_at DESC
    """, (user["id"],))
    out=[]
    for r in rows:
        d = chat_with_details(dict(r), user["id"])
        if search and search.lower() not in (d["title"] or "").lower():
            continue
        out.append(d)
    return out

@app.post("/api/chats")
def create_chat(inp: CreateChatIn, user=Depends(get_current_user)):
    if inp.type not in ("private","group","channel"):
        raise HTTPException(400, "Invalid type")
    now = now_iso()
    # private via username/phone
    member_ids = inp.member_ids or []
    if inp.type == "private":
        target=None
        if inp.username:
            target = q_fetchone("SELECT * FROM users WHERE username=?", (inp.username,))
        elif inp.phone:
            target = q_fetchone("SELECT * FROM users WHERE phone=?", (inp.phone,))
        elif member_ids:
            target = q_fetchone("SELECT * FROM users WHERE id=?", (member_ids[0],))
        if not target: raise HTTPException(404, "User not found")
        if target["id"] == user["id"]: raise HTTPException(400, "Cannot chat with yourself")
        # check existing private
        existing = q_fetchall("""
            SELECT c.id FROM chats c
            JOIN chat_participants cp1 ON cp1.chat_id=c.id AND cp1.user_id=?
            JOIN chat_participants cp2 ON cp2.chat_id=c.id AND cp2.user_id=?
            WHERE c.type='private'
        """, (user["id"], target["id"]))
        if existing:
            chat = q_fetchone("SELECT * FROM chats WHERE id=?", (existing[0]["id"],))
            return chat_with_details(dict(chat), user["id"])
        cid = gen_id()
        q_exec("INSERT INTO chats (id,type,created_by,invite_link,created_at,updated_at) VALUES (?,?,?,?,?,?)",
               (cid, "private", user["id"], gen_id()[:8], now, now))
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (cid, user["id"], "member", now))
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (cid, target["id"], "member", now))
        chat = q_fetchone("SELECT * FROM chats WHERE id=?", (cid,))
        return chat_with_details(dict(chat), user["id"])
    else:
        # group/channel
        if not inp.title: raise HTTPException(400, "Title required")
        cid = gen_id()
        invite = gen_id()[:8]
        q_exec("INSERT INTO chats (id,type,title,created_by,invite_link,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
               (cid, inp.type, inp.title, user["id"], invite, now, now))
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (cid, user["id"], "creator", now))
        for mid in (member_ids or []):
            if mid==user["id"]: continue
            if q_fetchone("SELECT id FROM users WHERE id=?", (mid,)):
                q_exec("INSERT OR IGNORE INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (cid, mid, "member", now))
        chat = q_fetchone("SELECT * FROM chats WHERE id=?", (cid,))
        return chat_with_details(dict(chat), user["id"])

@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str, user=Depends(get_current_user)):
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    if not chat: raise HTTPException(404, "Chat not found")
    ensure_participant(chat_id, user["id"])
    return chat_with_details(dict(chat), user["id"])

@app.put("/api/chats/{chat_id}")
def update_chat(chat_id: str, inp: UpdateChatIn, user=Depends(get_current_user)):
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    if not chat: raise HTTPException(404, "Not found")
    part = is_participant(chat_id, user["id"])
    if not part or part["role"] not in ("admin","creator"):
        if chat["type"] != "private":
            raise HTTPException(403, "No permission")
    fields=[]; params=[]
    if inp.title is not None: fields.append("title=?"); params.append(inp.title)
    if inp.avatar_url is not None: fields.append("avatar_url=?"); params.append(inp.avatar_url)
    if fields:
        fields.append("updated_at=?"); params.append(now_iso())
        params.append(chat_id)
        q_exec(f"UPDATE chats SET {', '.join(fields)} WHERE id=?", tuple(params))
    return chat_with_details(dict(q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))), user["id"])

@app.post("/api/chats/{chat_id}/join")
def join_by_link(chat_id: str, invite: str = Query(...), user=Depends(get_current_user)):
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    if not chat: raise HTTPException(404, "Not found")
    if chat["invite_link"] != invite: raise HTTPException(403, "Invalid invite")
    if not is_participant(chat_id, user["id"]):
        q_exec("INSERT INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (chat_id, user["id"], "member", now_iso()))
    return {"ok": True}

@app.get("/api/chats/{chat_id}/invite")
def get_invite(chat_id: str, user=Depends(get_current_user)):
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    if not chat: raise HTTPException(404, "Not found")
    ensure_participant(chat_id, user["id"])
    return {"invite_link": chat["invite_link"], "url": f"/join/{chat['invite_link']}"}

@app.post("/api/chats/{chat_id}/leave")
def leave_chat(chat_id: str, user=Depends(get_current_user)):
    ensure_participant(chat_id, user["id"])
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    # if creator and group, delete chat?
    if chat["type"] != "private":
        part = is_participant(chat_id, user["id"])
        if part["role"] == "creator":
            q_exec("DELETE FROM chats WHERE id=?", (chat_id,))
            return {"ok": True, "deleted": True}
    q_exec("DELETE FROM chat_participants WHERE chat_id=? AND user_id=?", (chat_id, user["id"]))
    return {"ok": True}

@app.post("/api/chats/{chat_id}/participants")
def add_participant(chat_id: str, body: dict, user=Depends(get_current_user)):
    ensure_participant(chat_id, user["id"])
    uid = body.get("user_id")
    if not uid: raise HTTPException(400, "user_id required")
    if not q_fetchone("SELECT id FROM users WHERE id=?", (uid,)): raise HTTPException(404, "User not found")
    q_exec("INSERT OR IGNORE INTO chat_participants (chat_id,user_id,role,joined_at) VALUES (?,?,?,?)", (chat_id, uid, "member", now_iso()))
    return {"ok": True}

# ─────────────────────────────────────────────────────────────
# Messages
# ─────────────────────────────────────────────────────────────
@app.get("/api/chats/{chat_id}/messages")
@app.get("/api/messages/{chat_id}")
def list_messages(chat_id: str, page: int=1, limit: int=50, search: Optional[str]=None, user=Depends(get_current_user)):
    ensure_participant(chat_id, user["id"])
    offset = (page-1)*limit
    if search:
        rows = q_fetchall("SELECT * FROM messages WHERE chat_id=? AND is_deleted=0 AND text LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                          (chat_id, f"%{search}%", limit, offset))
    else:
        rows = q_fetchall("SELECT * FROM messages WHERE chat_id=? AND is_deleted=0 ORDER BY created_at DESC LIMIT ? OFFSET ?", (chat_id, limit, offset))
    rows = list(reversed(rows))
    return [message_with_details(dict(r)) for r in rows]

@app.post("/api/messages")
@app.post("/api/chats/{chat_id}/messages")
def send_message(inp: SendMessageIn, user=Depends(get_current_user), chat_id: Optional[str]=None):
    cid = chat_id or inp.chat_id
    if not cid: raise HTTPException(400, "chat_id required")
    ensure_participant(cid, user["id"])
    # if channel and not creator/admin -> forbid
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (cid,))
    if chat["type"]=="channel":
        part = is_participant(cid, user["id"])
        if part["role"] not in ("creator","admin"):
            raise HTTPException(403, "Only admins can post in channel")
    mid = gen_id()
    now = now_iso()
    q_exec("INSERT INTO messages (id,chat_id,sender_id,reply_to_message_id,text,media_type,media_url,media_size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
           (mid, cid, user["id"], inp.reply_to_message_id, inp.text, inp.media_type, inp.media_url, inp.media_size, now, now))
    q_exec("UPDATE chats SET updated_at=? WHERE id=?", (now, cid))
    # statuses sent for all participants
    participants = q_fetchall("SELECT user_id FROM chat_participants WHERE chat_id=?", (cid,))
    for p in participants:
        if p["user_id"] != user["id"]:
            q_exec("INSERT OR IGNORE INTO message_statuses (message_id,user_id,status,updated_at) VALUES (?,?,?,?)", (mid, p["user_id"], "sent", now))
    q_exec("INSERT OR REPLACE INTO message_statuses (message_id,user_id,status,updated_at) VALUES (?,?,?,?)", (mid, user["id"], "read", now))
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    detailed = message_with_details(dict(msg))
    # WS broadcast async — we will send via WS manager (need to schedule)
    # We'll do it after return via background? For now try sync broadcast using loop
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to_chat(cid, {"type":"message:new","message":detailed}))
    except: pass
    return detailed

@app.put("/api/messages/{mid}")
def edit_message(mid: str, inp: EditMessageIn, user=Depends(get_current_user)):
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    if not msg: raise HTTPException(404, "Not found")
    if msg["sender_id"] != user["id"]: raise HTTPException(403, "Not owner")
    if msg["is_deleted"]: raise HTTPException(400, "Deleted")
    q_exec("UPDATE messages SET text=?, is_edited=1, updated_at=? WHERE id=?", (inp.text, now_iso(), mid))
    updated = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    detailed = message_with_details(dict(updated))
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to_chat(msg["chat_id"], {"type":"message:edit","message":detailed}))
    except: pass
    return detailed

@app.delete("/api/messages/{mid}")
def delete_message(mid: str, for_all: bool = Query(False), user=Depends(get_current_user)):
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    if not msg: raise HTTPException(404, "Not found")
    if for_all:
        if msg["sender_id"] != user["id"]: raise HTTPException(403, "Only author can delete for all")
        # 48h limit
        created = datetime.fromisoformat(msg["created_at"])
        if datetime.now(timezone.utc) - created > timedelta(hours=48):
            raise HTTPException(400, "48h limit exceeded")
        q_exec("UPDATE messages SET is_deleted=1, text='', updated_at=? WHERE id=?", (now_iso(), mid))
    else:
        # delete for self -> we just hide via status? simplified delete
        q_exec("UPDATE messages SET is_deleted=1, updated_at=? WHERE id=?", (now_iso(), mid))
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to_chat(msg["chat_id"], {"type":"message:delete","message_id":mid,"for_all":for_all}))
    except: pass
    return {"ok": True}

@app.post("/api/messages/{mid}/reactions")
def react(mid: str, inp: ReactionIn, user=Depends(get_current_user)):
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    if not msg: raise HTTPException(404, "Not found")
    ensure_participant(msg["chat_id"], user["id"])
    # toggle
    exists = q_fetchone("SELECT * FROM reactions WHERE message_id=? AND user_id=? AND emoji=?", (mid, user["id"], inp.emoji))
    if exists:
        q_exec("DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?", (mid, user["id"], inp.emoji))
    else:
        q_exec("INSERT INTO reactions (message_id,user_id,emoji,created_at) VALUES (?,?,?,?)", (mid, user["id"], inp.emoji, now_iso()))
    detailed = message_with_details(dict(q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))))
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to_chat(msg["chat_id"], {"type":"message:react","message":detailed}))
    except: pass
    return detailed

@app.post("/api/messages/{mid}/pin")
def pin(mid: str, user=Depends(get_current_user)):
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    if not msg: raise HTTPException(404, "Not found")
    ensure_participant(msg["chat_id"], user["id"])
    new_val = 0 if msg["is_pinned"] else 1
    q_exec("UPDATE messages SET is_pinned=? WHERE id=?", (new_val, mid))
    return {"ok": True, "is_pinned": bool(new_val)}

@app.post("/api/messages/{mid}/forward")
def forward(mid: str, body: dict, user=Depends(get_current_user)):
    target_chat_id = body.get("chat_id")
    if not target_chat_id: raise HTTPException(400, "chat_id required")
    ensure_participant(target_chat_id, user["id"])
    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
    if not msg: raise HTTPException(404, "Not found")
    nid = gen_id()
    now = now_iso()
    q_exec("INSERT INTO messages (id,chat_id,sender_id,text,media_type,media_url,media_size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
           (nid, target_chat_id, user["id"], msg["text"], msg["media_type"], msg["media_url"], msg["media_size"], now, now))
    q_exec("UPDATE chats SET updated_at=? WHERE id=?", (now, target_chat_id))
    return message_with_details(dict(q_fetchone("SELECT * FROM messages WHERE id=?", (nid,))))

@app.post("/api/chats/{chat_id}/read")
@app.post("/api/messages/chat/{chat_id}/read-all")
def read_all(chat_id: str, user=Depends(get_current_user)):
    ensure_participant(chat_id, user["id"])
    msgs = q_fetchall("SELECT id FROM messages WHERE chat_id=? AND is_deleted=0", (chat_id,))
    now = now_iso()
    for m in msgs:
        q_exec("INSERT OR REPLACE INTO message_statuses (message_id,user_id,status,updated_at) VALUES (?,?,?,?)", (m["id"], user["id"], "read", now))
    q_exec("UPDATE chat_participants SET last_read_message_id=? WHERE chat_id=? AND user_id=?", (msgs[-1]["id"] if msgs else None, chat_id, user["id"]))
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to_chat(chat_id, {"type":"message:read","user_id":user["id"],"chat_id":chat_id}))
    except: pass
    return {"ok": True}

@app.get("/api/chats/{chat_id}/export")
def export_chat(chat_id: str, format: str="json", user=Depends(get_current_user)):
    ensure_participant(chat_id, user["id"])
    msgs = q_fetchall("SELECT * FROM messages WHERE chat_id=? ORDER BY created_at", (chat_id,))
    chat = q_fetchone("SELECT * FROM chats WHERE id=?", (chat_id,))
    if format=="txt":
        txt="\n".join([f"[{m['created_at']}] {m['sender_id']}: {m['text'] or ''} ({m['media_type']})" for m in msgs])
        return {"text": txt}
    return {"chat": dict(chat), "messages": [dict(m) for m in msgs]}

# ─────────────────────────────────────────────────────────────
# Contacts / Blocks
# ─────────────────────────────────────────────────────────────
@app.get("/api/contacts")
def list_contacts(user=Depends(get_current_user)):
    rows = q_fetchall("""
        SELECT u.* , c.nickname FROM contacts c JOIN users u ON u.id=c.contact_user_id WHERE c.user_id=?
    """, (user["id"],))
    return [ {**user_public(dict(r)), "nickname": r["nickname"]} for r in rows]

@app.post("/api/contacts")
def add_contact(body: dict, user=Depends(get_current_user)):
    uid = body.get("user_id") or body.get("contact_user_id")
    if not uid: raise HTTPException(400, "user_id required")
    q_exec("INSERT OR IGNORE INTO contacts (user_id,contact_user_id,nickname,created_at) VALUES (?,?,?,?)",
           (user["id"], uid, body.get("nickname"), now_iso()))
    return {"ok": True}

@app.delete("/api/contacts/{uid}")
def del_contact(uid: str, user=Depends(get_current_user)):
    q_exec("DELETE FROM contacts WHERE user_id=? AND contact_user_id=?", (user["id"], uid))
    return {"ok": True}

@app.post("/api/blocks/{uid}")
def block(uid: str, user=Depends(get_current_user)):
    if uid==user["id"]: raise HTTPException(400, "Cannot block self")
    q_exec("INSERT OR IGNORE INTO blocks (user_id,blocked_user_id,created_at) VALUES (?,?,?)", (user["id"], uid, now_iso()))
    return {"ok": True}

@app.delete("/api/blocks/{uid}")
def unblock(uid: str, user=Depends(get_current_user)):
    q_exec("DELETE FROM blocks WHERE user_id=? AND blocked_user_id=?", (user["id"], uid))
    return {"ok": True}

@app.get("/api/blocks")
def list_blocks(user=Depends(get_current_user)):
    rows = q_fetchall("SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.user_id=?", (user["id"],))
    return [user_public(dict(r)) for r in rows]

# ─────────────────────────────────────────────────────────────
# Upload
# ─────────────────────────────────────────────────────────────
@app.post("/api/upload")
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    if file.size and file.size > 50*1024*1024:
        raise HTTPException(400, "File too large (50MB max)")
    ext = Path(file.filename or "file").suffix or mimetypes.guess_extension(file.content_type or "") or ""
    fname = f"{gen_id()}{ext}"
    dest = UPLOAD_DIR / fname
    data = await file.read()
    dest.write_bytes(data)
    url = f"/uploads/{fname}"
    # detect media_type
    mt = "file"
    if file.content_type:
        if file.content_type.startswith("image/"): mt="image"
        elif file.content_type.startswith("video/"): mt="video"
        elif file.content_type.startswith("audio/"): mt="audio"
    return {"url": url, "media_type": mt, "size": len(data), "filename": file.filename}

@app.post("/api/upload/multiple")
async def upload_multiple(files: List[UploadFile] = File(...), user=Depends(get_current_user)):
    out=[]
    for f in files:
        r = await upload(f, user)
        out.append(r)
    return out

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# ─────────────────────────────────────────────────────────────
# Calls (stub)
# ─────────────────────────────────────────────────────────────
@app.get("/api/calls")
def list_calls(user=Depends(get_current_user)):
    rows = q_fetchall("SELECT * FROM calls WHERE caller_id=? OR callee_id=? ORDER BY started_at DESC LIMIT 50", (user["id"], user["id"]))
    return [dict(r) for r in rows]

@app.post("/api/calls")
def create_call(body: dict, user=Depends(get_current_user)):
    cid = gen_id()
    now = now_iso()
    q_exec("INSERT INTO calls (id,chat_id,caller_id,callee_id,type,status,started_at) VALUES (?,?,?,?,?,?,?)",
           (cid, body.get("chat_id"), user["id"], body.get("callee_id"), body.get("type","audio"), "initiated", now))
    # broadcast via WS
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(ws_manager.send_to(body.get("callee_id"), {"type":"call:incoming","call_id":cid,"from":user_public(user),"call_type":body.get("type","audio")}))
    except: pass
    return {"id": cid, "status":"initiated"}

@app.put("/api/calls/{cid}")
def update_call(cid: str, body: dict, user=Depends(get_current_user)):
    st = body.get("status")
    now = now_iso()
    if st=="ended":
        q_exec("UPDATE calls SET status=?, ended_at=?, duration=? WHERE id=?", (st, now, body.get("duration",0), cid))
    else:
        q_exec("UPDATE calls SET status=? WHERE id=?", (st, cid))
    return {"ok": True}

# ─────────────────────────────────────────────────────────────
# WebSocket endpoint
# ─────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: Optional[str]=Query(None)):
    # token via query ?token=...
    if not token:
        auth = ws.headers.get("authorization","")
        if auth.startswith("Bearer "): token = auth[7:]
    user = get_user_by_token(token) if token else None
    if not user:
        await ws.close(code=1008)
        return
    uid = user["id"]
    await ws_manager.connect(ws, uid)
    try:
        while True:
            data = await ws.receive_json()
            t = data.get("type")
            if t == "typing:start":
                await ws_manager.send_to_chat(data["chat_id"], {"type":"typing:start","chat_id":data["chat_id"],"user_id":uid, "display_name": user["display_name"]}, exclude=uid)
            elif t == "typing:stop":
                await ws_manager.send_to_chat(data["chat_id"], {"type":"typing:stop","chat_id":data["chat_id"],"user_id":uid}, exclude=uid)
            elif t == "message:send":
                # already handled via REST, but allow WS send too
                chat_id = data.get("chat_id")
                text = data.get("text","")
                if chat_id and text:
                    mid = gen_id()
                    now = now_iso()
                    q_exec("INSERT INTO messages (id,chat_id,sender_id,text,media_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                           (mid, chat_id, uid, text, "none", now, now))
                    q_exec("UPDATE chats SET updated_at=? WHERE id=?", (now, chat_id))
                    msg = q_fetchone("SELECT * FROM messages WHERE id=?", (mid,))
                    detailed = message_with_details(dict(msg))
                    await ws_manager.send_to_chat(chat_id, {"type":"message:new","message":detailed})
            elif t == "call:initiate":
                await ws_manager.send_to(data.get("to"), {"type":"call:incoming","from":uid, "offer": data.get("offer")})
            elif t in ("call:answer","call:decline","call:ice-candidate","call:end"):
                await ws_manager.send_to(data.get("to"), {"type":t,"from":uid, **data})
            elif t == "ping":
                await ws.send_json({"type":"pong"})
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(uid)
        await ws_manager.broadcast({"type":"user:offline","user_id":uid})

# ─────────────────────────────────────────────────────────────
# Static frontend
# ─────────────────────────────────────────────────────────────
STATIC_DIR = Path("static")
CLIENT_DIST = Path("client/dist")
FRONTEND_DIR = None
for p in [CLIENT_DIST, STATIC_DIR, Path("frontend/dist")]:
    if p.exists():
        FRONTEND_DIR = p
        break

if FRONTEND_DIR and FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")) if (FRONTEND_DIR / "assets").exists() else StaticFiles(directory=str(FRONTEND_DIR)), name="assets")

@app.get("/", response_class=HTMLResponse)
def serve_root():
    # serve frontend
    for cand in [CLIENT_DIST / "index.html", STATIC_DIR / "index.html", Path("frontend/dist/index.html")]:
        if cand.exists():
            return FileResponse(str(cand))
    # fallback inline
    return HTMLResponse("<h1>Flux Messenger API</h1><p>Frontend not built. See /health</p>")

@app.get("/{full_path:path}", response_class=HTMLResponse)
def serve_spa(full_path: str):
    if full_path.startswith("api/") or full_path.startswith("ws") or full_path.startswith("uploads/") or full_path.startswith("health"):
        raise HTTPException(404)
    for cand in [CLIENT_DIST / "index.html", STATIC_DIR / "index.html"]:
        if cand.exists():
            return FileResponse(str(cand))
    raise HTTPException(404)

# ─────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────
@app.on_event("startup")
def on_startup():
    init_db()
    print("[Flux] Ready. DB:", "Turso" if _use_turso else f"sqlite {DB_FILE}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
