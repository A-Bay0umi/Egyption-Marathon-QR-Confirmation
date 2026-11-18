'use client';

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

interface AppletFirebaseConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  storageBucket?: string;
  messagingSenderId?: string;
  firestoreDatabaseId?: string;
}

const config = firebaseConfig as AppletFirebaseConfig;

let appInstance: FirebaseApp;
let dbInstance: Firestore;
let authInstance: Auth;

export function getFirebaseServices() {
  if (!appInstance) {
    appInstance = getApps().length ? getApp() : initializeApp(config);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  if (!dbInstance) {
    const databaseId = config.firestoreDatabaseId || '(default)';
    try {
      dbInstance = initializeFirestore(
        appInstance,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        databaseId
      );
    } catch {
      dbInstance = getFirestore(appInstance, databaseId);
    }
  }
  return { app: appInstance, db: dbInstance, auth: authInstance };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const { auth } = getFirebaseServices();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;
export async function testFirestoreConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  if (!config.firestoreDatabaseId) {
    return false;
  }
  try {
    const { auth, db } = getFirebaseServices();
    if (!auth.currentUser) {
      return false;
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

// In-memory Google Workspace OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedSheetsAccessToken: string | null = null;
let isSigningIn = false;

const sheetsProvider = new GoogleAuthProvider();
sheetsProvider.addScope('https://www.googleapis.com/auth/spreadsheets');

export function initFirebaseAuth(
  onUserChange: (user: User | null, sheetsToken: string | null) => void
) {
  const { auth } = getFirebaseServices();
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedSheetsAccessToken = null;
      onUserChange(null, null);
      return;
    }
    if (!isSigningIn) {
      onUserChange(user, cachedSheetsAccessToken);
    }
  });
}

export async function signInWithGoogleSheets(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const { auth } = getFirebaseServices();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, sheetsProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedSheetsAccessToken = credential?.accessToken ?? null;
    return { user: result.user, accessToken: cachedSheetsAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signInAdminEmailPassword(email: string, password: string): Promise<User> {
  const { auth } = getFirebaseServices();
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function getSheetsAccessToken(): Promise<string | null> {
  return cachedSheetsAccessToken;
}

export async function signOutFirebase() {
  const { auth } = getFirebaseServices();
  cachedSheetsAccessToken = null;
  await signOut(auth);
}
