export type GroveMaterial = 'seed' | 'amber' | 'moonstone';
export type FoxSkin = 'ember' | 'snow' | 'dusk' | 'sun';
export type GroveHome = 'burrow' | 'treehouse' | 'observatory';
export interface FocusSession {
  id: string;
  minutes: number;
  label: string;
  startedAt: number;
  endsAt: number | null;
  remainingMs: number;
  status: 'running' | 'paused';
}
export interface GroveReward {
  sessionId: string;
  label: string;
  minutes: number;
  acorns: number;
  material: GroveMaterial;
  quantity: number;
  finishedAt: number;
}
export interface GroveState {
  version: number;
  acorns: number;
  totalMinutes: number;
  completedSessions: number;
  materials: Record<GroveMaterial, number>;
  owned: string[];
  skin: FoxSkin;
  home: GroveHome;
  decorations: string[];
  session: FocusSession | null;
  lastReward: GroveReward | null;
  history: GroveReward[];
}
export type GroveInput =
  | { type: 'start'; minutes: number; label: string }
  | { type: 'pause' | 'resume' | 'claim' | 'cancel'; sessionId: string }
  | { type: 'buy'; itemId: string }
  | { type: 'equip'; itemId: string; enabled: boolean };
export type GroveAction = GroveInput & { actionId: string; expectedVersion: number };
export interface GroveView {
  state: GroveState;
  loaded: boolean;
  busy: boolean;
  error: string;
  offline: boolean;
  pending: boolean;
  serverNow: number;
  observedAt: number;
}
