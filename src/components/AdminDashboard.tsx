import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import {
  Activity,
  Check,
  Copy,
  Database,
  Key,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.tsx';
import { PlotlyChart } from './PlotlyChart.tsx';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  revoked: boolean;
}

interface MonitoringResponse {
  persistence: 'firestore' | 'local-json';
  archivedHarvests: number;
  activeApiKeys: number;
  summary: {
    windowDays: number;
    totals: {
      pageViews: number;
      apiCalls: number;
      avgLatencyMs: number;
      mobilePct: number;
      mobileVisits: number;
      desktopVisits: number;
    };
    daily: Array<{
      date: string;
      pageViews: number;
      apiCalls: number;
      avgLatencyMs: number;
    }>;
    byPage: Record<string, number>;
    byEndpoint: Record<string, number>;
    byLang: Record<string, number>;
    byApiKey: Record<string, number>;
  };
}

export function AdminDashboard() {
  const { t } = useI18n();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringResponse | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [kRes, mRes] = await Promise.all([
        fetch('/api/admin/keys'),
        fetch('/api/admin/monitoring'),
      ]);
      if (kRes.ok) {
        const kd = (await kRes.json()) as { keys: ApiKeyItem[] };
        setKeys(kd.keys);
      }
      if (mRes.ok) {
        const md = (await mRes.json()) as MonitoringResponse;
        setMonitoring(md);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { rawKey: string; record: ApiKeyItem };
        setNewlyCreatedKey(data.rawKey);
        setNewKeyName('');
        setKeys((prev) => [data.record, ...prev]);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const res = await fetch(`/api/admin/keys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revoked: true } : k)));
    }
  };

  const chartData: Data[] = useMemo(() => {
    const days = monitoring?.summary.daily ?? [];
    return [
      {
        type: 'bar',
        name: 'Pages vues',
        x: days.map((d) => d.date),
        y: days.map((d) => d.pageViews),
        marker: { color: '#3b82f6' },
      },
      {
        type: 'bar',
        name: 'Appels API',
        x: days.map((d) => d.date),
        y: days.map((d) => d.apiCalls),
        marker: { color: '#10b981' },
      },
    ];
  }, [monitoring]);

  const chartLayout: Partial<Layout> = useMemo(
    () => ({
      barmode: 'group',
      dragmode: 'pan',
      margin: { t: 18, r: 16, b: 40, l: 44 },
      xaxis: { gridcolor: 'rgba(148,163,184,0.12)' },
      yaxis: { gridcolor: 'rgba(148,163,184,0.12)' },
      legend: { orientation: 'h', y: 1.12, x: 0 },
    }),
    []
  );

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://aimodelinsight.com';

  return (
    <div className="d-flex flex-column gap-3">
      {/* Header */}
      <div className="card">
        <div className="card-body py-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="h3 mb-1 d-flex align-items-center gap-2">
              <ShieldCheck size={18} className="text-primary" />
              {t('adminTitle')}
            </h2>
            <div className="text-secondary small">
              {t('persistenceMode')} :{' '}
              <span
                className={`badge ${
                  monitoring?.persistence === 'firestore'
                    ? 'bg-green-lt text-green'
                    : 'bg-yellow-lt text-yellow'
                }`}
              >
                <Database size={11} className="me-1" />
                {monitoring?.persistence === 'firestore' ? 'Google Cloud Firestore' : 'Local JSON'}
              </span>
              {monitoring && (
                <span className="ms-2 font-mono">
                  · {monitoring.archivedHarvests} archive(s) de moissonnage
                </span>
              )}
            </div>
          </div>

          <button className="btn btn-sm btn-outline-secondary" onClick={loadAll} disabled={loading}>
            <RefreshCw size={13} className={`me-1 ${loading ? 'spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Monitoring KPI Cards (Task 6) */}
      {monitoring && (
        <div className="row row-deck row-cards">
          <div className="col-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader d-flex justify-content-between">
                  <span>{t('totalVisits')}</span>
                  <Activity size={14} className="text-primary" />
                </div>
                <div className="h2 mb-0 font-mono text-primary">
                  {monitoring.summary.totals.pageViews}
                </div>
              </div>
            </div>
          </div>

          <div className="col-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader">{t('totalApiCalls')}</div>
                <div className="h2 mb-0 font-mono text-success">
                  {monitoring.summary.totals.apiCalls}
                </div>
              </div>
            </div>
          </div>

          <div className="col-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader">{t('avgLatency')}</div>
                <div className="h2 mb-0 font-mono text-warning">
                  {monitoring.summary.totals.avgLatencyMs} ms
                </div>
              </div>
            </div>
          </div>

          <div className="col-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader d-flex justify-content-between">
                  <span>{t('mobileShare')}</span>
                  <Smartphone size={14} className="text-info" />
                </div>
                <div className="h2 mb-0 font-mono">{monitoring.summary.totals.mobilePct}%</div>
                <div className="text-secondary small font-mono">
                  {monitoring.summary.totals.mobileVisits} mob · {monitoring.summary.totals.desktopVisits} desk
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Management (Task 5) */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h3 className="card-title d-flex align-items-center gap-2 mb-0">
            <Key size={16} className="text-primary" />
            {t('apiKeysTitle')}
          </h3>

          <form className="d-flex gap-2 flex-wrap" onSubmit={handleCreateKey}>
            <input
              type="text"
              className="form-control form-control-sm"
              style={{ minWidth: 210 }}
              placeholder={t('keyNamePlaceholder')}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
              disabled={creating || !newKeyName.trim()}
            >
              <Plus size={14} />
              {t('createKeyBtn')}
            </button>
          </form>
        </div>

        {newlyCreatedKey && (
          <div className="card-body border-bottom bg-green-lt">
            <div className="small fw-semibold mb-1 text-success">
              Nouveau token généré (copiez-le maintenant, il ne sera plus affiché en clair) :
            </div>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <code className="font-mono p-2 rounded bg-dark text-white flex-fill text-break">
                {newlyCreatedKey}
              </code>
              <button
                className="btn btn-sm btn-success"
                onClick={() => {
                  navigator.clipboard.writeText(newlyCreatedKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="small font-mono text-secondary mt-2 text-break">
              curl -H &quot;X-API-Key: {newlyCreatedKey}&quot; &quot;{origin}/api/models&quot;
            </div>
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-vcenter card-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Préfixe</th>
                <th>Appels</th>
                <th>Dernière utilisation</th>
                <th>Statut</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-secondary py-3">
                    Aucune clé API créée pour l’instant. Générez-en une ci-dessus.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id}>
                    <td className="fw-medium">{k.name}</td>
                    <td className="font-mono small">{k.prefix}</td>
                    <td className="font-mono">{k.usageCount}</td>
                    <td className="font-mono small text-secondary">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('fr-FR') : 'Jamais'}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          k.revoked ? 'bg-red-lt text-red' : 'bg-green-lt text-green'
                        }`}
                      >
                        {k.revoked ? 'Révoquée' : 'Active'}
                      </span>
                    </td>
                    <td className="text-end">
                      {!k.revoked && (
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleRevoke(k.id)}
                          title="Révoquer cette clé"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monitoring Charts & Breakdowns */}
      {monitoring && (
        <div className="row row-deck row-cards">
          <div className="col-lg-8">
            <div className="card h-100">
              <div className="card-header">
                <h3 className="card-title mb-0">{t('monitoringTitle')} (30 jours)</h3>
              </div>
              <div className="card-body p-2">
                <PlotlyChart data={chartData} layout={chartLayout} height={300} />
              </div>
            </div>
          </div>

          <div className="col-lg-4">
            <div className="card h-100">
              <div className="card-header">
                <h3 className="card-title mb-0">Top Pages &amp; Langues</h3>
              </div>
              <div className="card-body d-flex flex-column gap-3 small">
                <div>
                  <div className="subheader mb-1">Pages vues</div>
                  {Object.entries(monitoring.summary.byPage)
                    .sort((a, b) => b[1] - a[1])
                    .map(([page, count]) => (
                      <div key={page} className="d-flex justify-content-between py-1 border-bottom">
                        <span>{page}</span>
                        <span className="font-mono fw-semibold">{count}</span>
                      </div>
                    ))}
                </div>

                <div>
                  <div className="subheader mb-1">Langues (FR / EN / ES)</div>
                  <div className="d-flex gap-2 flex-wrap">
                    {Object.entries(monitoring.summary.byLang).map(([lg, count]) => (
                      <span key={lg} className="badge bg-primary-lt text-primary font-mono">
                        {lg.toUpperCase()} : {count}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="subheader mb-1">Top Endpoints API</div>
                  {Object.entries(monitoring.summary.byEndpoint)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([ep, count]) => (
                      <div key={ep} className="d-flex justify-content-between py-1 border-bottom font-mono" style={{ fontSize: '0.72rem' }}>
                        <span className="text-truncate pe-2">{ep}</span>
                        <span className="fw-semibold text-success">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
