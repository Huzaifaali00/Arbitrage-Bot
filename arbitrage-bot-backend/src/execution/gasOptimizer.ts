import { ethers } from 'ethers';
import { GasMetrics, ArbitrageOpportunity } from '../types';
import logger from '../utils/logger';
import config from '../config';

export interface GasOptimizerConfig {
  maxGasPriceGwei: number;
  minProfitBps: number; // basis points (20 = 0.20%)
  dailyLossLimit: number; // in USD or base token
  gasMultiplier: number; // multiply estimated gas by this for safety margin
}

interface DailyStats {
  totalProfit: number;
  totalLoss: number;
  totalGasCost: number;
  tradeCount: number;
  resetTime: number;
}

export class GasOptimizer {
  private provider: ethers.JsonRpcProvider;
  private config: GasOptimizerConfig;
  private dailyStats: DailyStats;
  private lastResetTime: number;

  // DEX-specific gas cost estimates (in wei per transaction)
  private dexGasCosts = {
    uniswapv3: 100000n, // ~100k gas
    curve: 80000n, // ~80k gas (simpler)
    balancer: 120000n, // ~120k gas (more complex)
    dydx: 150000n, // ~150k gas (flash loan)
  };

  // Circuit breaker thresholds
  private circuitBreakerThresholds = {
    consecutiveFailures: 5,
    hourlyLossLimit: 0.1, // 10% of daily limit per hour
  };

  private consecutiveFailures = 0;

