/**
 * The filtered dataset every screen renders from. Applies the top-bar filters
 * to the store's dataset, memoized so re-aggregation only runs when the dataset
 * or a filter changes.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Dataset } from "@core/views";
import { useAppStore } from "../app/store";
import { applyFilters } from "./filter";

export function useDataset(): Dataset {
  const { dataset, agentFilter, repo, dateRange, search } = useAppStore(
    useShallow((s) => ({
      dataset: s.dataset,
      agentFilter: s.agentFilter,
      repo: s.repo,
      dateRange: s.dateRange,
      search: s.search,
    }))
  );
  return useMemo(
    () => applyFilters(dataset, { agentFilter, repo, dateRange, search }),
    [dataset, agentFilter, repo, dateRange, search]
  );
}
