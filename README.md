# Flux Messenger ⚡

Modern, production-ready messaging platform supporting text, voice, media, and WebRTC audio/video calls. Responsive dark-themed UI (320px → 4K), real-time via WebSockets.

![Flux](https://img.shields.io/badge/Stack-React%20%2B%20Node%20%2B%20Turso-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- **Auth**: Register/Login, JWT, bcrypt, session
- **Messaging**: Real-time text, emoji picker, edit/delete (soft), reactions, read receipts, typing indicators, search
- **Voice**: MediaRecorder capture, waveform player, pause/play, duration
- **Calls**: WebRTC signaling via Socket.io — audio/video, mute, speaker, camera toggle, PiP, screen-share, front/rear switch
- **Files**: images (preview), video (player), docs, drag-and-drop, 50MB limit, image compression
- **UI**: Desktop sidebar+center+info, mobile full-screen w/ back, dark default + light toggle, online dots, unread badges, skeletons, toasts, animations; Tailwind CSS; responsive 320px-4K
- **Realtime**: Socket.io, reconnection, offline queue (message persists in DB)

## 🗄️ Database (Turso/LibSQL)

Already provisioned:

```
DATABASE_URL=libsql://flux-messenger-cursedd.aws-eu-west-1.turso.io
DATABASE_AUTH_TOKEN=eyJhbG...
```

Tables created automatically on server start (`initDatabase()`):
`users`, `chats`, `chat_members`, `messages`, `voice_messages`, `attachments`, `reactions`, `call_logs`, `user_contacts`, `user_settings`, `message_reads`

## 🏗️ Tech Stack

**Frontend**: React 18 + TypeScript + Vite, Tailwind CSS, React Router, Socket.io-client, Axios  
**Backend**: Node + Express + TypeScript, Socket.io, @libsql/client, JWT, bcryptjs, Multer, uuid  
**Realtime/Calls**: WebRTC (native) + Socket.io signaling, STUN `stun:stun.l.google.com:19302`

## 📁 Structure

```
flux-messenger/
├── server/
│   ├── src/
│   │   ├── config/database.ts & initDb.ts
│   │   ├── middleware/auth.ts
│   │   ├── routes/ (auth, chats, messages, contacts, settings, calls, upload)
│   │   ├── socket/index.ts (auth, messaging, reactions, typing, WebRTC)
│   │   └── index.ts
│   └── uploads/
├── client/
│   ├── src/
│   │   ├── components/ (ChatList, ChatWindow, MessageBubble, VoiceRecorder, VoicePlayer, AudioCall, VideoCall, FileUpload, EmojiPicker)
│   │   ├── pages/ (Login, Register, Messenger)
│   │   ├── context/AuthContext
│   │   ├── hooks/useSocket
│   │   ├── utils/api
│   │   └── App.tsx
│   └── vite.config.ts (proxy /api & /socket.io → localhost:3001)
└── .env
```

## 🚀 Quick Start

### Prerequisites
Node 18+, npm

### 1. Backend

```bash
cd server
npm install
cp .env.example .env # already includes Turso creds + JWT_SECRET
npm run dev   # http://localhost:3001
# init DB explicitly if needed:
npm run db:init
```

Health: `GET http://localhost:3001/health`

### 2. Frontend

```bash
cd client
npm install
npm run dev   # http://localhost:5173 (proxies to backend)
npm run build # production
```

### 3. Environment

`.env` (root & server/.env):
```
DATABASE_URL=libsql://flux-messenger-cursedd.aws-eu-west-1.turso.io
DATABASE_AUTH_TOKEN=...
JWT_SECRET=flux-super-secret-jwt-key-change-in-production-32chars!
PORT=3001
```

## 🔌 API

Auth: `POST /api/auth/register {username,email,password}` → `{token,user}`  
`POST /api/auth/login {email,password}` → `{token,user}`  
`GET /api/auth/me` (Bearer) , `GET /api/auth/users/search?q=`  

Chats: `GET /api/chats` , `POST /api/chats {type,memberIds,name}` , `GET /api/chats/:id`  

Messages: `GET /api/messages/:chatId?page&limit&search`, `POST /api/messages {chat_id,type,content,file_url}` , `PUT /api/messages/:id`, `DELETE /api/messages/:id`, `POST /api/messages/:id/reactions`, `POST /api/messages/chat/:chatId/read-all`

Upload: `POST /api/upload` (field `file`) → `{url}`, `POST /api/upload/multiple`

Calls: `GET /api/calls`, `POST /api/calls`, `PUT /api/calls/:id`

Socket events: `chat:join`, `message:send` → `message:new`, `message:edit/delete/react`, `typing:start/stop`, `call:initiate/answer/decline/ice-candidate/end`, `user:online/offline`

## 📱 Responsive & Theme

- Desktop: 360px sidebar | flexible center | 280px info (xl+)
- Mobile: full-screen list, tap → chat, header back button
- Dark default (`class="dark"` + `bg-[#0a0a0f]`), toggle via `document.documentElement.classList`
- Tested 320px → 2560px

## 🔒 Security

- Passwords hashed with bcryptjs (10 rounds)
- JWT 7d, Bearer auth middleware for all API + Socket handshake
- File size 50MB, image compression to 1280px JPEG 0.8 before upload

## 🧪 Test Flow

1. Register two users (e.g. alice@test.com / bob@test.com)
2. Search user in “New Chat” → create direct chat
3. Send text / emoji / file / voice; edit/delete, react
4. Open second browser/incognito for real-time verification
5. Audio/Video call: allow mic/cam, test mute, camera switch, screen share

## 📝 License

MIT
