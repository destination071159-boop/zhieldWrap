
import { useRegistry } from "../hooks/useRegistry";
import { PairCard } from "../components/ui/PairCard";
import { PairCardSkeleton } from "../components/ui/PairCardSkeleton";

export function Registry() {
  const {
    pairs,
    isLoading,
    isFetching,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    sourceFilter,
    setSourceFilter,
    refetch,
    totalCount,
    filteredCount,
    officialCount,
    customCount,
  } = useRegistry();

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Wrapper Registry</h1>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary text-xs py-1 px-3"
          >
            {isFetching ? "Refreshing..." : "↺ Refresh"}
          </button>
        </div>
        <p className="text-gray-400 text-sm max-w-2xl">
          Official ERC-20 ↔ ERC-7984 wrapper pairs from the{" "}
          <a
            href="https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia#wrappers-registry"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zama-400 hover:text-zama-300 underline"
          >
            Zama Wrappers Registry
          </a>{" "}
          on Sepolia.
        </p>
        <div className="flex gap-4 mt-3 text-xs text-gray-500">
          <span>{totalCount} total pairs</span>
          {officialCount > 0 && <span>{officialCount} official</span>}
          {customCount > 0 && <span>{customCount} custom</span>}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name, symbol, or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field flex-1"
        />

        <div className="flex gap-2">
          {/* Source filter */}
          <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-1 gap-1">
            {(["all", "official", "custom"] as const).map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  sourceFilter === src
                    ? "bg-zama-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {src.charAt(0).toUpperCase() + src.slice(1)}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-1 gap-1">
            {(["all", "active", "inactive"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === st
                    ? "bg-zama-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results count */}
      {!isLoading && !error && (
        <div className="text-xs text-gray-500 mb-4">
          Showing {filteredCount} of {totalCount} pairs
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="card border-red-900/50 bg-red-950/30 text-center py-8 mb-6">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-red-400 font-medium mb-1">Failed to load registry</p>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <button onClick={() => refetch()} className="btn-primary mx-auto">
            Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <PairCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Pairs grid */}
      {!isLoading && !error && pairs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pairs.map((pair) => (
            <PairCard key={pair.id} pair={pair} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && pairs.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-gray-400 font-medium">No pairs found</p>
          <p className="text-gray-600 text-sm mt-1">
            Try adjusting your search or filters
          </p>
          <button
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setSourceFilter("all");
            }}
            className="btn-secondary mt-4"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Registry contract info */}
      <div className="mt-10 p-4 bg-gray-900/50 border border-gray-800 rounded-xl text-xs text-gray-500">
        <div className="font-medium text-gray-400 mb-1">Registry Contract (Sepolia)</div>
        <a
          href="https://sepolia.etherscan.io/address/0x2f0750Bbb0A246059d80e94c454586a7F27a128e"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-zama-400 hover:text-zama-300"
        >
          0x2f0750Bbb0A246059d80e94c454586a7F27a128e ↗
        </a>
        <p className="mt-1">
          Primary source: onchain registry. Fallback: hardcoded pairs from{" "}
          <a
            href="https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zama-400 hover:text-zama-300 underline"
          >
            Zama docs
          </a>
          .
        </p>
      </div>
    </div>
  );
}
