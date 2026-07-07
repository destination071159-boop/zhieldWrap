import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  fetchAllPairs,
  searchPairs,
  filterByStatus,
  filterBySource,
} from "@zhieldwrap/core";

const REGISTRY_QUERY_KEY = ["registry", "pairs"] as const;

export type SourceFilter = "all" | "official" | "custom";
export type StatusFilter = "all" | "active" | "inactive";

export function useRegistry() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const {
    data: allPairs = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: fetchAllPairs,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 3,
  });

  const filteredPairs = useMemo(() => {
    let result = allPairs;
    result = searchPairs(result, search);
    result = filterByStatus(result, statusFilter);
    result = filterBySource(result, sourceFilter);
    return result;
  }, [allPairs, search, statusFilter, sourceFilter]);

  return {
    pairs: filteredPairs,
    allPairs,
    isLoading,
    isFetching,
    error: error ? "Failed to load registry. Check your connection." : null,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    sourceFilter,
    setSourceFilter,
    refetch,
    totalCount: allPairs.length,
    filteredCount: filteredPairs.length,
    officialCount: allPairs.filter((p) => p.isOfficial).length,
    customCount: allPairs.filter((p) => p.isCustom).length,
  };
}
