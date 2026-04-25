"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Zap, BarChart3, ShieldCheck, ExternalLink, Power, RefreshCcw } from "lucide-react";
import { useWeb3 } from "@/hooks/useWeb3";
import Overview from "@/components/dashboard/Overview";
import VaultActions from "@/components/dashboard/VaultActions";
import SecurityDashboard from "@/components/dashboard/SecurityDashboard";
import BotActivity from "@/components/dashboard/BotActivity";

export default function Home() {
  const { 
    account, 
    vaultContract, 
    connectWallet, 
    disconnectWallet, 
    loading, 
    error 
  } = useWeb3();

  const [accountData, setAccountData] = useState<any>(null);
  const [vaultStats, setVaultStats] = useState<any>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<"vault" | "security">("vault");

  const fetchDetails = useCallback(async () => {
    if (!vaultContract) return;
    try {
      const [acc, stats] = await Promise.all([
        vaultContract.getMyAccount(),
        vaultContract.getVaultStats()
      ]);
      
      setAccountData({
        principal: acc[0],
        pendingProfit: acc[1],
        claimableProfit: acc[2],
        totalBalance: acc[3],
        isPaused: acc[4],
        totalDeposited: acc[5],
        totalWithdrawn: acc[6],
        reqProfit: acc[7],
        reqPrincipal: acc[8],
        reqTimestamp: acc[9],
        reqActive: acc[10],
        isFrozen: acc[11],
        guardian: acc[12]
      });

      setVaultStats({
        activePrincipal: stats[0],
        pausedPrincipal: stats[1],
        userCount: stats[2],
        lifetimeProfitDistributed: stats[3],
        lifetimeFeesAccrued: stats[4],
        currentFeeBps: stats[5],
        vaultBalance: stats[6],
        unclaimedOperatorFees: stats[7]
      });
    } catch (err) {
      console.error("Failed to fetch vault state:", err);
    }
  }, [vaultContract]);

  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, [fetchDetails, refreshTrigger]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <Bot className="w-12 h-12 text-blue-500 animate-pulse" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1117] text-white">
      {/* Navigation */}
      <nav className="border-b border-gray-800 bg-[#0f1117]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight font-outfit uppercase">MEV SaaS Vault</span>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-6 text-gray-400 text-sm">
              <a href="#" className="hover:text-blue-500 transition-colors">Documentation</a>
              <a href="#" className="hover:text-blue-500 transition-colors">Stats</a>
            </div>
            {account ? (
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 bg-gray-800 rounded-full text-sm font-mono text-gray-300">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </div>
                <button 
                  onClick={disconnectWallet}
                  className="p-2 hover:bg-gray-800 rounded-full transition-colors"
                >
                  <Power className="w-5 h-5 text-red-500" />
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-full font-semibold transition-all transform hover:scale-105"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero / Landing for unauthenticated */}
      <AnimatePresence mode="wait">
        {!account ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="container mx-auto px-6 py-24 text-center"
          >
            <div className="inline-block px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-sm font-semibold mb-8">
              Protocol is Live & Earning
            </div>
            <h1 className="text-6xl md:text-8xl font-bold mb-8 font-inter tracking-tight">
              Earn Passive <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600">MEV Income</span>
            </h1>
            <p className="text-gray-400 text-xl max-w-2xl mx-auto mb-12">
              The world's first multi-tenant MEV arbitrage SaaS. Deposit ETH, let our bot hunt for arbitrage across Base and Arbitrum.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {[
                { icon: Zap, title: "High Frequency", desc: "Executing thousands of arbitrage opportunities daily." },
                { icon: BarChart3, title: "15% Fee", desc: "We only win when you win. Simple performance fee." },
                { icon: ShieldCheck, title: "Self-Custodial", desc: "Withdraw your principal and profits anytime." }
              ].map((feature, i) => (
                <div key={i} className="bg-[#1a1c24] border border-gray-800 p-8 rounded-2xl text-left hover:border-gray-700 transition-all">
                  <feature.icon className="w-10 h-10 text-blue-500 mb-6" />
                  <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="container mx-auto px-6 py-12"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                <h1 className="text-4xl font-bold mb-2 font-inter">Vault Dashboard</h1>
                <p className="text-gray-400 text-sm">Manage your capital and monitor earnings in real-time.</p>
              </div>
              <div className="flex items-center gap-2 bg-gray-800/30 p-1.5 rounded-xl border border-gray-700/50">
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === "vault" ? "bg-blue-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                >
                  Vault
                </button>
                <button
                  onClick={() => setActiveTab("security")}
                  className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === "security" ? "bg-purple-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                >
                  Security
                </button>
                <div className="w-[1px] h-4 bg-gray-700 mx-2" />
                <button
                  onClick={() => setRefreshTrigger(prev => prev + 1)}
                  className="p-2 hover:bg-gray-700 rounded-lg text-blue-400 transition-colors"
                  title="Refresh Data"
                >
                  <RefreshCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <Overview accountData={accountData} vaultStats={vaultStats} />
            
            <AnimatePresence mode="wait">
              {activeTab === "vault" ? (
                <motion.div
                  key="vault-tab"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <VaultActions 
                    vaultContract={vaultContract} 
                    account={account} 
                    accountData={accountData}
                    onRefresh={() => setRefreshTrigger(prev => prev + 1)} 
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="security-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                >
                  <SecurityDashboard 
                    vaultContract={vaultContract} 
                    account={account} 
                    accountData={accountData}
                    onRefresh={() => setRefreshTrigger(prev => prev + 1)} 
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <BotActivity />

            {/* Security Info */}
            <div className="mt-12">
              <div className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-2xl p-8">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <ShieldCheck className="text-blue-500" />
                  Security Info
                </h3>
                <ul className="space-y-3 text-sm text-gray-400">
                  <li>• Daily principal withdrawal limit: 25% per user</li>
                  <li>• Performance Fee: 15% deducted from profits only</li>
                  <li>• Timelocked contract upgrades for extra safety</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-800 py-12">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-gray-500 text-sm">
            © 2026 MEV SaaS Protocol. Built for decentralized capital growth.
          </div>
          <div className="flex items-center gap-6 text-gray-400">
            <a href="#" className="hover:text-blue-500"><ExternalLink className="w-5 h-5" /></a>
          </div>
        </div>
      </footer>
    </main>
  );
}
