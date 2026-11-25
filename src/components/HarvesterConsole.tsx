import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  History,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import { LLMModel, TelemetryDataset } from '../../shared/types.ts';
import { formatUsd } from '../../shared/metrics.ts';

interface HarvesterConsoleProps {
  dataset: TelemetryDataset;
  isHarvesting: boolean;
  onTriggerHarvest: () => void;
  onResetDataset: () => void;
  onUpdateModel: (modelId: string, patch: Partial<LLMModel>) => Promise<void>;
}

export function HarvesterConsole({
  dataset,
  isHarvesting,
  onTriggerHarvest,
  onResetDataset,
  onUpdateModel,
}: HarvesterConsoleProps) {
  const [selectedModelId, setSelectedModelId] = useState(dataset.models[0]?.id ?? '');
  const selectedModel = dataset.models.find((m) => m.id === selectedModelId);

  const [inPrice, setInPrice] = useState<string>('');
  const [outPrice, setOutPrice] = useState<string>('');
  const [arc2Score, setArc2Score] = useState<string>('');
  const [arc3Score, setArc3Score] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const loadModelIntoEditor = (id: string) => {
    setSelectedModelId(id);
    const m = dataset.models.find((x) => x.id === id);
    if (!m) return;
    setInPrice(String(m.inputPricePer1M));
    setOutPrice(String(m.outputPricePer1M));
    setArc2Score(String(m.benchmarks.arc_agi_2?.score ?? ''));
    setArc3Score(String(m.benchmarks.arc_agi_3?.score ?? ''));
  };

  const handleSaveManual = async () => {
    if (!selectedModel) return;
    setSaving(true);
    try {
      const patch: Partial<LLMModel> = {
        inputPricePer1M: inPrice !== '' ? Number(inPrice) : selectedModel.inputPricePer1M,
        outputPricePer1M: outPrice !== '' ? Number(outPrice) : selectedModel.outputPricePer1M,
        benchmarks: {
          ...selectedModel.benchmarks,
          arc_agi_2: {
            ...selectedModel.benchmarks.arc_agi_2,
            score: arc2Score !== '' ? Number(arc2Score) : selectedModel.benchmarks.arc_agi_2.score,
          },
          arc_agi_3: {
            ...selectedModel.benchmarks.arc_agi_3,
            score: arc3Score !== '' ? Number(arc3Score) : selectedModel.benchmarks.arc_agi_3.score,
          },
        },
      };
      await onUpdateModel(selectedModel.id, patch);
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm-benchmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestRecord = dataset.harvestHistory[0];

  return (
    <div className="d-flex flex-column gap-3">
      {/* Header & Sources */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h3 className="card-title d-flex align-items-center gap-2 mb-0">
              <Database size={16} className="text-primary" />
              Moissonneur de données en direct
            </h3>
            <div className="text-secondary small">
              Synchronisez les tarifs API, fenêtres de contexte et scores depuis les sources publiques (ou via{' '}
              <code className="font-mono">npm run harvest</code>).
            </div>
          </div>

          <div className="d-flex gap-2 flex-wrap">
            <button
              className="btn btn-sm btn-success d-inline-flex align-items-center gap-1"
              onClick={onTriggerHarvest}
              disabled={isHarvesting}
            >
              <RefreshCw size={14} className={isHarvesting ? 'spin' : ''} />
              {isHarvesting ? 'Moissonnage...' : 'Lancer le moissonnage'}
            </button>
            <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={handleExportJson}>
              <Download size={14} /> Exporter JSON
            </button>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={onResetDataset}>
              <RotateCcw size={14} /> Réinitialiser
            </button>
          </div>
        </div>

        {latestRecord && (
          <div className="card-body">
            <div className="row g-3">
              {latestRecord.sources.map((src) => {
                const ok = src.status === 'ok';
                return (
                  <div key={src.source} className="col-md-6">
                    <div className="p-3 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.55)' }}>
                      <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
                        <span className="fw-semibold small">{src.source}</span>
                        <span className={`badge ${ok ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'} d-inline-flex align-items-center gap-1`}>
                          {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                          {src.status.toUpperCase()} · {src.durationMs}ms
                        </span>
                      </div>
                      <div className="text-secondary small">{src.message}</div>
                      <div className="text-muted font-mono mt-1" style={{ fontSize: '0.7rem' }}>
                        {src.url}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="row row-deck row-cards">
        {/* History */}
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">
              <h3 className="card-title d-flex align-items-center gap-2 mb-0">
                <History size={16} className="text-primary" />
                Historique des moissonnages &amp; deltas
              </h3>
            </div>
            <div className="card-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <div className="d-flex flex-column gap-2">
                {dataset.harvestHistory.map((rec) => (
                  <div key={rec.id} className="p-3 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.5)' }}>
                    <div className="d-flex justify-content-between small mb-1">
                      <span className="fw-semibold font-mono">
                        {new Date(rec.timestamp).toLocaleString('fr-FR')}
                      </span>
                      <span className="text-secondary font-mono">
                        {rec.trigger.toUpperCase()} · {rec.durationMs}ms ·{' '}
                        <span className={rec.totalUpdatedFields > 0 ? 'text-success fw-semibold' : ''}>
                          {rec.totalUpdatedFields} MAJ
                        </span>
                      </span>
                    </div>

                    {rec.changes.length > 0 ? (
                      <div className="mt-2 d-flex flex-column gap-1 font-mono" style={{ fontSize: '0.73rem' }}>
                        {rec.changes.slice(0, 12).map((ch, idx) => (
                          <div key={`${rec.id}-${idx}`}>
                            <span className="text-success">Δ</span> {ch.modelName}{' '}
                            <span className="text-secondary">({ch.field})</span> :{' '}
                            <span className="text-danger">{String(ch.oldValue)}</span> →{' '}
                            <span className="text-success fw-semibold">{String(ch.newValue)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-secondary small">Aucune modification détectée.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Manual Calibration */}
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">
              <h3 className="card-title d-flex align-items-center gap-2 mb-0">
                <Edit3 size={16} className="text-primary" />
                Calibration manuelle d’un modèle
              </h3>
            </div>
            <div className="card-body">
              <p className="text-secondary small">
                Ajustez un prix API ou un nouveau score ARC-AGI dès sa publication avant la prochaine synchronisation automatique.
              </p>

              <div className="mb-3">
                <label className="form-label">Modèle cible</label>
                <select
                  className="form-select"
                  value={selectedModelId}
                  onChange={(e) => loadModelIntoEditor(e.target.value)}
                >
                  {dataset.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              {selectedModel && (
                <>
                  <div className="row g-3 mb-3">
                    <div className="col-sm-6">
                      <label className="form-label small">
                        Prix Input ($/1M) · Actuel {formatUsd(selectedModel.inputPricePer1M)}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control font-mono"
                        placeholder={String(selectedModel.inputPricePer1M)}
                        value={inPrice}
                        onChange={(e) => setInPrice(e.target.value)}
                      />
                    </div>
                    <div className="col-sm-6">
                      <label className="form-label small">
                        Prix Output ($/1M) · Actuel {formatUsd(selectedModel.outputPricePer1M)}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control font-mono"
                        placeholder={String(selectedModel.outputPricePer1M)}
                        value={outPrice}
                        onChange={(e) => setOutPrice(e.target.value)}
                      />
                    </div>
                    <div className="col-sm-6">
                      <label className="form-label small">
                        Score ARC-AGI-2 (%) · Actuel {selectedModel.benchmarks.arc_agi_2?.score ?? '—'}%
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        className="form-control font-mono"
                        placeholder={String(selectedModel.benchmarks.arc_agi_2?.score ?? '')}
                        value={arc2Score}
                        onChange={(e) => setArc2Score(e.target.value)}
                      />
                    </div>
                    <div className="col-sm-6">
                      <label className="form-label small">
                        Score ARC-AGI-3 (%) · Actuel {selectedModel.benchmarks.arc_agi_3?.score ?? '—'}%
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        className="form-control font-mono"
                        placeholder={String(selectedModel.benchmarks.arc_agi_3?.score ?? '')}
                        value={arc3Score}
                        onChange={(e) => setArc3Score(e.target.value)}
                      />
                    </div>
                  </div>

                  <button
                    className="btn btn-primary d-inline-flex align-items-center gap-2"
                    onClick={handleSaveManual}
                    disabled={saving}
                  >
                    <Save size={15} />
                    {saving ? 'Enregistrement...' : 'Enregistrer la calibration'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
