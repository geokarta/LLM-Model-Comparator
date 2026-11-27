import type { NextFunction, Request, Response } from 'express';
import { loadDoc, saveDoc, STORAGE_PATHS } from './storage.ts';

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  pageViews: number;
  apiCalls: number;
  mobileVisits: number;
  desktopVisits: number;
  totalLatencyMs: number;
  latencySamples: number;
  byPage: Record<string, number>;
  byEndpoint: Record<string, number>;
  byLang: Record<string, number>;
  byApiKey: Record<string, number>;
}

interface AnalyticsStore {
  days: Record<string, DailyBucket>;
}

let memoryStore: AnalyticsStore | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureStore(): Promise<AnalyticsStore> {
  if (memoryStore) return memoryStore;
  memoryStore = await loadDoc<AnalyticsStore>(
    'monitoring',
    'usage_summary',
    STORAGE_PATHS.ANALYTICS_FILE,
    { days: {} }
  );
  return memoryStore;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!memoryStore) return;
    // Keep last 60 days to stay compact
    const keys = Object.keys(memoryStore.days).sort().slice(-60);
    const trimmed: Record<string, DailyBucket> = {};
    for (const k of keys) trimmed[k] = memoryStore.days[k];
    memoryStore.days = trimmed;
    await saveDoc('monitoring', 'usage_summary', STORAGE_PATHS.ANALYTICS_FILE, memoryStore).catch(() => {});
  }, 5000);
}

function getTodayBucket(store: AnalyticsStore): DailyBucket {
  const today = new Date().toISOString().slice(0, 10);
  if (!store.days[today]) {
    store.days[today] = {
      date: today,
      pageViews: 0,
      apiCalls: 0,
      mobileVisits: 0,
      desktopVisits: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
      byPage: {},
      byEndpoint: {},
      byLang: {},
      byApiKey: {},
    };
  }
  return store.days[today];
}

function isMobileUserAgent(ua: string): boolean {
  return /android|iphone|ipad|ipod|mobile|blackberry|iemobile/i.test(ua);
}

export function apiMonitoringMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/analytics') || req.path.startsWith('/api/admin')) {
    next();
    return;
  }

  const started = Date.now();
  res.on('finish', async () => {
    try {
      const store = await ensureStore();
      const bucket = getTodayBucket(store);
      const latency = Date.now() - started;

      bucket.apiCalls += 1;
      bucket.totalLatencyMs += latency;
      bucket.latencySamples += 1;

      const endpointKey = `${req.method} ${req.path}`;
      bucket.byEndpoint[endpointKey] = (bucket.byEndpoint[endpointKey] ?? 0) + 1;

      const apiKeyName = res.locals.apiKeyName as string | undefined;
      if (apiKeyName) {
        bucket.byApiKey[apiKeyName] = (bucket.byApiKey[apiKeyName] ?? 0) + 1;
      }

      scheduleFlush();
    } catch {
      // Never impact requests
    }
  });

  next();
}

export async function recordPageView(req: Request, page: string, lang: string): Promise<void> {
  const store = await ensureStore();
  const bucket = getTodayBucket(store);
  const ua = req.get('user-agent') ?? '';

  bucket.pageViews += 1;
  if (isMobileUserAgent(ua)) bucket.mobileVisits += 1;
  else bucket.desktopVisits += 1;

  const cleanPage = page.slice(0, 40) || 'comparator';
  bucket.byPage[cleanPage] = (bucket.byPage[cleanPage] ?? 0) + 1;

  const cleanLang = ['fr', 'en', 'es'].includes(lang) ? lang : 'fr';
  bucket.byLang[cleanLang] = (bucket.byLang[cleanLang] ?? 0) + 1;

  scheduleFlush();
}

export async function getMonitoringSummary() {
  const store = await ensureStore();
  const sortedDays = Object.values(store.days)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  let totalPageViews = 0;
  let totalApiCalls = 0;
  let totalMobile = 0;
  let totalDesktop = 0;
  let totalLatency = 0;
  let totalSamples = 0;
  const byPage: Record<string, number> = {};
  const byEndpoint: Record<string, number> = {};
  const byLang: Record<string, number> = {};
  const byApiKey: Record<string, number> = {};

  for (const d of sortedDays) {
    totalPageViews += d.pageViews;
    totalApiCalls += d.apiCalls;
    totalMobile += d.mobileVisits;
    totalDesktop += d.desktopVisits;
    totalLatency += d.totalLatencyMs;
    totalSamples += d.latencySamples;

    for (const [k, v] of Object.entries(d.byPage)) byPage[k] = (byPage[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.byEndpoint)) byEndpoint[k] = (byEndpoint[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.byLang)) byLang[k] = (byLang[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.byApiKey)) byApiKey[k] = (byApiKey[k] ?? 0) + v;
  }

  return {
    windowDays: 30,
    totals: {
      pageViews: totalPageViews,
      apiCalls: totalApiCalls,
      avgLatencyMs: totalSamples > 0 ? Math.round(totalLatency / totalSamples) : 0,
      mobilePct:
        totalMobile + totalDesktop > 0
          ? Math.round((totalMobile / (totalMobile + totalDesktop)) * 100)
          : 0,
      mobileVisits: totalMobile,
      desktopVisits: totalDesktop,
    },
    daily: sortedDays.map((d) => ({
      date: d.date,
      pageViews: d.pageViews,
      apiCalls: d.apiCalls,
      avgLatencyMs: d.latencySamples > 0 ? Math.round(d.totalLatencyMs / d.latencySamples) : 0,
    })),
    byPage,
    byEndpoint,
    byLang,
    byApiKey,
  };
}
