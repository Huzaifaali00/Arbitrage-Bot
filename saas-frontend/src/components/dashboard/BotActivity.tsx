"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Zap, AlertTriangle, CheckCircle2, XCircle, Activity, Layers } from "lucide-react";
import { APP_CHAIN, BACKEND_URL, getExplorerTxBase } from "@/lib/constants";

interface BotMetrics {
  totalProfit: number;
  totalTrades: number;
  successRate: number;
  averageProfitPerTrade: number;
  totalGasCost: number;
  roi: number;
  uptime: number;
  lastTradeTime: number;
}

interface BotState {
  isRunning: boolean;
  isPaused: boolean;
  lastUpdate: number;
  metrics: BotMetrics | null;
}

interface TradeRow {
  timestamp: number;
  txHash: string;
  netProfit: number;
  gasCost: number;
  dexType: string;
  success: boolean;
  realizedTokenSymbol?: string;
  realizedDelta?: number;
  realizedUsdEquivalent?: number;
  gasCostUsd?: number;
  profitSource?: string;
}

interface DexRow {
  dexType: string;
  factory: string;
  poolCount: number;
}

function isTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function formatUptime(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatRelative(ts: number): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function formatTradePnl(trade: TradeRow): string {
  if (
    typeof trade.realizedDelta === "number" &&
    trade.realizedTokenSymbol &&
    trade.realizedTokenSymbol.length > 0
  ) {
    return `${trade.realizedDelta.toFixed(6)} ${trade.realizedTokenSymbol}`;
  }

  return `${trade.netProfit.toFixed(4)} USDC eq`;
}

function formatTradePnlDetail(trade: TradeRow): string | null {
  if (typeof trade.realizedUsdEquivalent === "number") {
    return `~${trade.netProfit.toFixed(4)} USDC eq`;
  }

  return null;
}

export default function BotActivity() {
  const [state, setState] = useState<BotState | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [dexes, setDexes] = useState<DexRow[]>([]);
  const [online, setOnline] = useState<boolean>(true);
  const [explorerBase, setExplorerBase] = useState<string>(getExplorerTxBase(APP_CHAIN));

  const poll = useCallback(async () => {
    try {
      const [sRes, tRes, dRes, cRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/bot/state`, { cache: "no-store" }),
        fetch(`${BACKEND_URL}/api/trades/recent`, { cache: "no-store" }),
        fetch(`${BACKEND_URL}/api/dexes`, { cache: "no-store" }),
        fetch(`${BACKEND_URL}/api/config`, { cache: "no-store" }),
      ]);

      if (!sRes.ok || !tRes.ok) throw new Error("backend error");

      const s: BotState = await sRes.json();
      const t: TradeRow[] = await tRes.json();
      const d: DexRow[] = dRes.ok ? await dRes.json() : [];
      const config = cRes.ok ? await cRes.json() : null;
      const chain = typeof config?.chain === "string" ? config.chain : APP_CHAIN;

      setState(s);
      setTrades(
        Array.isArray(t)
          ? t.filter((trade) => typeof trade.txHash === "string" && isTxHash(trade.txHash)).slice(0, 10)
          : [],
      );
      setDexes(Array.isArray(d) ? d : []);
      setExplorerBase(getExplorerTxBase(chain));
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [poll]);

  if (!online) {
    return (
      <div className="mt-12 bg-[#1a1c24] border border-gray-800 rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-bold">Bot Activity</h3>
        </div>
        <p className="text-gray-400 text-sm">
          Backend unreachable at {BACKEND_URL}. Start the bot with{" "}
          <code className="text-xs text-blue-400 bg-gray-800 px-2 py-0.5 rounded">
            npm start
          </code>{" "}
          inside <span className="text-gray-300">arbitrage-bot-backend/</span>.
        </p>
      </div>
    );
  }

  const metrics = state?.metrics;
  const running = state?.isRunning && !state?.isPaused;
  const statusLabel = !state?.isRunning
    ? "Stopped"
    : state.isPaused
    ? "Paused"
    : "Running";
  const statusColor = running
    ? "text-emerald-500"
    : state?.isPaused
    ? "text-amber-500"
    : "text-red-500";
  const dotColor = running
    ? "bg-emerald-500"
    : state?.isPaused
    ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div className="mt-12 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Cpu className="text-purple-500" /> Bot Activity
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <div className={`w-2 h-2 rounded-full ${dotColor} ${running ? "animate-pulse" : ""}`} />
          <span className={`${statusColor} font-semibold uppercase text-xs tracking-wider`}>
            {statusLabel}
          </span>
          <span className="text-gray-500">· uptime {formatUptime(metrics?.uptime ?? 0)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="Total Trades" value={metrics?.totalTrades ?? 0} />
        <MetricCard
          label="Success Rate"
          value={`${((metrics?.successRate ?? 0) * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Net PnL"
          value={(metrics?.totalProfit ?? 0).toFixed(4)}
          suffix="USDC eq"
          positive={(metrics?.totalProfit ?? 0) > 0}
        />
        <MetricCard
          label="Avg / Trade"
          value={(metrics?.averageProfitPerTrade ?? 0).toFixed(4)}
          suffix="USDC"
        />
        <MetricCard
          label="Gas Spent"
          value={(metrics?.totalGasCost ?? 0).toFixed(4)}
          suffix="ETH"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#1a1c24] border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" /> Recent Trades
            </h3>
            <span className="text-xs text-gray-500">last {trades.length}</span>
          </div>

          {trades.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              No trades executed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                    <th className="py-2 font-normal">Time</th>
                    <th className="py-2 font-normal">DEX</th>
                    <th className="py-2 font-normal">Tx</th>
                    <th className="py-2 font-normal text-right">Realized PnL</th>
                    <th className="py-2 font-normal text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.txHash} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-400">{formatRelative(t.timestamp)}</td>
                      <td className="py-2 text-gray-300">{t.dexType}</td>
                      <td className="py-2 font-mono text-xs">
                        <a
                          href={`${explorerBase}/${t.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          {t.txHash.slice(0, 10)}…
                        </a>
                      </td>
                      <td
                        className={`py-2 text-right font-mono ${
                          (t.realizedDelta ?? t.netProfit) > 0 ? "text-emerald-500" : "text-red-400"
                        }`}
                      >
                        <div>{formatTradePnl(t)}</div>
                        {formatTradePnlDetail(t) ? (
                          <div className="text-[11px] text-gray-500">
                            {formatTradePnlDetail(t)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        {t.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-[#1a1c24] border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Layers className="w-5 h-5 text-purple-500" /> DEXes Monitored
            </h3>
            <span className="text-xs text-gray-500">{dexes.length}</span>
          </div>

          {dexes.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              No DEXes reported. Check backend logs.
            </p>
          ) : (
            <ul className="space-y-2">
              {dexes.map((d) => (
                <li
                  key={d.dexType}
                  className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold capitalize">{d.dexType}</span>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">
                    {d.poolCount} pools
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-600 text-right">
        Last trade: {formatRelative(metrics?.lastTradeTime ?? 0)} · updated every 30s
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  positive,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-[#1a1c24] border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p
        className={`text-xl font-bold mt-1 ${
          positive ? "text-emerald-500" : "text-white"
        }`}
      >
        {value}
        {suffix && <span className="text-xs text-gray-500 font-normal ml-1">{suffix}</span>}
      </p>
    </div>
  );
}
