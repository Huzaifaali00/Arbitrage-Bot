export const VAULT_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 profitAmount, uint256 principalAmount)",
  "function withdrawAll()",
  "function getMyAccount() view returns (uint256 principal, uint256 pendingProfit, uint256 claimableProfit, uint256 totalBalance, bool isPaused, uint256 totalDeposited, uint256 totalWithdrawn, uint256 reqProfit, uint256 reqPrincipal, uint256 reqTimestamp, bool reqActive, bool isFrozen, address guardian)",
  "function getVaultStats() view returns (uint256 activePrincipal, uint256 pausedPrincipal, uint256 userCount, uint256 lifetimeProfitDistributed, uint256 lifetimeFeesAccrued, uint256 currentFeeBps, uint256 vaultBalance, uint256 unclaimedOperatorFees)",
  "function pauseMyFunds()",
  "function unpauseMyFunds()",
  "function requestWithdrawal(uint256 profitAmount, uint256 principalAmount)",
  "function executeWithdrawal()",
  "function cancelWithdrawal()",
  "function setGuardian(address guardian)",
  "function freezeAccount(address user)",
  "function initiateUnfreeze()",
  "function completeUnfreeze()",
  "function nominateNewOwner(address user, address newOwner)",
  "function completeRecovery(address user)",
  "function cancelRecovery()",
  "function performanceFeeBps() view returns (uint256)"
];

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
export const VAULT_ADDRESS_FALLBACK = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01';
export const APP_CHAIN = process.env.NEXT_PUBLIC_CHAIN ?? 'baseSepolia';

export function getExplorerTxBase(chain?: string): string {
  switch (chain) {
    case "base":
      return "https://basescan.org/tx";
    case "baseSepolia":
      return "https://sepolia.basescan.org/tx";
    case "arbitrum":
      return "https://arbiscan.io/tx";
    case "arbitrumSepolia":
      return "https://sepolia.arbiscan.io/tx";
    default:
      return "https://sepolia.basescan.org/tx";
  }
}
