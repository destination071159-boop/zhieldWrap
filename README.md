# ZhieldWrap — Confidential Wrapper Registry

A production-ready dApp that turns the [Zama Wrappers Registry](https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia#wrappers-registry) into a usable product for every developer and user in the FhEVM ecosystem.

**Live URL:** https://zhieldwrap.vercel.app  
**GitHub:** https://github.com/yourusername/zhieldwrap  
**Network:** Sepolia Testnet (chainId: 11155111)

---

## Features

| Feature | Description |
|---------|-------------|
| **Registry Browser** | Browse all official ERC-20 ↔ ERC-7984 pairs from the onchain Zama registry + local custom pairs |
| **Wrap** | ERC-20 → ERC-7984 with automatic approval flow |
| **Unwrap** | ERC-7984 → ERC-20 |
| **Balance Dashboard** | View ERC-20 and encrypted ERC-7984 balances across all pairs |
| **Decrypt Any** | Decrypt the balance of ANY ERC-7984 token by address (paste-an-address flow) |
| **Faucet** | Claim official cTokenMock test tokens on Sepolia |

---

## How to Add New ERC-20 ↔ ERC-7984 Pairs

The registry uses a **hybrid source** approach:

1. **Primary:** Official onchain [Zama Wrappers Registry](https://sepolia.etherscan.io/address/0x2f0750Bbb0A246059d80e94c454586a7F27a128e) — auto-loaded at startup
2. **Secondary:** Local config file (`packages/core/src/pairs.config.ts`) — you manage

### Adding a Custom Pair (Local Config)

Open `packages/core/src/pairs.config.ts` and add your pair to the `LOCAL_PAIRS` array:

```typescript
// packages/core/src/pairs.config.ts
export const LOCAL_PAIRS: RegistryPair[] = [
  {
    id: "custom-1",                                         // unique ID
    erc20Address:   "0xYourERC20ContractAddressOnSepolia",  // ERC-20 token
    erc7984Address: "0xYourERC7984ContractAddressOnSepolia",// ERC-7984 wrapper
    name: "My Dev Token",                                   // display name
    symbol: "cMYT",                                        // wrapped symbol (starts with "c")
    underlyingSymbol: "MYT",                               // underlying symbol
    decimals: 18,                                          // must match ERC-20 decimals
    isActive: true,
    isOfficial: false,   // always false for local config pairs
    isCustom: true,      // always true for local config pairs
    hasFaucet: false,    // set true only if the ERC-20 has a public mint() function
    createdAt: 0,
    docsUrl: "https://your-docs-url.com"  // optional
  }
];
```

**Requirements for a valid pair:**
- Both contracts must be deployed on **Sepolia** (chainId: 11155111)
- `erc20Address` — a standard ERC-20 token
- `erc7984Address` — an ERC-7984 wrapper for that ERC-20 ([Zama standard](https://docs.zama.org))
- `symbol` — must conventionally start with `"c"` (e.g. `"cMYT"` wraps `"MYT"`)
- `decimals` — must match the underlying ERC-20's decimals

**After adding your pair:**
1. Commit the change
2. Redeploy: `pnpm build && vercel deploy`
3. Your pair appears in the registry labeled **"⚠ Custom"** (yellow badge)

> Custom pairs never override official onchain pairs. If a local pair shares an `erc20Address` with an official pair, the official pair wins.

### Getting a Pair Added to the Official Registry

To have your pair listed as **"✓ Official"** (from the onchain Zama registry):
1. Deploy your ERC-7984 wrapper following Zama's standard
2. Submit a PR / request to the Zama team to register it onchain
3. Once registered, it auto-appears in this app on the next registry fetch (every 30 seconds)

---

## Official Sepolia Pairs

Registry contract: [`0x2f0750Bbb0A246059d80e94c454586a7F27a128e`](https://sepolia.etherscan.io/address/0x2f0750Bbb0A246059d80e94c454586a7F27a128e)

Source: [Zama Docs — Testnet Addresses](https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia#wrappers-registry)

| Symbol | ERC-7984 Wrapper | ERC-20 Underlying | Faucet |
|--------|-----------------|-------------------|--------|
| cUSDCMock | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` | `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` | ✅ Public mint |
| cUSDTMock | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` | `0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0` | ✅ Public mint |
| cWETHMock | `0x46208622DA27d91db4f0393733C8BA082ed83158` | `0xff54739b16576FA5402F211D0b938469Ab9A5f3F` | ✅ Public mint |
| cBRONMock | `0xaa5612FA27c927a0c7961f5AEFEE5ba3A0F9C891` | `0xFf021fB13cA64e5354c62c954b949a88cfDEb25E` | ✅ Public mint |
| cZAMAMock | `0xf2D628d2598aF4eAF94CB76a437Ff86CA78FfbFB` | `0x75355a85c6FB9df5f0C80FF54e8747EEe9a0BF57` | ✅ Public mint |
| ctGBPMock | `0xfCE5c7069c5525eF6c8C2b2E35A745bA20a2F7CC` | `0x93c931278A2aad1916783F952f94276eA5111442` | ✅ Public mint |
| cXAUtMock | `0xe4FcF848739845BC81Dee1d5352cf3844F0a60C7` | `0x24377AE4AA0C45ecEe71225007f17c5D423dd940` | ✅ Public mint |
| ctGBP | `0x167DC962808B32CFFFc7e14B5018c0bE06A3A208` | `0xf6Ef9ADB61A48E29E36bc873070A46A3D2667ff3` | ❌ Restricted mint |

---

## Setup (Local Development)

### Prerequisites
- [pnpm](https://pnpm.io) v8+
- Node.js 20+
- A browser wallet (MetaMask) on Sepolia

### Install & Run

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/zhieldwrap
cd zhieldwrap

# 2. Install all dependencies (workspace-wide)
pnpm install

# 3. Configure environment
cp apps/web/.env.example apps/web/.env
# Edit .env if you want a custom Sepolia RPC or WalletConnect project ID

# 4. Start development server
pnpm dev
# Opens: http://localhost:5173
```

### Environment Variables (`apps/web/.env`)

```env
# Optional — defaults to public Sepolia RPC
VITE_SEPOLIA_RPC=https://rpc.sepolia.org

# Optional — for WalletConnect support (get one free at cloud.walletconnect.com)
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Build for Production

```bash
pnpm build
# Output: apps/web/dist/
```

---

## Architecture

```
zhieldwrap/
├── apps/
│   └── web/                    # Vite + React 18 + TypeScript dApp
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Registry.tsx      # Browse onchain + local pairs
│       │   │   ├── Wrap.tsx          # Wrap (ERC-20 → ERC-7984) / Unwrap
│       │   │   ├── Dashboard.tsx     # Balance dashboard + EIP-712 decrypt
│       │   │   ├── DecryptAny.tsx    # Decrypt any ERC-7984 by address
│       │   │   └── Faucet.tsx        # Claim cTokenMock test tokens
│       │   ├── components/
│       │   │   ├── layout/Navbar.tsx
│       │   │   ├── shared/NetworkGuard.tsx
│       │   │   └── ui/              # PairCard, TxStatusModal, etc.
│       │   ├── hooks/
│       │   │   ├── useRegistry.ts   # Fetches + filters pairs
│       │   │   ├── useWrap.ts       # Manages approval → wrap flow
│       │   │   ├── useFaucet.ts     # Manages mint() calls
│       │   │   └── useDecryptAny.ts # Validates + loads any ERC-7984 token
│       │   └── main.tsx             # WagmiProvider + QueryClientProvider
│       └── vite.config.ts
│
└── packages/
    └── core/                    # Shared logic (used by web)
        └── src/
            ├── types.ts          # Shared TypeScript interfaces
            ├── constants.ts      # Addresses, OFFICIAL_PAIRS fallback
            ├── pairs.config.ts   # ← LOCAL custom pairs go here
            ├── registry.ts       # Hybrid fetch (onchain + local config)
            ├── wrap.ts           # ERC-20 approval + wrap/unwrap
            ├── fhe.ts            # ERC-7984 handle fetch + validation
            └── faucet.ts         # mint() + localStorage cooldown
```

### Data Flow: Hybrid Registry

```
fetchAllPairs()
    │
    ├─ [Primary] Call getAllPairs() on registry contract (0x2f0750...)
    │     └─ Map to RegistryPair[] with isOfficial: true
    │
    ├─ [Fallback] On RPC failure → use OFFICIAL_PAIRS from constants.ts
    │
    └─ [Secondary] Merge with LOCAL_PAIRS from pairs.config.ts
          - Filter out any local pair with same erc20Address as official pair
          - Mark remaining as isOfficial: false, isCustom: true
          - Return [...officialPairs, ...customPairs]
```

### EIP-712 Balance Decryption Flow

The app uses `@zama-fhe/react-sdk`'s `useUserDecrypt` hook to decrypt ERC-7984 balances:

```
1. Read bytes32 handle from ERC-7984 contract (getHandle / balanceOf)
2. useUserDecrypt({ handles: [{ handle, contractAddress }] })
   └─ SDK generates EIP-712 typed data message
3. MetaMask prompts user to sign the message
4. SDK sends signature to Zama KMS gateway
5. Gateway decrypts and returns plaintext balance
6. Balance displayed in the UI
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS |
| Blockchain | ethers.js v6, Wagmi v2 |
| FHE | @zama-fhe/react-sdk 2.5.0, EIP-712 |
| Data fetching | @tanstack/react-query |
| Routing | react-router-dom v6 |
| Deployment | Vercel |

---

## Error Handling

The app handles these error cases explicitly:

| Error | Handling |
|-------|---------|
| Wrong network | `NetworkGuard` redirects with "Switch to Sepolia" button |
| Insufficient balance | Checked before wrap, shown in UI before sending tx |
| Missing approval | Auto-detected; approval tx sent first |
| User rejected tx | Caught by `ACTION_REJECTED` error code; shown in modal |
| Registry RPC failure | Falls back to hardcoded `OFFICIAL_PAIRS` in `constants.ts` |
| Invalid ERC-7984 address | Validated by `validateERC7984Contract()` before decrypting |
| No contract at address | `getCode()` check returns "0x" → shown as error |

---

## Security

- No private keys are ever stored or transmitted
- EIP-712 decryption signatures are signed in the user's own wallet
- Zama's KMS gateway decrypts using the user's public key — plaintext never touches our server
- Custom pairs are local-config only — no permissionless onchain registration
- All contract interactions use ethers.js v6 with type-safe ABIs

---

## License

MIT
