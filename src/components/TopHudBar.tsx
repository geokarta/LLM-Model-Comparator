import { BarChart3, BookOpen, Calculator, Calendar, Cpu, Database, RefreshCw, TrendingUp } from 'lucide-react';

export type ActiveTab = 'comparator' | 'timeline' | 'simulator' | 'ai2027' | 'codex' | 'harvester';

interface TopHudBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  lastHarvestAt: string;
  modelCount: number;
  benchmarkCount: number;
  isHarvesting: boolean;
  onTriggerHarvest: () => void;
  lastDeltaCount: number;
}

export function TopHudBar({
  activeTab,
  onTabChange,
  lastHarvestAt,
  modelCount,
  benchmarkCount,
  isHarvesting,
  onTriggerHarvest,
  lastDeltaCount,
}: TopHudBarProps) {
  const formattedDate = new Date(lastHarvestAt).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <header className="navbar navbar-expand-md navbar-tabler-custom sticky-top d-print-none">
      <div className="container-xl">
        {/* Brand */}
        <div className="navbar-brand d-flex align-items-center gap-2 pe-0 pe-md-3">
          <span className="avatar avatar-sm bg-primary-lt text-primary rounded">
            <Cpu size={18} />
          </span>
          <div>
            <div className="fw-bold lh-1" style={{ fontSize: '0.98rem' }}>
              AI Model Insight
            </div>
            <div className="text-secondary" style={{ fontSize: '0.72rem' }}>
              {modelCount} modèles · {benchmarkCount} benchmarks · MAJ {formattedDate}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="navbar-nav flex-row align-items-center gap-1 my-2 my-md-0">
          <button
            className={`btn btn-sm ${activeTab === 'comparator' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('comparator')}
          >
            <BarChart3 size={15} className="me-1" />
            Comparateur
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'timeline' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('timeline')}
          >
            <Calendar size={15} className="me-1" />
            Timeline
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'simulator' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('simulator')}
          >
            <Calculator size={15} className="me-1" />
            Simulateur Coût
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'ai2027' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('ai2027')}
          >
            <TrendingUp size={15} className="me-1" />
            Courbe AI 2027
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'codex' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('codex')}
          >
            <BookOpen size={15} className="me-1" />
            Codex Benchmarks
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'harvester' ? 'btn-primary' : 'btn-ghost-secondary'}`}
            onClick={() => onTabChange('harvester')}
          >
            <Database size={15} className="me-1" />
            Moissonneur
            {lastDeltaCount > 0 && (
              <span className="badge bg-green-lt text-green ms-1">+{lastDeltaCount}</span>
            )}
          </button>
        </div>

        {/* Right Action */}
        <div className="navbar-nav flex-row align-items-center gap-2 order-md-last">
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm btn-outline-primary"
            title="Ouvrir la documentation interactive Swagger / OpenAPI"
          >
            Swagger API
          </a>
          <button
            className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
            onClick={onTriggerHarvest}
            disabled={isHarvesting}
            title="Synchroniser les prix, contextes et scores depuis les sources publiques"
          >
            <RefreshCw size={14} className={isHarvesting ? 'spin' : ''} />
            {isHarvesting ? 'Synchronisation...' : 'Moissonner'}
          </button>
        </div>
      </div>
    </header>
  );
}
