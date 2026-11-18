/**
 * Firebase Initialization & Multi-Tab Offline Persistence Setup
 *
 * Configuration is loaded automatically from `firebase-applet-config.json`.
 * To point this file to another Firebase project, replace the JSON import
 * with your own Firebase config object:
 *   const firebaseConfig = {
 *     apiKey: "...",
 *     authDomain: "...",
 *     projectId: "...",
 *     storageBucket: "...",
 *     messagingSenderId: "...",
 *     appId: "..."
 *   };
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

let dbInstance;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    databaseId
  );
} catch {
  dbInstance = getFirestore(app, databaseId);
}

export const firebaseApp = app;
export const db = dbInstance;
export const auth = getAuth(app);

export const googleSheetsProvider = new GoogleAuthProvider();
googleSheetsProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