  constructor(rpcUrl: string, config: GasOptimizerConfig) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.config = config;
    this.lastResetTime = Date.now();
    this.dailyStats = {
      totalProfit: 0,
      totalLoss: 0,
      totalGasCost: 0,
      tradeCount: 0,
      resetTime: this.lastResetTime,
    };
  }

  /**
   * Get current gas metrics from the chain
   */
  async getGasMetrics(): Promise<GasMetrics> {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('30', 'gwei');
      const baseFee = (feeData as any).lastBaseFeePerGas || ethers.parseUnits('10', 'gwei');
      const priorityFee = feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei');

      const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));

      // Check if gas price is too high
      if (gasPriceGwei > this.config.maxGasPriceGwei) {
        logger.warn(`Gas price ${gasPriceGwei} Gwei exceeds max ${this.config.maxGasPriceGwei} Gwei`);
      }

      // Average gas cost estimate: 100k gas for typical arbitrage
      const avgGasUnits = 100000;
      const estimatedCostPerSwap = Number(ethers.formatUnits(gasPrice * BigInt(avgGasUnits), 'ether'));

      // Calculate dynamic profit threshold based on gas costs
      // Formula: profitThreshold = gasCost * 2 (need at least 2x gas cost to break even profitably)
      const profitThreshold = estimatedCostPerSwap * 2;

      return {
        currentGasPrice: gasPriceGwei,
        baseFee: Number(ethers.formatUnits(baseFee, 'gwei')),
        priorityFee: Number(ethers.formatUnits(priorityFee, 'gwei')),
        estimatedCostPerSwap,
        profitThreshold,
      };
    } catch (error) {
      logger.error('Failed to get gas metrics', { error });
      throw error;
    }
  }

  /**
   * Estimate gas cost for a specific DEX type
   */
  estimateGasCost(dexType: string, gasPrice: bigint): bigint {
    const baseGas = (this.dexGasCosts as any)[dexType] || 100000n;
    const gasWithMultiplier = (baseGas * BigInt(Math.floor(this.config.gasMultiplier * 100))) / 100n;
    return gasWithMultiplier * gasPrice;
  }

  /**
   * Check if an opportunity is profitable after gas costs
   */
  async shouldExecuteOpportunity(opportunity: ArbitrageOpportunity): Promise<{
    shouldExecute: boolean;
    reason?: string;
    profitAfterGas?: number;
  }> {
    try {
      // Check daily loss limits
      if (!this.isDailyLossLimitOk()) {
        return {
          shouldExecute: false,
          reason: 'Daily loss limit exceeded',
        };
      }

      // Check circuit breaker
      if (this.consecutiveFailures >= this.circuitBreakerThresholds.consecutiveFailures) {
        return {
          shouldExecute: false,
          reason: `Circuit breaker activated: ${this.consecutiveFailures} consecutive failures`,
        };
      }

      const gasMetrics = await this.getGasMetrics();

      // Check gas price against max
      if (gasMetrics.currentGasPrice > this.config.maxGasPriceGwei) {
        return {
          shouldExecute: false,
          reason: `Gas price ${gasMetrics.currentGasPrice} exceeds max ${this.config.maxGasPriceGwei}`,
        };
      }

      // Check if profit is sufficient
      const profitAfterGas = opportunity.netProfit - gasMetrics.estimatedCostPerSwap;
      const minProfitBps = this.config.minProfitBps / 10000; // Convert basis points to decimal

      if (opportunity.profitPercentage < minProfitBps) {
        return {
          shouldExecute: false,
          reason: `Profit percentage ${opportunity.profitPercentage.toFixed(4)} below minimum ${minProfitBps.toFixed(4)}`,
          profitAfterGas,
        };
      }

      if (profitAfterGas <= 0) {
        return {
          shouldExecute: false,
          reason: `No profit after gas: ${opportunity.netProfit.toFixed(6)} - ${gasMetrics.estimatedCostPerSwap.toFixed(6)} = ${profitAfterGas.toFixed(6)}`,
          profitAfterGas,
        };
      }

      return {
        shouldExecute: true,
        profitAfterGas,
      };
    } catch (error) {
      logger.error('Error in shouldExecuteOpportunity', { error, opportunity: opportunity.id });
      return {
        shouldExecute: false,
        reason: 'Error evaluating opportunity',
      };
    }
  }

  /**
   * Record execution result and update stats
   */
  recordExecution(result: {
    profit: number;
    gasCost: number;
    success: boolean;
  }): void {
    // Reset daily stats if 24 hours have passed
    if (Date.now() - this.lastResetTime > 24 * 60 * 60 * 1000) {
      this.resetDailyStats();
    }

    if (result.success) {
      this.dailyStats.totalProfit += result.profit;
      this.consecutiveFailures = 0;
    } else {
      this.dailyStats.totalLoss += Math.abs(result.profit);
      this.consecutiveFailures++;
    }

    this.dailyStats.totalGasCost += result.gasCost;
    this.dailyStats.tradeCount++;

    logger.info('Execution recorded', {
      success: result.success,
      profit: result.profit,
      gasCost: result.gasCost,
      dailyProfit: this.dailyStats.totalProfit,
      dailyLoss: this.dailyStats.totalLoss,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  /**
   * Check if daily loss limit has been exceeded
   */
  private isDailyLossLimitOk(): boolean {
    const netDaily = this.dailyStats.totalProfit - this.dailyStats.totalLoss;
    
    if (netDaily < -this.config.dailyLossLimit) {
      logger.warn('Daily loss limit exceeded', {
        dailyLoss: -netDaily,
        limit: this.config.dailyLossLimit,
      });
      return false;
    }

    return true;
  }

  /**
   * Reset daily statistics
   */
  private resetDailyStats(): void {
    logger.info('Resetting daily statistics', {
      previousProfit: this.dailyStats.totalProfit,
      previousLoss: this.dailyStats.totalLoss,
      previousGasCost: this.dailyStats.totalGasCost,
      tradeCount: this.dailyStats.tradeCount,
    });

    this.lastResetTime = Date.now();
    this.dailyStats = {
      totalProfit: 0,
      totalLoss: 0,
      totalGasCost: 0,
      tradeCount: 0,
      resetTime: this.lastResetTime,
    };
  }

  /**
   * Get current daily statistics
   */
  getDailyStats() {
    return {
      ...this.dailyStats,
      netProfit: this.dailyStats.totalProfit - this.dailyStats.totalLoss,
      avgProfitPerTrade: this.dailyStats.tradeCount > 0 
        ? (this.dailyStats.totalProfit - this.dailyStats.totalLoss) / this.dailyStats.tradeCount
        : 0,
    };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      isActive: this.consecutiveFailures >= this.circuitBreakerThresholds.consecutiveFailures,
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.circuitBreakerThresholds.consecutiveFailures,
    };
  }

  /**
   * Reset circuit breaker manually
   */
  resetCircuitBreaker(): void {
    logger.info('Resetting circuit breaker');
    this.consecutiveFailures = 0;
  }

  /**
   * Validate transaction and ensure profitability
   */
  async validateExecution(opportunity: ArbitrageOpportunity, gasPrice: bigint): Promise<boolean> {
    const gasMetrics = await this.getGasMetrics();
    const txCost = Number(ethers.formatUnits(this.estimateGasCost('uniswapv3', gasPrice), 'ether'));
    
    return opportunity.netProfit > txCost;
  }

  /**
   * Calculate adaptive gas limit based on opportunity size
   */
  calculateAdaptiveGasLimit(estimatedBaseGas: number, opportunitySize: number): bigint {
    // Scale gas limit based on opportunity size
    // Larger opportunities might need more gas for more hops
    const scaleFactor = Math.min(opportunitySize / 1000, 2); // Max 2x multiplier
    const adaptiveGas = Math.ceil(estimatedBaseGas * scaleFactor * this.config.gasMultiplier);
    
    return BigInt(adaptiveGas);
  }
}

export default GasOptimizer;
