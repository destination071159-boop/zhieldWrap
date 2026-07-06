import { NavLink } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { useEffect } from "react";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function Navbar() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const isWrongNetwork = isConnected && chainId !== sepolia.id;

  // Sync connected address to localStorage so the browser extension can read it
  useEffect(() => {
    if (address) {
      localStorage.setItem("zhieldwrap:wallet-address", address);
    } else {
      localStorage.removeItem("zhieldwrap:wallet-address");
    }
  }, [address]);

  const navLinks = [
    { to: "/registry",     label: "Registry" },
    { to: "/wrap",         label: "Wrap" },
    { to: "/dashboard",    label: "Dashboard" },
    { to: "/faucet",       label: "Faucet" },
    { to: "/private-swap", label: "ZK Swap" },
    { to: "/pool",         label: "Pool" },
    { to: "/cross-swap",   label: "Cross Swap" },
    { to: "/decrypt",      label: "Decrypt" },
  ];

  return (
    <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-6">
            <NavLink to="/registry" className="flex items-center gap-2 font-bold text-lg">
              <span className="text-zama-400">⬡</span>
              <span className="text-white">ZhieldWrap</span>
            </NavLink>

            {/* Nav links — hidden on lg+ where sidebar handles navigation */}
            <div className="hidden md:flex lg:hidden items-center gap-1">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-zama-900/50 text-zama-400"
                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            {isWrongNetwork && (
              <span className="text-xs text-red-400 bg-red-900/30 border border-red-800 px-2 py-1 rounded-md">
                Wrong Network
              </span>
            )}

            {isConnected && address ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 bg-gray-800 px-3 py-1.5 rounded-lg font-mono">
                  {shortenAddress(address)}
                </span>
                <button
                  onClick={() => disconnect()}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => connect({ connector: injected() })}
                className="btn-primary"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav — only below md */}
        <div className="md:hidden pb-3 flex gap-1 flex-wrap">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-zama-900/50 text-zama-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
