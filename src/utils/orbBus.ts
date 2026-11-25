export interface OrbSignalDetail {
  type: 'pin' | 'scope' | 'tab' | 'simulate' | 'harvest-start' | 'harvest-done' | 'calibrate' | 'click';
  color?: string;
  intensity?: number; // 0.5 .. 2.5
  label?: string;
}

export function emitOrbSignal(detail: OrbSignalDetail): void {
  window.dispatchEvent(new CustomEvent<OrbSignalDetail>('aether:orb', { detail }));
}
