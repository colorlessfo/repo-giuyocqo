export interface FocusSession {
  id: string;
  label: string;
  minutes: number;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  startedAt: number;
  endedAt: number | null;
  endsAt: number | null;
  runStartedAt: number | null;
  remainingMs: number;
  segments: { start: number; end: number }[];
}
export interface FocusSnapshot {
  profile: { version: number; active: FocusSession | null };
  records: FocusSession[];
  serverNow: number;
  timezone: string;
  stats: {
    totalMs: number;
    completedSessions: number;
    cancelledSessions: number;
    completedMs: number;
    days: { date: string; focusedMs: number; completedSessions: number }[];
    periods: { label: string; focusedMs: number }[];
  };
}
export type FocusInput =
  | { type: 'start'; minutes: number; label: string }
  | { type: 'pause' | 'resume' | 'finish' | 'cancel'; sessionId: string };
export type FocusAction = FocusInput & { actionId: string; expectedVersion: number };
export interface FocusView {
  data: FocusSnapshot;
  loaded: boolean;
  busy: boolean;
  pending: boolean;
  error: string;
  offline: boolean;
  observedAt: number;
}
