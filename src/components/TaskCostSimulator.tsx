import { useMemo, useState } from 'react';
import { Calculator, Zap } from 'lucide-react';
import { LLMModel, ProviderMeta } from '../../shared/types.ts';
import { formatUsd, simulateTaskCost } from '../../shared/metrics.ts';
import { emitOrbSignal } from '../utils/orbBus.ts';

interface TaskCostSimulatorProps {
  models: LLMModel[];
  providers: ProviderMeta[];
}

const PRESETS = [
  { label: 'Requête standard', input: 4000, output: 1200, turns: 1 },
  { label: 'Ticket SWE-bench', input: 32000, output: 4500, turns: 8 },
  { label: 'Agent ARC-AGI-3', input: 24000, output: 8000, turns: 18 },
];

export function TaskCostSimulator({ models, providers }: TaskCostSimulatorProps) {
  const [inputTokens, setInputTokens] = useState(32000);
  const [outputTokens, setOutputTokens] = useState(4500);
  const [turns, setTurns] = useState(8);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const ranked = useMemo(() => {
    return models
      .map((m) => {
        const cost = simulateTaskCost(m, inputTokens, outputTokens, turns);
        const estSeconds = Math.round(
          (outputTokens * turns) / Math.max(m.speedTokPerSec, 1) +
            (m.latencyTtftMs / 1000) * turns
        );
        return { model: m, cost, estSeconds };
      })
      .sort((a, b) => a.cost - b.cost);
  }, [models, inputTokens, outputTokens, turns]);

  const maxCost = Math.max(...ranked.map((r) => r.cost), 0.001);

  return (
    <div className="card">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h3 className="card-title d-flex align-items-center gap-2 mb-0">
            <Calculator size={16} className="text-primary" />
            Simulateur de coût par tâche
          </h3>
          <div className="text-secondary small">
            Estimez le coût API réel et la durée de génération selon la charge de votre workflow.
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setInputTokens(p.input);
                setOutputTokens(p.output);
                setTurns(p.turns);
                emitOrbSignal({
                  type: 'simulate',
                  color: '#f59e0b',
                  intensity: 1.2,
                  label: p.label,
                });
              }}
            >
              <Zap size={13} className="me-1" />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card-body">
        <div className="row g-3 mb-3">
          <div className="col-md-4">
            <div className="p-3 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.6)' }}>
              <div className="d-flex justify-content-between small mb-1">
                <span className="text-secondary">Tokens d’entrée / tour</span>
                <span className="font-mono fw-semibold text-primary">
                  {inputTokens.toLocaleString('fr-FR')}
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min={1000}
                max={120000}
                step={1000}
                value={inputTokens}
                onChange={(e) => {
                  setInputTokens(Number(e.target.value));
                  emitOrbSignal({ type: 'simulate', color: '#3b82f6', intensity: 0.4 });
                }}
              />
            </div>
          </div>

          <div className="col-md-4">
            <div className="p-3 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.6)' }}>
              <div className="d-flex justify-content-between small mb-1">
                <span className="text-secondary">Tokens de sortie / tour</span>
                <span className="font-mono fw-semibold text-success">
                  {outputTokens.toLocaleString('fr-FR')}
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min={500}
                max={24000}
                step={500}
                value={outputTokens}
                onChange={(e) => {
                  setOutputTokens(Number(e.target.value));
                  emitOrbSignal({ type: 'simulate', color: '#10b981', intensity: 0.4 });
                }}
              />
            </div>
          </div>

          <div className="col-md-4">
            <div className="p-3 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.6)' }}>
              <div className="d-flex justify-content-between small mb-1">
                <span className="text-secondary">Étapes agentiques (tours)</span>
                <span className="font-mono fw-semibold text-warning">
                  {turns} tour{turns > 1 ? 's' : ''}
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min={1}
                max={30}
                step={1}
                value={turns}
                onChange={(e) => {
                  setTurns(Number(e.target.value));
                  emitOrbSignal({ type: 'simulate', color: '#f59e0b', intensity: 0.45 });
                }}
              />
            </div>
          </div>
        </div>

        <div className="row g-2" style={{ maxHeight: 260, overflowY: 'auto' }}>
          {ranked.map(({ model, cost, estSeconds }) => {
            const prov = providerMap.get(model.provider);
            const pct = Math.max(4, Math.round((cost / maxCost) * 100));
            return (
              <div key={model.id} className="col-sm-6 col-lg-4 col-xl-3">
                <div className="p-2 rounded border" style={{ backgroundColor: 'rgba(21,30,44,0.55)' }}>
                  <div className="d-flex justify-content-between align-items-baseline gap-2">
                    <span className="fw-medium small text-truncate">{model.name}</span>
                    <span className="font-mono fw-semibold text-warning small">{formatUsd(cost)}</span>
                  </div>
                  <div className="d-flex justify-content-between text-secondary" style={{ fontSize: '0.72rem' }}>
                    <span style={{ color: prov?.color }}>{prov?.name}</span>
                    <span className="font-mono">~{estSeconds}s</span>
                  </div>
                  <div className="progress progress-sm mt-2">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: prov?.color ?? '#3b82f6',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
