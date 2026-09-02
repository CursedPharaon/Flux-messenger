export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string;
  status?: string;
  last_seen?: string;
}

export interface Chat {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatar_url?: string;
  created_at: string;
  last_message?: string;
  last_message_time?: string;
  unread_count?: number;
  other_user?: User;
  members?: User[];
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  type: 'text' | 'voice' | 'image' | 'video' | 'file' | 'emoji';
  content?: string;
  file_url?: string;
  duration?: number;
  created_at: string;
  is_edited?: boolean;
  is_deleted?: boolean;
  sender_username?: string;
  sender_avatar?: string;
  reactions?: { emoji: string; user_id: string }[];
  reads?: { user_id: string; read_at: string }[];
}

export interface CallLog {
  id: string;
  chat_id?: string;
  caller_id: string;
  callee_id: string;
  call_type: 'audio' | 'video';
  status: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
}
