"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { ArrowUpRight, ArrowDownLeft, Loader2 } from "lucide-react";

interface VaultActionsProps {
  vaultContract: any;
  account: string;
  accountData: any;
  onRefresh: () => void;
}

export default function VaultActions({ vaultContract, account, accountData, onRefresh }: VaultActionsProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawProfit, setWithdrawProfit] = useState("");
  const [withdrawPrincipal, setWithdrawPrincipal] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;

    setLoading("depositing");
    setError(null);
    try {
      const tx = await vaultContract.deposit({
        value: ethers.parseEther(depositAmount)
      });
      await tx.wait();
      setDepositAmount("");
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.reason || "Deposit failed");
    } finally {
      setLoading(null);
    }
  };

  const handleWithdrawRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("requesting");
    setError(null);
    try {
      const profit = withdrawProfit ? ethers.parseEther(withdrawProfit) : BigInt(0);
      const principal = withdrawPrincipal ? ethers.parseEther(withdrawPrincipal) : BigInt(0);
      
      const tx = await vaultContract.requestWithdrawal(profit, principal);
      await tx.wait();
      setWithdrawProfit("");
      setWithdrawPrincipal("");
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.reason || "Withdrawal request failed");
    } finally {
      setLoading(null);
    }
  };

  const handleWithdrawAll = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("withdrawing_all");
    setError(null);
    try {
      const tx = await vaultContract.withdrawAll();
      await tx.wait();
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.reason || "Withdraw-all failed");
    } finally {
      setLoading(null);
    }
  };

  const handleExecuteWithdrawal = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("executing");
    setError(null);
    try {
      const tx = await vaultContract.executeWithdrawal();
      await tx.wait();
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.reason || "Execution failed");
    } finally {
      setLoading(null);
    }
  };

  const handleCancelWithdrawal = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("cancelling");
    setError(null);
    try {
      const tx = await vaultContract.cancelWithdrawal();
      await tx.wait();
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.reason || "Cancellation failed");
    } finally {
      setLoading(null);
    }
  };

  const isWithdrawable = () => {
    if (!accountData?.reqActive) return false;
    const now = Math.floor(Date.now() / 1000);
    const readyAt = Number(accountData.reqTimestamp) + (12 * 3600);
    return now >= readyAt;
  };

  const contractReady = !!vaultContract;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {!contractReady && (
        <div className="lg:col-span-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 p-4 rounded-xl text-sm text-center">
          Vault contract not connected — start the backend or set <code className="font-mono">NEXT_PUBLIC_VAULT_ADDRESS</code> in <code className="font-mono">.env.local</code>.
        </div>
      )}
      {/* Deposit Card */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-8"
      >
        <div className="flex items-center gap-3 mb-6 font-outfit text-xl font-semibold text-white">
          <ArrowUpRight className="text-blue-500" />
          Deposit Funds
        </div>
        <form onSubmit={handleDeposit} className="space-y-4">
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Amount (ETH)</label>
            <input
              type="number"
              step="0.001"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="0.0"
              disabled={!contractReady || loading !== null || accountData?.isFrozen}
            />
          </div>
          <button
            type="submit"
            disabled={!contractReady || loading !== null || accountData?.isFrozen}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {loading === "depositing" ? <Loader2 className="animate-spin" /> : accountData?.isFrozen ? "Account Frozen" : "Deposit ETH"}
          </button>
        </form>
      </motion.div>

      {/* Withdraw Card */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-8"
      >
        <div className="flex items-center gap-3 mb-6 font-outfit text-xl font-semibold text-white">
          <ArrowDownLeft className="text-emerald-500" />
          Withdraw Funds
        </div>

        {accountData?.reqActive ? (
          <div className="space-y-6">
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl">
              <h4 className="text-blue-400 font-semibold mb-1">Pending Request</h4>
              <p className="text-gray-400 text-sm">
                {ethers.formatEther(accountData.reqProfit)} ETH Profit + {ethers.formatEther(accountData.reqPrincipal)} ETH Principal
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs font-mono text-blue-300">
                {isWithdrawable() ? (
                  <span className="text-emerald-400">READY TO WITHDRAW</span>
                ) : (
                  <span>CHALLENGE PERIOD ACTIVE (12H)</span>
                )}
              </div>
            </div>
            
            <div className="flex gap-4">
              {isWithdrawable() && (
                <button
                  onClick={handleExecuteWithdrawal}
                  disabled={!contractReady || loading !== null}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  {loading === "executing" ? <Loader2 className="animate-spin" /> : "Complete Withdrawal"}
                </button>
              )}
              <button
                onClick={handleCancelWithdrawal}
                disabled={!contractReady || loading !== null}
                className="flex-1 bg-transparent border border-red-500 text-red-500 hover:bg-red-500/10 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                {loading === "cancelling" ? <Loader2 className="animate-spin" /> : "Cancel Request"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleWithdrawRequest} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-gray-400 text-sm mb-2 block">Profit (ETH)</label>
                <input
                  type="number"
                  step="0.001"
                  value={withdrawProfit}
                  onChange={(e) => setWithdrawProfit(e.target.value)}
                  className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="0.0"
                  disabled={!contractReady || loading !== null || accountData?.isFrozen}
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-2 block">Principal (ETH)</label>
                <input
                  type="number"
                  step="0.001"
                  value={withdrawPrincipal}
                  onChange={(e) => setWithdrawPrincipal(e.target.value)}
                  className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="0.0"
                  disabled={!contractReady || loading !== null || accountData?.isFrozen}
                />
              </div>
            </div>
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={!contractReady || loading !== null || accountData?.isFrozen}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loading === "requesting" ? <Loader2 className="animate-spin" /> : "Request Withdrawal"}
              </button>
              <button
                type="button"
                onClick={handleWithdrawAll}
                disabled={!contractReady || loading !== null || accountData?.isFrozen}
                className="flex-1 bg-transparent border border-emerald-600 text-emerald-500 hover:bg-emerald-600/10 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loading === "withdrawing_all" ? <Loader2 className="animate-spin" /> : "Withdraw All"}
              </button>
            </div>
          </form>
        )}
      </motion.div>
      {error && (
        <div className="lg:col-span-2 bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-center">
          {error}
        </div>
      )}
    </div>
  );
}
