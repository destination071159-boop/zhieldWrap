import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Navbar } from "./components/layout/Navbar";
import { Sidebar } from "./components/layout/Sidebar";
import { Footer } from "./components/layout/Footer";
import { NetworkGuard } from "./components/shared/NetworkGuard";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { Registry } from "./pages/Registry";
import { Wrap } from "./pages/Wrap";
import { Dashboard } from "./pages/Dashboard";
import { DecryptAny } from "./pages/DecryptAny";
import { Faucet } from "./pages/Faucet";

// Innovation-layer pages — lazy-loaded so they don't bloat the initial bundle
const PrivateSwap = lazy(() => import("./pages/PrivateSwap"));
const Pool        = lazy(() => import("./pages/Pool"));
const CrossSwap   = lazy(() => import("./pages/CrossSwap"));

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <NetworkGuard>
            <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
              <ErrorBoundary>
                <Suspense fallback={<div className="text-zinc-400 text-center py-20">Loading…</div>}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/registry" replace />} />
                    <Route path="/registry" element={<Registry />} />
                    <Route path="/wrap" element={<Wrap />} />
                    <Route path="/wrap/:pairId" element={<Wrap />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/decrypt" element={<DecryptAny />} />
                    <Route path="/faucet" element={<Faucet />} />
                    <Route path="/private-swap" element={<PrivateSwap />} />
                    <Route path="/pool" element={<Pool />} />
                    <Route path="/cross-swap" element={<CrossSwap />} />
                    <Route path="*" element={<Navigate to="/registry" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
          </NetworkGuard>
          <Footer />
        </div>
      </div>
    </div>
  );
}
