import { create } from "zustand";
import type { AssetQuery, Job, AggregationMode } from "../../shared/types";
type Page =
  | "library"
  | "dashboard"
  | "sources"
  | "tasks"
  | "settings"
  | "material"
  | "generation"
  | "families";
interface Store {
  page: Page;
  query: AssetQuery;
  selected: string[];
  activeId: string | null;
  aggregationMode: AggregationMode | "";
  setAggregationMode: (mode: AggregationMode | "") => void;
  epoch: number;
  jobs: Job[];
  notice: { text: string; error: boolean } | null;
  setPage: (p: Page) => void;
  setQuery: (q: AssetQuery) => void;
  setSelection: (ids: string[], active?: string | null) => void;
  refresh: () => void;
  notify: (text: string, error?: boolean) => void;
  updateJob: (j: Job) => void;
}
export const useStore = create<Store>((set, get) => ({
  page: "library",
  query: { sort: "newest" },
  selected: [],
  activeId: null,
  aggregationMode: "",
  setAggregationMode: (aggregationMode) =>
    set({ aggregationMode, selected: [], activeId: null }),
  epoch: 0,
  jobs: [],
  notice: null,
  setPage: (page) => set({ page }),
  setQuery: (query) =>
    set({ page: "library", query, selected: [], activeId: null }),
  setSelection: (selected, active) =>
    set({ selected, ...(active !== undefined ? { activeId: active } : {}) }),
  refresh: () => set({ epoch: get().epoch + 1 }),
  notify: (text, error = false) => {
    set({ notice: { text, error } });
    setTimeout(() => {
      if (get().notice?.text === text) set({ notice: null });
    }, 6000);
  },
  updateJob: (job) =>
    set({
      jobs: [job, ...get().jobs.filter((j) => j.id !== job.id)].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    }),
}));
export const call = <T = any>(method: string, input: any = {}) =>
  window.workshop.call<T>(method, input);
export const report = (error: any) =>
  useStore.getState().notify(error?.message ?? String(error), true);
export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024,
    i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
export const assetURL = (packageId: string, revisionId: string, p: string) =>
  `workshop://assets/${packageId}/${revisionId}/source/${p.split("/").map(encodeURIComponent).join("/")}`;
