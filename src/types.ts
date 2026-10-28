export type MascotKind = 'star' | 'cloud' | 'moon' | 'bunny';
export type Color = 'violet' | 'blue' | 'peach' | 'rose' | 'slate';
export interface Entity {
  id: string;
  version: number;
}
export interface Task extends Entity {
  title: string;
  notes: string;
  dueAt: string;
  durationMinutes: number;
  categoryId: string | null;
  mascot: MascotKind;
  completed: boolean;
  completedAt: string | null;
}
export interface Category extends Entity {
  name: string;
  color: Color;
}
export interface Course extends Entity {
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  startWeek: number;
  endWeek: number;
  parity: 'all' | 'odd' | 'even';
  location: string;
  exceptions: string[];
}
export interface Period {
  label: string;
  start: string;
  end: string;
}
export interface Settings extends Entity {
  semesterStart: string;
  semesterWeeks: number;
  periods: Period[];
}
export interface State {
  tasks: Task[];
  categories: Category[];
  courses: Course[];
  settings: Settings[];
  revision: number;
  versions: Record<string, number>;
}
export type Collection = 'tasks' | 'categories' | 'courses' | 'settings';
export interface Change {
  collection: Collection;
  id: string;
  expectedVersion: number;
  data: Record<string, unknown> | null;
}
export interface User {
  id: string;
  account: string;
  email?: string | null;
  name: string;
}
export interface Mutation {
  mutationId: string;
  changes: Change[];
}
export type SyncStatus =
  'loading' | 'saved' | 'syncing' | 'offline' | 'error' | 'conflict' | 'demo';
export interface StoreView {
  data: State;
  status: SyncStatus;
  error: string;
  pending: number;
  loaded: boolean;
}
