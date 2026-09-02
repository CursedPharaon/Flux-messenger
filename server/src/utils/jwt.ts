import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'flux-super-secret-jwt-key-change-in-production-32chars!';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload { id: string; username: string; email: string; }

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
