import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, DollarSign, Gauge, Globe2, Lock, Trophy, Zap } from 'lucide-react';
import { BenchmarkId, LLMModel, ModelGeneration, ProviderId, TelemetryDataset } from '../shared/types.ts';
import { computeEfficiencyScore, computePowerIndex, formatUsd } from '../shared/metrics.ts';
import { ActiveTab, AuthUser, TopHudBar } from './components/TopHudBar.tsx';
import { ParetoChart } from './components/ParetoChart.tsx';
import { RadarComparator } from './components/RadarComparator.tsx';
import { TaskCostSimulator } from './components/TaskCostSimulator.tsx';
import { TelemetryMatrix } from './components/TelemetryMatrix.tsx';
import { BenchmarkCodex } from './components/BenchmarkCodex.tsx';
import { HarvesterConsole } from './components/HarvesterConsole.tsx';
import { AI2027View } from './components/AI2027View.tsx';
import { CostSimulatorPage } from './components/CostSimulatorPage.tsx';
import { TimelinePage } from './components/TimelinePage.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { NeuralOrb } from './components/NeuralOrb.tsx';
import { emitOrbSignal } from './utils/orbBus.ts';
import { useI18n } from './i18n/I18nContext.tsx';

type ComparisonScope = 'cross-provider' | 'intra-provider';

function getInitialTabFromPath(): ActiveTab {
  if (typeof window === 'undefined') return 'comparator';
  const p = window.location.pathname.toLowerCase();
  if (p.includes('timeline')) return 'timeline';
  if (p.includes('simulator') || p.includes('simulateur')) return 'simulator';
  if (p.includes('ai2027')) return 'ai2027';
  if (p.includes('codex')) return 'codex';
  if (p.includes('harvester')) return 'harvester';
  if (p.includes('admin')) return 'admin';
  return 'comparator';
}

