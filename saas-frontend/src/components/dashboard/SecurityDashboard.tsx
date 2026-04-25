"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { Shield, Lock, Unlock, UserPlus, RefreshCcw, AlertTriangle, Loader2 } from "lucide-react";

interface SecurityDashboardProps {
  vaultContract: any;
  account: string;
  accountData: any;
  onRefresh: () => void;
}

export default function SecurityDashboard({ vaultContract, account, accountData, onRefresh }: SecurityDashboardProps) {
  const [guardianAddress, setGuardianAddress] = useState("");
  const [recoveryAddress, setRecoveryAddress] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unfreezeInitiated, setUnfreezeInitiated] = useState(false);

  const handleSetGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    if (!ethers.isAddress(guardianAddress)) {
      setError("Invalid guardian address");
      return;
    }
    setLoading("setting_guardian");
    setError(null);
    try {
      const tx = await vaultContract.setGuardian(guardianAddress);
      await tx.wait();
      setGuardianAddress("");
      onRefresh();
    } catch (err: any) {
      setError(err.reason || "Failed to set guardian");
    } finally {
      setLoading(null);
    }
  };

  const handleFreeze = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("freezing");
    setError(null);
    try {
      const tx = await vaultContract.freezeAccount(account);
      await tx.wait();
      onRefresh();
    } catch (err: any) {
      setError(err.reason || "Failed to freeze account");
    } finally {
      setLoading(null);
    }
  };

  const handleInitiateUnfreeze = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("initiating_unfreeze");
    setError(null);
    try {
      const tx = await vaultContract.initiateUnfreeze();
      await tx.wait();
      setUnfreezeInitiated(true);
      onRefresh();
    } catch (err: any) {
      setError(err.reason || "Failed to initiate unfreeze");
    } finally {
      setLoading(null);
    }
  };

  const handleCompleteUnfreeze = async () => {
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    setLoading("completing_unfreeze");
    setError(null);
    try {
      const tx = await vaultContract.completeUnfreeze();
      await tx.wait();
      onRefresh();
    } catch (err: any) {
      setError(err.reason || "Failed to complete unfreeze");
    } finally {
      setLoading(null);
    }
  };

  const handleNominateRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultContract) { setError("Vault contract not connected."); return; }
    if (!ethers.isAddress(recoveryAddress)) {
      setError("Invalid recovery address");
      return;
    }
    setLoading("nominating");
    setError(null);
    try {
      const tx = await vaultContract.nominateNewOwner(account, recoveryAddress);
      await tx.wait();
      setRecoveryAddress("");
      onRefresh();
    } catch (err: any) {
      setError(err.reason || "Failed to nominate recovery");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Account Status Card */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-8"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3 font-outfit text-xl font-semibold text-white">
              <Shield className="text-blue-500" />
              Security Status
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${accountData?.isFrozen ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"}`}>
              {accountData?.isFrozen ? "Frozen" : "Secure"}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-[#0f1117] rounded-xl border border-gray-800">
              <div>
                <p className="text-gray-400 text-sm">Guardian Protected</p>
                <p className="text-white font-mono text-xs mt-1">
                  {accountData?.guardian && accountData.guardian !== ethers.ZeroAddress ? accountData.guardian : "No Guardian Set"}
                </p>
              </div>
              {accountData?.guardian && accountData.guardian !== ethers.ZeroAddress ? 
                <Shield className="text-emerald-500 w-5 h-5" /> : 
                <AlertTriangle className="text-amber-500 w-5 h-5" />
              }
            </div>

            <div className="flex gap-4">
              {!accountData?.isFrozen ? (
                <button
                  onClick={handleFreeze}
                  disabled={loading !== null}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  <Lock className="w-4 h-4" />
                  {loading === "freezing" ? <Loader2 className="animate-spin" /> : "Emergency Freeze"}
                </button>
              ) : (
                <div className="flex-1 space-y-3">
                  <button
                    onClick={handleInitiateUnfreeze}
                    disabled={loading !== null || unfreezeInitiated}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    <Unlock className="w-4 h-4" />
                    {loading === "initiating_unfreeze" ? <Loader2 className="animate-spin" /> : "Initiate Unfreeze"}
                  </button>
                  <button
                    onClick={handleCompleteUnfreeze}
                    disabled={loading !== null}
                    className="w-full bg-transparent border border-emerald-600 text-emerald-500 hover:bg-emerald-600/10 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    {loading === "completing_unfreeze" ? <Loader2 className="animate-spin" /> : "Complete Unfreeze"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Guardian Management Card */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
           className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-8"
        >
          <div className="flex items-center gap-3 mb-6 font-outfit text-xl font-semibold text-white">
            <UserPlus className="text-purple-500" />
            Set Guardian
          </div>
          <p className="text-gray-400 text-sm mb-6">
            A guardian can freeze your account or help recover it if you lose your private key. 
            Choose a hardware wallet or a trusted friend.
          </p>
          <form onSubmit={handleSetGuardian} className="space-y-4">
            <input
              type="text"
              value={guardianAddress}
              onChange={(e) => setGuardianAddress(e.target.value)}
              className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-colors font-mono text-sm"
              placeholder="0x..."
              disabled={loading !== null}
            />
            <button
              type="submit"
              disabled={loading !== null}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
            >
              {loading === "setting_guardian" ? <Loader2 className="animate-spin" /> : "Update Guardian"}
            </button>
          </form>
        </motion.div>

        {/* Recovery Card (Visible if guardian is msg.sender or handled by guardian logic) */}
        {/* For MVP, we show nomination UI for the user to see what's happening or for the guardian to initiate */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.2 }}
           className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-8 lg:col-span-2"
        >
          <div className="flex items-center gap-3 mb-6 font-outfit text-xl font-semibold text-white">
            <RefreshCcw className="text-amber-500" />
            Account Recovery
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-sm">
             <div>
                <p className="text-gray-300 font-medium mb-2">How it works:</p>
                <ul className="text-gray-500 space-y-2 list-disc pl-4">
                  <li>Guardian nominates a new owner address.</li>
                  <li>7-day timelock begins to prevent theft.</li>
                  <li>You can cancel recovery anytime if it's unauthorized.</li>
                  <li>After 7 days, the guardian finalizes the transfer.</li>
                </ul>
             </div>
             <div>
                <label className="text-gray-400 text-sm mb-2 block">Nominate New Owner (Only if Guardian)</label>
                <form onSubmit={handleNominateRecovery} className="space-y-4">
                  <input
                    type="text"
                    value={recoveryAddress}
                    onChange={(e) => setRecoveryAddress(e.target.value)}
                    className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors font-mono text-sm"
                    placeholder="New Owner Address 0x..."
                    disabled={loading !== null}
                  />
                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                  >
                    {loading === "nominating" ? <Loader2 className="animate-spin" /> : "Nominate New Account"}
                  </button>
                </form>
             </div>
          </div>
        </motion.div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-center">
          {error}
        </div>
      )}
    </div>
  );
}
