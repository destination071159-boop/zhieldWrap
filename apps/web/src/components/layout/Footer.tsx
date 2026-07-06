export function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <span className="text-zama-400 text-base">⬡</span>
            <span className="font-semibold text-gray-400">ZhieldWrap</span>
            <span className="text-gray-700">·</span>
            <span>Confidential Wrapper Registry</span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-5">
            <a
              href="https://docs.zama.ai/fhevm"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              Zama Docs
            </a>
            <a
              href="https://sepolia.etherscan.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              Sepolia Explorer
            </a>
            <a
              href="https://github.com/destination071159-boop/zhieldWrap"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
          </div>

          {/* Network badge */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
            <span>Sepolia · chainId 11155111</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
