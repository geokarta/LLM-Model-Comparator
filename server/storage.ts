import fs from 'node:fs/promises';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { HarvestRecord, TelemetryDataset } from '../shared/types.ts';
import { createSeedDataset } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.json');
const API_KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

let firestoreClient: Firestore | null = null;
let firestoreAvailable: boolean | null = null;

export function getPersistenceMode(): 'firestore' | 'local-json' {
  return firestoreAvailable ? 'firestore' : 'local-json';
}

async function getFirestore(): Promise<Firestore | null> {
  if (firestoreAvailable === false) return null;
  if (firestoreClient && firestoreAvailable === true) return firestoreClient;

  // Use Firestore automatically on Cloud Run (K_SERVICE) or when explicitly enabled
  const shouldTryFirestore =
    Boolean(process.env.K_SERVICE) ||
    process.env.USE_FIRESTORE === 'true' ||
    Boolean(process.env.GOOGLE_CLOUD_PROJECT);

  if (!shouldTryFirestore) {
    firestoreAvailable = false;
    return null;
  }

  try {
    const db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'aether9-llm-matrix-2026',
    });
    // Quick connectivity probe
    await db.collection('_meta').doc('ping').set({ updatedAt: new Date().toISOString() }, { merge: true });
    firestoreClient = db;
    firestoreAvailable = true;
    console.log('[STORAGE] Google Cloud Firestore connecté (persistance permanente active).');
    return db;
  } catch (err) {
    console.warn(
      '[STORAGE] Firestore indisponible, repli local JSON :',
      err instanceof Error ? err.message : err
    );
    firestoreAvailable = false;
    return null;
  }
}

/**
 * Merge newly added seed models/benchmarks into an existing persisted dataset
 * WITHOUT losing any previously harvested models, prices, or harvest history.
 */
function mergeSeedWithoutDataLoss(existing: TelemetryDataset): TelemetryDataset {
  const seed = createSeedDataset();
  const existingIds = new Set(existing.models.map((m) => m.id));
  const mergedModels = [...existing.models];

  for (const seedModel of seed.models) {
    if (!existingIds.has(seedModel.id)) {
      mergedModels.push(seedModel);
    }
  }

  return {
    ...existing,
    version: seed.version,
    providers: seed.providers,
    benchmarks: seed.benchmarks,
    models: mergedModels,
    harvestHistory: Array.isArray(existing.harvestHistory) ? existing.harvestHistory : [],
  };
}

export async function loadPersistedDataset(): Promise<TelemetryDataset> {
  const db = await getFirestore();
  if (db) {
    try {
      const snap = await db.collection('telemetry').doc('current').get();
      if (snap.exists) {
        const data = snap.data() as TelemetryDataset;
        if (data && Array.isArray(data.models) && Array.isArray(data.benchmarks)) {
          const merged = mergeSeedWithoutDataLoss(data);
          if (merged.models.length !== data.models.length) {
            await savePersistedDataset(merged);
          }
          return merged;
        }
      }
    } catch (err) {
      console.error('[STORAGE] Erreur lecture Firestore telemetry/current:', err);
    }
  }

  // Local JSON fallback
  try {
    const raw = await fs.readFile(TELEMETRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as TelemetryDataset;
    if (parsed && Array.isArray(parsed.models) && Array.isArray(parsed.benchmarks)) {
      const merged = mergeSeedWithoutDataLoss(parsed);
      if (db) {
        await savePersistedDataset(merged);
      }
      return merged;
    }
  } catch {
    // No local file yet
  }

  const seed = createSeedDataset();
  await savePersistedDataset(seed);
  return seed;
}

export async function savePersistedDataset(dataset: TelemetryDataset): Promise<void> {
  // Always keep a local mirror as well
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(TELEMETRY_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
  } catch {
    // Ignore local write errors on read-only environments
  }

  const db = await getFirestore();
  if (db) {
    // Firestore has a 1MB doc limit; keep recent 30 harvest records in `current`
    // while EVERY harvest run is archived permanently in `harvest_runs` collection.
    const compact: TelemetryDataset = {
      ...dataset,
      harvestHistory: dataset.harvestHistory.slice(0, 30),
    };
    await db.collection('telemetry').doc('current').set(JSON.parse(JSON.stringify(compact)));
  }
}

export async function archiveHarvestRun(record: HarvestRecord): Promise<void> {
  const db = await getFirestore();
  if (!db) return;
  try {
    await db
      .collection('harvest_runs')
      .doc(record.id)
      .set(JSON.parse(JSON.stringify(record)));
  } catch (err) {
    console.error('[STORAGE] Erreur archivage harvest_runs:', err);
  }
}

export async function getArchivedHarvestCount(): Promise<number> {
  const db = await getFirestore();
  if (!db) return 0;
  try {
    const agg = await db.collection('harvest_runs').count().get();
    return agg.data().count;
  } catch {
    return 0;
  }
}

// Generic JSON store helpers for API Keys and Analytics (Firestore + local JSON fallback)
export async function loadDoc<T>(collection: string, docId: string, localFile: string, fallback: T): Promise<T> {
  const db = await getFirestore();
  if (db) {
    try {
      const snap = await db.collection(collection).doc(docId).get();
      if (snap.exists) {
        return snap.data() as T;
      }
    } catch (err) {
      console.error(`[STORAGE] Erreur lecture ${collection}/${docId}:`, err);
    }
  }

  try {
    const raw = await fs.readFile(localFile, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveDoc<T>(collection: string, docId: string, localFile: string, data: T): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(localFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // ignore
  }

  const db = await getFirestore();
  if (db) {
    await db.collection(collection).doc(docId).set(JSON.parse(JSON.stringify(data)));
  }
}

export const STORAGE_PATHS = {
  API_KEYS_FILE,
  ANALYTICS_FILE,
};
