"use client";

import { motion } from "framer-motion";
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownLeft, Shield } from "lucide-react";
import { ethers } from "ethers";

interface OverviewProps {
  accountData: any;
  vaultStats: any;
}

const colorClasses: Record<string, { bg: string; icon: string }> = {
  blue:    { bg: "bg-blue-500/10",    icon: "text-blue-500" },
  green:   { bg: "bg-green-500/10",   icon: "text-green-500" },
  purple:  { bg: "bg-purple-500/10",  icon: "text-purple-500" },
  emerald: { bg: "bg-emerald-500/10", icon: "text-emerald-500" },
};

export default function Overview({ accountData, vaultStats }: OverviewProps) {
  const stats = [
    {
      title: "Your Balance",
      value: accountData ? `${ethers.formatEther(accountData.totalBalance)} ETH` : "0.00 ETH",
      subValue: accountData ? `${ethers.formatEther(accountData.principal)} ETH Principal` : "0.00 ETH",
      icon: Wallet,
      color: "blue",
    },
    {
      title: "Your Profits",
      value: accountData ? `${ethers.formatEther(accountData.claimableProfit)} ETH` : "0.00 ETH",
      subValue: "Ready to claim",
      icon: TrendingUp,
      color: "green",
    },
    {
      title: "Vault Performance",
      value: vaultStats ? `15% Fee` : "15% Fee",
      subValue: "Performance sharing model",
      icon: Shield,
      color: "purple",
    },
    {
      title: "Total Lifetime Earnings",
      value: accountData ? `${ethers.formatEther(accountData.totalWithdrawn)} ETH` : "0.00 ETH",
      subValue: "Cumulative profit withdrawn",
      icon: ArrowUpRight,
      color: "emerald",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-colors"
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`p-3 rounded-lg ${colorClasses[stat.color].bg}`}>
              <stat.icon className={`w-6 h-6 ${colorClasses[stat.color].icon}`} />
            </div>
          </div>
          <h3 className="text-gray-400 text-sm font-medium mb-1 font-outfit uppercase tracking-wider">{stat.title}</h3>
          <p className="text-2xl font-bold text-white mb-1 font-inter">{stat.value}</p>
          <p className="text-xs text-gray-500">{stat.subValue}</p>
        </motion.div>
      ))}
    </div>
  );
}
