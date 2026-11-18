import { NextRequest } from 'next/server';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export async function verifyRequestAuth(req: NextRequest): Promise<DecodedIdToken | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (decoded.uid && decoded.email) {
      await getOrCreateUser(decoded.uid, decoded.email);
    }
    return decoded;
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return null;
  }
}
