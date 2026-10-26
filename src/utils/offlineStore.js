// etapok-frontend/src/utils/offlineStore.js
import { openDB } from 'idb';

const DB_NAME = 'etapok_offline_db';
const STORE_NAME = 'pending_reports';

export async function initDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'tempId', autoIncrement: true });
      }
    },
  });
}

// Save pending report to browser memory
export async function saveReportOffline(reportData) {
  const db = await initDB();
  const entry = {
    ...reportData,
    createdAt: new Date().toISOString(),
    isOfflineQueued: true,
  };
  await db.add(STORE_NAME, entry);
  return entry;
}

// Fetch all queued offline reports
export async function getOfflineReports() {
  const db = await initDB();
  return await db.getAll(STORE_NAME);
}

// Remove report after successful cloud sync
export async function deleteOfflineReport(tempId) {
  const db = await initDB();
  await db.delete(STORE_NAME, tempId);
}