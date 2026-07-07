import { NavLink } from "react-router-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

interface NavItem {
  to: string;
  label: string;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/registry",     label: "Registry",      badge: "Official" },
  { to: "/wrap",         label: "Wrap / Unwrap"  },
  { to: "/dashboard",    label: "Dashboard"      },
  { to: "/decrypt",      label: "Decrypt Any"    },
  { to: "/faucet",       label: "Faucet"         },
  { to: "/cross-swap",   label: "Cross Swap"     },
  { to: "/private-swap", label: "Privacy Swap",       badge: "ZK" },
  { to: "/pool",         label: "Privacy Pool",  badge: "FHE" },
];

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Sidebar() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 min-h-screen border-r border-gray-800 bg-gray-950 pt-4 pb-6 px-3">
      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 flex-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-zama-900/40 text-zama-400 border border-zama-800/40"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"
              }`
            }
          >
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zama-900/60 text-zama-400 border border-zama-800/50">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: wallet + network */}
      <div className="mt-4 px-2 flex flex-col gap-3">
        {isConnected && address ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-mono truncate">{shortenAddress(address)}</span>
            </div>
            <button
              onClick={() => disconnect()}
              className="text-xs text-gray-500 hover:text-gray-300 text-left transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="btn-primary text-xs py-1.5 w-full"
          >
            Connect Wallet
          </button>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-600" />
          Sepolia Testnet
        </div>
      </div>
    </aside>
  );
}