export default function App() {
  const { lang, t } = useI18n();
  const [dataset, setDataset] = useState<TelemetryDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTabFromPath);
  const [scope, setScope] = useState<ComparisonScope>('cross-provider');
  const [generationFilter, setGenerationFilter] = useState<'all' | ModelGeneration>('all');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('openai');
  const [pinnedIds, setPinnedIds] = useState<string[]>([
    'openai-gpt-6-2-astra',
    'google-gemini-4-carbon',
    'anthropic-claude-fable-5-2',
    'deepseek-v4-pro',
  ]);
  const [highlightedBenchmark, setHighlightedBenchmark] = useState<BenchmarkId | null>(null);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      setLoading(true);
      const [telRes, authRes] = await Promise.all([
        fetch('/api/telemetry'),
        fetch('/api/auth/me'),
      ]);
      if (!telRes.ok) throw new Error(`HTTP ${telRes.status}`);
      const data = (await telRes.json()) as TelemetryDataset;
      setDataset(data);
      if (authRes.ok) {
        const authData = (await authRes.json()) as {
          user: AuthUser | null;
          config?: { googleClientId?: string | null };
        };
        setUser(authData.user);
        setGoogleClientId(authData.config?.googleClientId ?? null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de joindre le serveur API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  // Lightweight first-party usage monitoring (Task 6)
  useEffect(() => {
    fetch('/api/analytics/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: activeTab, lang }),
    }).catch(() => {});
  }, [activeTab, lang]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    if (activeTab === 'harvester' || activeTab === 'admin') {
      setActiveTab('comparator');
      window.history.pushState({}, '', '/');
    }
    showToast('Déconnecté.');
  };

  const handleHarvest = async () => {
    if (!user?.isAdmin) {
      setLoginOpen(true);
      showToast(t('loginRequiredHarvest'));
      return;
    }
    setIsHarvesting(true);
    emitOrbSignal({
      type: 'harvest-start',
      color: '#10b981',
      intensity: 1.8,
      label: t('harvestingBtn'),
    });
    try {
      const res = await fetch('/api/harvest', { method: 'POST' });
      if (res.status === 401) {
        setLoginOpen(true);
        throw new Error(t('loginRequiredHarvest'));
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        dataset: TelemetryDataset;
        record: { totalUpdatedFields: number; durationMs: number };
      };
      setDataset(data.dataset);
      emitOrbSignal({
        type: 'harvest-done',
        color: '#10b981',
        intensity: 1.6,
        label: `+${data.record.totalUpdatedFields} MAJ`,
      });
      showToast(
        `Moissonnage terminé en ${data.record.durationMs}ms — ${data.record.totalUpdatedFields} valeur(s) sauvegardée(s).`
      );
    } catch (err) {
      emitOrbSignal({ type: 'harvest-done', color: '#ef4444', intensity: 1.3, label: 'Erreur' });
      showToast(`Erreur moissonnage : ${err instanceof Error ? err.message : 'réseau'}`);
    } finally {
      setIsHarvesting(false);
    }
  };

  const handleReset = async () => {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { dataset: TelemetryDataset };
      setDataset(data.dataset);
      showToast('Base réinitialisée sur les valeurs de référence.');
    }
  };

  const handleUpdateModel = async (modelId: string, patch: Partial<LLMModel>) => {
    const res = await fetch(`/api/models/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = (await res.json()) as { dataset: TelemetryDataset };
      setDataset(data.dataset);
      emitOrbSignal({
        type: 'calibrate',
        color: '#10b981',
        intensity: 1.2,
        label: 'Calibration sauvée',
      });
      showToast('Calibration du modèle enregistrée.');
    }
  };

  const handleScopeChange = (nextScope: ComparisonScope, prov?: ProviderId) => {
    setScope(nextScope);
    if (prov) setSelectedProvider(prov);

    if (dataset && nextScope === 'intra-provider') {
      const targetProv = prov ?? selectedProvider;
      const provMeta = dataset.providers.find((p) => p.id === targetProv);
      const sameProvIds = dataset.models
        .filter((m) => m.provider === targetProv && m.status !== 'upcoming')
        .map((m) => m.id)
        .slice(0, 5);
      setPinnedIds(sameProvIds);
      emitOrbSignal({
        type: 'scope',
        color: provMeta?.color ?? '#3b82f6',
        intensity: 1.3,
        label: provMeta?.name ?? targetProv,
      });
    } else if (dataset && nextScope === 'cross-provider') {
      setPinnedIds([
        'openai-gpt-6-2-astra',
        'google-gemini-4-carbon',
        'anthropic-claude-fable-5-2',
        'deepseek-v4-pro',
      ]);
      emitOrbSignal({
        type: 'scope',
        color: '#3b82f6',
        intensity: 1.2,
        label: t('multiProviders'),
      });
    }
  };

  const togglePin = (id: string) => {
    const targetModel = dataset?.models.find((m) => m.id === id);
    const provMeta = dataset?.providers.find((p) => p.id === targetModel?.provider);
    setPinnedIds((prev) => {
      const removing = prev.includes(id);
      if (targetModel) {
        emitOrbSignal({
          type: 'pin',
          color: provMeta?.color ?? '#3b82f6',
          intensity: removing ? 0.8 : 1.35,
          label: targetModel.name,
        });
      }
      if (removing) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const scopedModels = useMemo(() => {
    if (!dataset) return [];
    return dataset.models.filter((m) => {
      if (m.status === 'upcoming') return false;
      if (scope === 'intra-provider' && m.provider !== selectedProvider) return false;
      if (generationFilter !== 'all' && m.generation !== generationFilter) return false;
      return true;
    });
  }, [dataset, scope, selectedProvider, generationFilter]);

  const pinnedModels = useMemo(() => {
    if (!dataset) return [];
    return pinnedIds
      .map((id) => dataset.models.find((m) => m.id === id))
      .filter((m): m is LLMModel => Boolean(m));
  }, [dataset, pinnedIds]);

  const kpis = useMemo(() => {
    if (!dataset || scopedModels.length === 0) return null;
    const scored = scopedModels.map((m) => {
      const power = computePowerIndex(m, dataset.benchmarks);
      const eff = computeEfficiencyScore(power, m.avgCostPerTaskUsd);
      return { m, power, eff };
    });

    const topPower = [...scored].sort((a, b) => b.power - a.power)[0];
    const topEff = [...scored].sort((a, b) => b.eff - a.eff)[0];
    const topArc3 = [...scored].sort(
      (a, b) => (b.m.benchmarks.arc_agi_3?.score ?? 0) - (a.m.benchmarks.arc_agi_3?.score ?? 0)
    )[0];
    const cheapest = [...scored].sort((a, b) => a.m.avgCostPerTaskUsd - b.m.avgCostPerTaskUsd)[0];

    return { topPower, topEff, topArc3, cheapest };
  }, [dataset, scopedModels]);

  if (loading) {
    return (
      <div className="page page-center">
        <div className="container container-slim py-4 text-center">
          <div className="spinner-border text-primary mb-3" role="status" />
          <div className="text-secondary">{t('loadingApp')}</div>
        </div>
      </div>
    );
  }

  if (error || !dataset) {
    return (
      <div className="page page-center">
        <div className="container-tight py-4">
          <div className="card">
            <div className="card-body text-center">
              <h3 className="text-danger">{t('errorApiTitle')}</h3>
              <p className="text-secondary">{error ?? 'Données indisponibles.'}</p>
              <button className="btn btn-primary" onClick={fetchTelemetry}>
                {t('retryBtn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeProviderMeta = dataset.providers.find((p) => p.id === selectedProvider);

  return (
    <div className="page">
      <TopHudBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          const nextPath = tab === 'comparator' ? '/' : `/${tab}`;
          if (window.location.pathname !== nextPath) {
            window.history.pushState({}, '', nextPath);
          }
          emitOrbSignal({
            type: 'tab',
            color:
              tab === 'harvester'
                ? '#10b981'
                : tab === 'codex'
                  ? '#8b5cf6'
                  : tab === 'ai2027'
                    ? '#f59e0b'
                    : tab === 'simulator'
                      ? '#06b6d4'
                      : '#3b82f6',
            intensity: 1.0,
            label: tab,
          });
        }}
        lastHarvestAt={dataset.lastHarvestAt}
        modelCount={dataset.models.length}
        benchmarkCount={dataset.benchmarks.length}
        isHarvesting={isHarvesting}
        onTriggerHarvest={handleHarvest}
        lastDeltaCount={dataset.harvestHistory[0]?.totalUpdatedFields ?? 0}
        user={user}
        onOpenLogin={() => setLoginOpen(true)}
        onLogout={handleLogout}
      />

      <div className="page-wrapper">
        <div className="page-body">
          <div className="container-xl">
            {toast && (
              <div className="alert alert-success alert-dismissible mb-3" role="alert">
                <div className="d-flex">{toast}</div>
              </div>
            )}

            {activeTab === 'comparator' && (
              <div className="d-flex flex-column gap-3">
                {/* Scope Switcher */}
                <div className="card">
                  <div className="card-body py-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <div className="btn-group" role="group">
                        <button
                          className={`btn btn-sm ${scope === 'cross-provider' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => handleScopeChange('cross-provider')}
                        >
                          <Globe2 size={14} className="me-1" />
                          {t('multiProviders')}
                        </button>
                        <button
                          className={`btn btn-sm ${scope === 'intra-provider' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => handleScopeChange('intra-provider')}
                        >
                          <Building2 size={14} className="me-1" />
                          {t('sameProvider')}
                        </button>
                      </div>

                      <div className="btn-group" role="group" aria-label="Filtre de génération">
                        <button
                          className={`btn btn-sm ${generationFilter === 'all' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('all')}
                        >
                          {t('twoGens')}
                        </button>
                        <button
                          className={`btn btn-sm ${generationFilter === 'current' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('current')}
                        >
                          {t('genCurrent')}
                        </button>
                        <button
                          className={`btn btn-sm ${generationFilter === 'previous' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('previous')}
                        >
                          {t('genPrev')}
                        </button>
                      </div>
                    </div>

                    {scope === 'intra-provider' ? (
                      <div className="d-flex flex-wrap gap-1">
                        {dataset.providers.map((p) => {
                          const count = dataset.models.filter(
                            (m) => m.provider === p.id && m.status !== 'upcoming'
                          ).length;
                          const active = selectedProvider === p.id;
                          return (
                            <button
                              key={p.id}
                              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                              onClick={() => handleScopeChange('intra-provider', p.id)}
                            >
                              {p.name} <span className="badge bg-dark-lt ms-1">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-secondary small d-none d-md-block">
                        {t('crossComparisonHint')}
                      </div>
                    )}
                  </div>
                </div>

                {scope === 'intra-provider' && activeProviderMeta && (
                  <div className="card" style={{ borderLeft: `4px solid ${activeProviderMeta.color}` }}>
                    <div className="card-body py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                      <div>
                        <span className="fw-bold">{activeProviderMeta.name}</span>
                        <span className="text-secondary small ms-2">{activeProviderMeta.headquarters}</span>
                        <div className="text-secondary small">{activeProviderMeta.philosophy}</div>
                      </div>
                      <span className="badge bg-primary-lt text-primary">
                        {scopedModels.length} {t('modelsLabel')}
                      </span>
                    </div>
                  </div>
                )}

                {/* KPI Summary Cards */}
                {kpis && (
                  <div className="row row-deck row-cards">
                    <div className="col-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">{t('kpiPowerLeader')}</div>
                            <Trophy size={15} className="text-primary" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topPower.m.name}</div>
                          <div className="text-secondary small font-mono">
                            {kpis.topPower.power}/100 · {formatUsd(kpis.topPower.m.avgCostPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">{t('kpiBestEfficiency')}</div>
                            <Gauge size={15} className="text-success" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topEff.m.name}</div>
                          <div className="text-success small font-mono">
                            EFF {kpis.topEff.eff} · {formatUsd(kpis.topEff.m.avgCostPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">{t('kpiArc3Record')}</div>
                            <Zap size={15} className="text-purple" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topArc3.m.name}</div>
                          <div className="text-secondary small font-mono">
                            {kpis.topArc3.m.benchmarks.arc_agi_3?.score?.toFixed(1)}% ·{' '}
                            {formatUsd(kpis.topArc3.m.benchmarks.arc_agi_3?.costPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">{t('kpiMinCost')}</div>
                            <DollarSign size={15} className="text-warning" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.cheapest.m.name}</div>
                          <div className="text-warning small font-mono">
                            {formatUsd(kpis.cheapest.m.avgCostPerTaskUsd)}/t · {kpis.cheapest.m.speedTokPerSec} tok/s
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pareto & Radar */}
                <div className="row row-deck row-cards">
                  <div className="col-lg-6">
                    <ParetoChart
                      models={scopedModels}
                      benchmarks={dataset.benchmarks}
                      providers={dataset.providers}
                      pinnedIds={pinnedIds}
                      onTogglePin={togglePin}
                    />
                  </div>
                  <div className="col-lg-6">
                    <RadarComparator
                      pinnedModels={pinnedModels}
                      benchmarks={dataset.benchmarks}
                      providers={dataset.providers}
                      onUnpin={togglePin}
                    />
                  </div>
                </div>

                {/* Task Cost Simulator */}
                <TaskCostSimulator models={scopedModels} providers={dataset.providers} />

                {/* Full Matrix */}
                <TelemetryMatrix
                  models={scopedModels}
                  benchmarks={dataset.benchmarks}
                  providers={dataset.providers}
                  pinnedIds={pinnedIds}
                  onTogglePin={togglePin}
                  onInspectBenchmark={(id) => {
                    setHighlightedBenchmark(id);
                    setActiveTab('codex');
                  }}
                />
              </div>
            )}

            {activeTab === 'timeline' && (
              <TimelinePage
                models={dataset.models}
                providers={dataset.providers}
                benchmarks={dataset.benchmarks}
                isHarvesting={isHarvesting}
                isAdmin={Boolean(user?.isAdmin)}
                onTriggerHarvest={handleHarvest}
              />
            )}

            {activeTab === 'simulator' && (
              <CostSimulatorPage
                models={dataset.models.filter((m) => m.status !== 'upcoming')}
                providers={dataset.providers}
              />
            )}

            {activeTab === 'ai2027' && (
              <AI2027View
                models={dataset.models.filter((m) => m.status !== 'upcoming')}
                providers={dataset.providers}
                pinnedIds={pinnedIds}
              />
            )}

            {activeTab === 'codex' && (
              <BenchmarkCodex
                benchmarks={dataset.benchmarks}
                models={dataset.models}
                providers={dataset.providers}
                highlightedId={highlightedBenchmark}
              />
            )}

            {activeTab === 'harvester' &&
              (user?.isAdmin ? (
                <HarvesterConsole
                  dataset={dataset}
                  isHarvesting={isHarvesting}
                  onTriggerHarvest={handleHarvest}
                  onResetDataset={handleReset}
                  onUpdateModel={handleUpdateModel}
                />
              ) : (
                <div className="card">
                  <div className="card-body text-center py-5">
                    <Lock size={32} className="text-warning mb-2" />
                    <h3>{t('loginRequiredHarvest')}</h3>
                    <button className="btn btn-primary mt-2" onClick={() => setLoginOpen(true)}>
                      {t('loginBtn')}
                    </button>
                  </div>
                </div>
              ))}

            {activeTab === 'admin' &&
              (user?.isAdmin ? (
                <AdminDashboard />
              ) : (
                <div className="card">
                  <div className="card-body text-center py-5">
                    <Lock size={32} className="text-warning mb-2" />
                    <h3>{t('loginModalTitle')}</h3>
                    <button className="btn btn-primary mt-2" onClick={() => setLoginOpen(true)}>
                      {t('loginBtn')}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <LoginModal
        open={loginOpen}
        googleClientId={googleClientId}
        onClose={() => setLoginOpen(false)}
        onSuccess={(u) => {
          setUser(u);
          showToast(`Connecté en tant que ${u.name} (${u.email}).`);
        }}
      />

      <NeuralOrb
        isHarvesting={isHarvesting}
        pinnedCount={pinnedIds.length}
        accentColor={
          scope === 'intra-provider' && activeProviderMeta
            ? activeProviderMeta.color
            : '#3b82f6'
        }
      />
    </div>
  );
}
