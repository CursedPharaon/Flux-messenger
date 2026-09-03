# Flux Messenger ⚡

Modern, production-ready messaging platform — **Python + FastAPI + Turso** — supporting text, voice, media, and calls. Responsive dark-themed UI (320px → 4K), real-time via WebSockets.

![Flux](https://img.shields.io/badge/Stack-Python%20FastAPI%20%2B%20React%20%2B%20Turso-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- **Auth**: Register/Login by phone, verify stub (1234), JWT access+refresh, bcrypt, logout, forgot/reset, delete account
- **Profile**: avatar upload, display_name/bio/username edit, online/last_seen, delete
- **Messaging**: Real-time text, emoji, edit/delete (48h for_all), soft delete, reactions (👍❤️🔥😂😱), pin, reply/forward/copy, read receipts (sent→delivered→read), typing indicators, search inside chat/search chats, export JSON/TXT
- **Voice**: MediaRecorder capture, playback, upload
- **Calls**: Stub interface — creates call_logs, WebSocket signaling ready
- **Files**: images (preview), video (player), audio, docs, 50MB limit
- **Other**: Черный список (block/unblock), контакты, приглашение по ссылке, выход/удаление чата, изменение названия/аватара, уведомления (Browser Notification)
- **UI**: Desktop 3-панели (360px sidebar | flexible center | 280px info), mobile full-screen + bottom nav + back, dark default + light toggle, online dots, unread badges, toasts, animations; Tailwind CSS; CSS Grid+Flexbox; touch gestures (long-tap, swipe reply); 44px min tap; adaptive fonts; 320px–4K
- **Realtime**: FastAPI WebSocket, reconnection, offline queue (message persists in DB)

## 🗄️ Database (Turso/LibSQL)

Provisioned:
```
DATABASE_URL=libsql://flux-messenger-cursedd.aws-eu-west-1.turso.io
DATABASE_AUTH_TOKEN=eyJhbG...
```
Tables auto-created on startup (`init_db()`): `users`, `chats`, `chat_participants`, `messages`, `message_statuses`, `contacts`, `reactions`, `blocks`, `calls`, `refresh_tokens`
If Turso unreachable, falls back to local `flux.db` sqlite (same schema). Seed creates alice/bob/charlie + private & group chats.

## 🏗️ Tech Stack

**Frontend**: React 18 (CDN) + Tailwind CSS (CDN), Babel standalone, single-page app in `static/index.html` (also copied to `client/dist` for `server.py` static serve)  
**Backend**: Python + FastAPI, `server.py` (single file runs all), PyJWT, passlib/bcrypt, WebSockets, Uvicorn  
**DB**: Turso libSQL (`libsql-experimental` if installed) else `sqlite3` + `flux.db`

## 📁 Structure

```
flux-messenger/
├── server.py              # единый файл — FastAPI + DB + WS + static serve
├── static/index.html      # React + Tailwind SPA (mobile-first, themes, gestures)
├── client/dist/index.html # копия для server.py
├── uploads/               # загруженные файлы (50MB)
├── requirements.txt
├── .env.example
└── flux.db                # локальный sqlite (fallback)
```

## 🚀 Quick Start

### Prerequisites
Python 3.10+, pip

### 1. Install & Run (single command)

```bash
pip install -r requirements.txt
python server.py
# http://localhost:8000  (API + frontend)
```

Health: `GET http://localhost:8000/health`  
Frontend auto-served from `static/index.html` / `client/dist`

### 2. Environment

`.env` / env vars:
```
DATABASE_URL=libsql://flux-messenger-cursedd.aws-eu-west-1.turso.io
DATABASE_AUTH_TOKEN=...
JWT_SECRET=flux-super-secret-jwt-key-change-in-production-32chars!
PORT=8000
```

## 🔌 API

Auth: `POST /api/auth/register {username,phone,password,display_name}` → `{access_token,refresh_token,user}`  
`POST /api/auth/login {phone,password}` → `{access_token,refresh_token,user}`  
`POST /api/auth/verify {phone,code}` (stub 1234), `POST /api/auth/refresh {refresh_token}`, `POST /api/auth/logout`, `POST /api/auth/forgot`, `POST /api/auth/reset`  
`GET /api/auth/me` (Bearer), `PUT /api/users/me`, `DELETE /api/users/me`, `GET /api/users/search?q=`  

Chats: `GET /api/chats?search=`, `POST /api/chats {type,member_ids,title,username,phone}`, `GET /api/chats/:id`, `PUT /api/chats/:id`, `POST /api/chats/:id/leave`, `GET /api/chats/:id/invite`, `POST /api/chats/:id/join?invite=`

Messages: `GET /api/chats/:id/messages?page&limit&search`, `POST /api/messages {chat_id,text,reply_to_message_id,media_type,media_url}`, `PUT /api/messages/:id {text}`, `DELETE /api/messages/:id?for_all=`, `POST /api/messages/:id/reactions {emoji}`, `POST /api/messages/:id/pin`, `POST /api/messages/:id/forward {chat_id}`, `POST /api/chats/:id/read`, `GET /api/chats/:id/export?format=json|txt`

Upload: `POST /api/upload` (field `file`) → `{url,media_type,size}`, `POST /api/upload/multiple`  
Calls: `GET /api/calls`, `POST /api/calls`, `PUT /api/calls/:id`  
Contacts/Blocks: `GET/POST /api/contacts`, `POST /api/blocks/:id`, `GET /api/blocks`

WebSocket: `WS /ws?token=JWT` — events `typing:start/stop`, `message:send` → `message:new`, `message:edit/delete/react`, `call:initiate/answer/decline/ice-candidate/end`, `user:online/offline`

## 📱 Responsive & Theme

- Desktop: 360px sidebar | flexible center | 280px info (xl+)
- Mobile: full-screen list → tap → chat, header back, bottom nav (Чаты/Новый/Профиль)
- Dark default (`class="dark"` + `bg-[#0a0a0f]`), toggle `document.documentElement.classList`
- Gestures: long-tap menu, swipe to reply (hover actions), drag file
- Tested 320px → 2560px

## 🔒 Security

- Passwords hashed with bcrypt (passlib)
- JWT access 24h + refresh 30d, Bearer middleware for API + WS handshake
- File size 50MB, CORS open (customize in production)

## 🧪 Test Flow

1. Register two users (alice +70000000001 / alice123, bob +70000000002 / bob12345 — seeded)
2. Login → Search user in “Новый чат” → create direct/group
3. Send text / emoji / file / voice; edit/delete, react, pin, reply, forward
4. Open second browser/incognito for realtime check
5. Audio call stub: click 📞 → log in `calls`

## 📝 License

MIT
