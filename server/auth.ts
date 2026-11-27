import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { loadDoc, saveDoc, STORAGE_PATHS } from './storage.ts';

export interface SessionUser {
  email: string;
  name: string;
  isAdmin: boolean;
  provider: 'google' | 'admin-key';
  picture?: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  revoked: boolean;
}

interface ApiKeysStore {
  keys: ApiKeyRecord[];
}

const SESSION_COOKIE = 'ami_session';
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`aimodelinsight-${process.env.ADMIN_PASSWORD || 'local-dev'}`).digest('hex');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'jeanfrancoislegendre@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aimodel-admin-2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

function signSession(user: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token?: string): SessionUser | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionUser & {
      exp?: number;
    };
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return {
      email: parsed.email,
      name: parsed.name,
      isAdmin: Boolean(parsed.isAdmin),
      provider: parsed.provider,
      picture: parsed.picture,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  const token = signSession(user);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionUser(req: Request): SessionUser | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  return verifySessionToken(cookieToken);
}

export function getAuthPublicConfig() {
  return {
    googleClientId: GOOGLE_CLIENT_ID || null,
    googleOAuthEnabled: Boolean(GOOGLE_CLIENT_ID),
    adminKeyLoginEnabled: true,
  };
}

export async function verifyGoogleIdToken(idToken: string): Promise<SessionUser | null> {
  if (!idToken) return null;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const info = (await res.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string;
      name?: string;
      picture?: string;
    };
    if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) return null;
    if (!info.email || info.email_verified !== 'true') return null;

    const emailLower = info.email.toLowerCase();
    return {
      email: emailLower,
      name: info.name || emailLower.split('@')[0],
      isAdmin: ADMIN_EMAILS.includes(emailLower),
      provider: 'google',
      picture: info.picture,
    };
  } catch {
    return null;
  }
}

export function verifyAdminPassword(password: string): SessionUser | null {
  if (!password || password !== ADMIN_PASSWORD) return null;
  return {
    email: ADMIN_EMAILS[0] || 'admin@aimodelinsight.com',
    name: 'Admin',
    isAdmin: true,
    provider: 'admin-key',
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user || !user.isAdmin) {
    res.status(401).json({
      error: 'Authentification administrateur requise.',
    });
    return;
  }
  next();
}

// ==================== API KEYS (Task 5) ====================
function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function loadApiKeysStore(): Promise<ApiKeysStore> {
  const store = await loadDoc<ApiKeysStore>('security', 'api_keys', STORAGE_PATHS.API_KEYS_FILE, {
    keys: [],
  });

  // Ensure initial bootstrap key exists if INITIAL_API_KEY env is configured
  const bootstrapKey = process.env.INITIAL_API_KEY;
  if (bootstrapKey && store.keys.length === 0) {
    const rec: ApiKeyRecord = {
      id: 'key-initial',
      name: 'Clé principale (Initial)',
      prefix: `${bootstrapKey.slice(0, 12)}...`,
      hash: hashApiKey(bootstrapKey),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      usageCount: 0,
      revoked: false,
    };
    store.keys.push(rec);
    await saveDoc('security', 'api_keys', STORAGE_PATHS.API_KEYS_FILE, store);
  }
  return store;
}

export async function listApiKeys(): Promise<Omit<ApiKeyRecord, 'hash'>[]> {
  const store = await loadApiKeysStore();
  return store.keys.map(({ hash: _h, ...rest }) => rest);
}

export async function createApiKey(name: string): Promise<{ rawKey: string; record: Omit<ApiKeyRecord, 'hash'> }> {
  const store = await loadApiKeysStore();
  const rawKey = `ami_live_${crypto.randomBytes(24).toString('hex')}`;
  const rec: ApiKeyRecord = {
    id: `key-${Date.now()}`,
    name: name.trim() || 'API Client',
    prefix: `${rawKey.slice(0, 14)}...`,
    hash: hashApiKey(rawKey),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    usageCount: 0,
    revoked: false,
  };
  store.keys.unshift(rec);
  await saveDoc('security', 'api_keys', STORAGE_PATHS.API_KEYS_FILE, store);
  const { hash: _h, ...safe } = rec;
  return { rawKey, record: safe };
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const store = await loadApiKeysStore();
  const found = store.keys.find((k) => k.id === id);
  if (!found) return false;
  found.revoked = true;
  await saveDoc('security', 'api_keys', STORAGE_PATHS.API_KEYS_FILE, store);
  return true;
}

export async function requireApiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Allow authenticated Admin session (e.g. Swagger UI Try It Out while logged in)
  const adminUser = getSessionUser(req);
  if (adminUser?.isAdmin) {
    res.locals.apiKeyName = `admin:${adminUser.email}`;
    next();
    return;
  }

  const authHeader = req.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerKey = req.get('x-api-key')?.trim() ?? '';
  const queryKey = typeof req.query.api_key === 'string' ? req.query.api_key.trim() : '';
  const candidate = bearer || headerKey || queryKey;

  if (!candidate) {
    res.status(401).json({
      error:
        'Token API requis. Passez votre clé via le header "X-API-Key: <token>" ou "Authorization: Bearer <token>".',
    });
    return;
  }

  const hashed = hashApiKey(candidate);
  const store = await loadApiKeysStore();
  const match = store.keys.find((k) => !k.revoked && k.hash === hashed);
  if (!match) {
    res.status(403).json({ error: 'Token API invalide ou révoqué.' });
    return;
  }

  match.lastUsedAt = new Date().toISOString();
  match.usageCount += 1;
  res.locals.apiKeyName = match.name;
  // Save usage counter in background without blocking the API response
  saveDoc('security', 'api_keys', STORAGE_PATHS.API_KEYS_FILE, store).catch(() => {});
  next();
}
