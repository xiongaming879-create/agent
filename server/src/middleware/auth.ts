import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'agent-chat-dev-secret-change-in-prod'

export interface AuthPayload {
  userId: string
  username: string
  role: 'user' | 'admin'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' })
    return
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: '登录已过期' })
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '无权限' })
    return
  }
  next()
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}
