import { create } from 'zustand';

interface SyncState {
  status: 'synced' | 'syncing' | 'offline' | 'error';
  pendingCount: number;
  lastSyncedAt: string | null;
  setStatus: (status: 'synced' | 'syncing' | 'offline' | 'error') => void;
  setPendingCount: (count: number) => void;
  setLastSyncedAt: (date: string) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'synced',
  pendingCount: 0,
  lastSyncedAt: null,
  setStatus: (status) => set({ status }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setLastSyncedAt: (date) => set({ lastSyncedAt: date })
}));
