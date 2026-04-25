"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionSubmitter = void 0;
const ethers_1 = require("ethers");
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
class TransactionSubmitter {
    constructor(rpcUrl, privateKey, useMEVBundle = false, mevRelayUrl) {
        this.signer = null;
        this.maxRetries = 3;
        this.retryDelay = 1000; // ms
        this.useMEVBundle = false;
        this.mevRelayUrl = '';
        this.mevRelayEndpoints = {
            flashbots: 'https://relay.flashbots.net',
            bloxroute: 'https://api.bloxroute.com/ethereum/public/tx',
        };
        this.botInterface = new ethers_1.ethers.Interface([
            "event ArbExecuted(uint256 profitUSDC)",
            "event BackrunExecuted(address indexed pool, uint256 profitUSDC)"
        ]);
        this.erc20Abi = [
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function symbol() view returns (string)",
        ];
        this.v3FactoryAbi = [
            "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
        ];
        this.v3QuoterV2Abi = [
            "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
        ];
        this.tokenDecimalsCache = {};
        this.tokenSymbolCache = {};
        this.v3FactoryByChain = {
            baseSepolia: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
            base: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
            arbitrum: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            arbitrumSepolia: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
        };
        this.v3QuoterByChain = {
            baseSepolia: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
        };
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        if (privateKey && privateKey.startsWith('0x') && privateKey.length === 66) {
            this.signer = new ethers_1.Wallet(privateKey, this.provider);
            logger_1.default.info('TransactionSubmitter initialized with valid signer', {
                useMEVBundle,
                signerAddress: this.signer.address,
            });
        }
        this.useMEVBundle = useMEVBundle;
        if (useMEVBundle) {
            this.mevRelayUrl = mevRelayUrl || this.mevRelayEndpoints.bloxroute;
        }
    }
    getSignerAddress() {
        return this.signer?.address || '0x0000000000000000000000000000000000000000';
    }
    async getTokenDecimals(tokenAddress) {
        const key = tokenAddress.toLowerCase();
        if (this.tokenDecimalsCache[key] !== undefined) {
            return this.tokenDecimalsCache[key];
        }
        try {
            const token = new ethers_1.ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
            const raw = await token.decimals();
            const decimals = typeof raw === 'number' ? raw : Number(raw);
            this.tokenDecimalsCache[key] = Number.isFinite(decimals) ? decimals : 18;
        }
        catch {
            this.tokenDecimalsCache[key] = 18;
        }
        return this.tokenDecimalsCache[key];
    }
    async getTokenSymbol(tokenAddress) {
        const key = tokenAddress.toLowerCase();
        if (this.tokenSymbolCache[key]) {
            return this.tokenSymbolCache[key];
        }
        try {
            const token = new ethers_1.ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
            const symbol = await token.symbol();
            this.tokenSymbolCache[key] = String(symbol);
        }
        catch {
            this.tokenSymbolCache[key] = key === config_1.default.profitTokenAddress.toLowerCase() ? 'USDC' : 'TOKEN';
        }
        return this.tokenSymbolCache[key];
    }
    formatSignedUnits(value, decimals) {
        const negative = value < 0n;
        const absolute = negative ? -value : value;
        const formatted = Number(ethers_1.ethers.formatUnits(absolute, decimals));
        return negative ? -formatted : formatted;
    }
    async captureTrackedBalances(txParams) {
        const tracking = txParams.tracking;
        if (!tracking) {
            return {};
        }
        const tokenSet = new Set([
            tracking.tokenIn.toLowerCase(),
            tracking.stableToken.toLowerCase(),
        ]);
        if (tracking.wrappedNativeToken) {
            tokenSet.add(tracking.wrappedNativeToken.toLowerCase());
        }
        const snapshot = {};
        await Promise.all(Array.from(tokenSet).map(async (tokenAddress) => {
            const token = new ethers_1.ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
            snapshot[tokenAddress] = await token.balanceOf(tracking.botAddress);
        }));
        return snapshot;
    }
    async quoteTokenToStable(tokenAddress, amount, stableToken) {
        if (amount <= 0n) {
            return 0;
        }
        const normalizedToken = tokenAddress.toLowerCase();
        const normalizedStable = stableToken.toLowerCase();
        const stableDecimals = await this.getTokenDecimals(stableToken);
        if (normalizedToken === normalizedStable) {
            return Number(ethers_1.ethers.formatUnits(amount, stableDecimals));
        }
        const quoterAddress = this.v3QuoterByChain[config_1.default.chain];
        const factoryAddress = this.v3FactoryByChain[config_1.default.chain];
        if (!quoterAddress || !factoryAddress) {
            return null;
        }
        const factory = new ethers_1.ethers.Contract(factoryAddress, this.v3FactoryAbi, this.provider);
        const quoter = new ethers_1.ethers.Contract(quoterAddress, this.v3QuoterV2Abi, this.provider);
        let bestAmountOut = 0n;
        for (const fee of [500, 3000, 10000]) {
            try {
                const pool = await factory.getPool(tokenAddress, stableToken, fee);
                if (!pool || pool === ethers_1.ethers.ZeroAddress) {
                    continue;
                }
                const quote = await quoter.quoteExactInputSingle.staticCall({
                    tokenIn: tokenAddress,
                    tokenOut: stableToken,
                    amountIn: amount,
                    fee,
                    sqrtPriceLimitX96: 0n,
                });
                const amountOut = BigInt(quote.amountOut);
                if (amountOut > bestAmountOut) {
                    bestAmountOut = amountOut;
                }
            }
            catch {
                continue;
            }
        }
        if (bestAmountOut <= 0n) {
            return null;
        }
        return Number(ethers_1.ethers.formatUnits(bestAmountOut, stableDecimals));
    }
    parseEventProfitUsd(receipt) {
        let profitMade = 0;
        for (const log of receipt.logs) {
            try {
                const parsed = this.botInterface.parseLog(log);
                if (parsed && (parsed.name === "ArbExecuted" || parsed.name === "BackrunExecuted")) {
                    profitMade += Number(ethers_1.ethers.formatUnits(parsed.args.profitUSDC, 6));
                }
            }
            catch {
                // ignore unrelated logs
            }
        }
        return profitMade;
    }
    async submitTransaction(txParams, useMEVBundle = this.useMEVBundle) {
        let lastError = null;
        const preBalances = await this.captureTrackedBalances(txParams);
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const nonce = await this.provider.getTransactionCount(this.getSignerAddress(), "pending");
                const tx = await this.buildSignedTransaction(txParams, nonce);
                if (useMEVBundle && this.mevRelayUrl) {
                    return await this.submitToMEVRelay(tx, txParams, preBalances);
                }
                else {
                    return await this.submitViaPrivateRPC(tx, txParams, preBalances);
                }
            }
            catch (error) {
                lastError = error;
                const err = error;
                const message = err?.shortMessage || err?.message || "unknown submission error";
                logger_1.default.warn(`Transaction submission failed (attempt ${attempt + 1}/${this.maxRetries}): ${message}`, { code: err?.code });
                if (attempt < this.maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)));
                }
            }
        }
        return {
            hash: '',
            status: 'failed',
            profitMade: 0,
            gasCostActual: 0,
            netProfit: 0,
            timestamp: Date.now(),
            profitSource: 'unknown',
        };
    }
    async buildSignedTransaction(txParams, nonce) {
        const network = await this.provider.getNetwork();
        const tx = {
            to: txParams.to,
            data: txParams.data,
            value: BigInt(txParams.value),
            gasLimit: BigInt(txParams.gasLimit),
            nonce,
            chainId: Number(network.chainId),
        };
        if (txParams.maxFeePerGas && txParams.maxPriorityFeePerGas) {
            tx.maxFeePerGas = BigInt(txParams.maxFeePerGas);
            tx.maxPriorityFeePerGas = BigInt(txParams.maxPriorityFeePerGas);
            tx.type = 2;
        }
        else if (txParams.gasPrice) {
            tx.gasPrice = BigInt(txParams.gasPrice);
            tx.type = 0;
        }
        if (!this.signer)
            throw new Error('No valid signer');
        return await this.signer.signTransaction(tx);
    }
    async submitViaPrivateRPC(signedTx, txParams, preBalances) {
        const txResponse = await this.provider.broadcastTransaction(signedTx);
        logger_1.default.info("Transaction submitted to mempool", {
            txHash: txResponse.hash,
        });
        const receipt = await this.waitForReceipt(txResponse.hash, 60000);
        if (!receipt) {
            logger_1.default.info("Transaction still pending after receipt timeout", {
                txHash: txResponse.hash,
            });
            return { hash: txResponse.hash, status: 'pending', profitMade: 0, gasCostActual: 0, netProfit: 0, timestamp: Date.now(), profitSource: 'unknown' };
        }
        logger_1.default.info("Transaction mined", {
            txHash: receipt.hash,
            status: receipt.status === 1 ? "success" : "failed",
            gasUsed: receipt.gasUsed?.toString(),
        });
        return this.processReceipt(receipt, txParams, preBalances);
    }
    async submitToMEVRelay(signedTx, txParams, preBalances) {
        const blockNumber = await this.provider.getBlockNumber();
        const bundle = { txs: [signedTx], blockNumber: blockNumber + 1 };
        const response = await fetch(this.mevRelayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_sendBundle', params: bundle, id: 1 }),
        });
        const data = await response.json();
        if (data.error)
            throw new Error(data.error.message);
        const tx = ethers_1.ethers.Transaction.from(signedTx);
        const receipt = await this.waitForReceipt(tx.hash, 120000);
        if (!receipt) {
            return { hash: tx.hash, status: 'pending', profitMade: 0, gasCostActual: 0, netProfit: 0, timestamp: Date.now(), profitSource: 'unknown' };
        }
        return this.processReceipt(receipt, txParams, preBalances);
    }
    async processReceipt(receipt, txParams, preBalances) {
        const gasUsed = receipt.gasUsed || 0n;
        const gasPrice = receipt.gasPrice || 0n;
        const gasCostWei = gasUsed * gasPrice;
        const gasCostActual = Number(ethers_1.ethers.formatEther(gasCostWei));
        const tracking = txParams.tracking;
        if (tracking) {
            const postBalances = await this.captureTrackedBalances(txParams);
            const tokenInKey = tracking.tokenIn.toLowerCase();
            const stableKey = tracking.stableToken.toLowerCase();
            const preTokenBalance = preBalances[tokenInKey] ?? 0n;
            const postTokenBalance = postBalances[tokenInKey] ?? 0n;
            const realizedDeltaRaw = postTokenBalance - preTokenBalance;
            const tokenDecimals = await this.getTokenDecimals(tracking.tokenIn);
            const tokenSymbol = await this.getTokenSymbol(tracking.tokenIn);
            const absDeltaRaw = realizedDeltaRaw >= 0n ? realizedDeltaRaw : -realizedDeltaRaw;
            let realizedUsdEquivalent = null;
            if (tokenInKey === stableKey) {
                realizedUsdEquivalent = Number(ethers_1.ethers.formatUnits(realizedDeltaRaw, tokenDecimals));
            }
            else if (absDeltaRaw > 0n) {
                const quoted = await this.quoteTokenToStable(tracking.tokenIn, absDeltaRaw, tracking.stableToken);
                if (quoted !== null) {
                    realizedUsdEquivalent = realizedDeltaRaw >= 0n ? quoted : -quoted;
                }
            }
            const gasCostUsd = tracking.wrappedNativeToken
                ? await this.quoteTokenToStable(tracking.wrappedNativeToken, gasCostWei, tracking.stableToken)
                : null;
            const grossUsd = realizedUsdEquivalent ?? 0;
            const netUsd = grossUsd - (gasCostUsd ?? 0);
            return {
                hash: receipt.hash,
                status: receipt.status === 1 ? 'success' : 'failed',
                profitMade: grossUsd,
                gasCostActual,
                gasCostUsd: gasCostUsd ?? 0,
                netProfit: netUsd,
                timestamp: Date.now(),
                realizedToken: tracking.tokenIn,
                realizedTokenSymbol: tokenSymbol,
                realizedDelta: this.formatSignedUnits(realizedDeltaRaw, tokenDecimals),
                realizedUsdEquivalent: grossUsd,
                profitSource: 'balance_delta',
            };
        }
        return {
            hash: receipt.hash,
            status: receipt.status === 1 ? 'success' : 'failed',
            profitMade: 0,
            gasCostActual,
            netProfit: -gasCostActual,
            timestamp: Date.now(),
            profitSource: 'unknown',
        };
    }
    async waitForReceipt(txHash, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (receipt)
                return receipt;
            await new Promise(r => setTimeout(r, 1000));
        }
        return null;
    }
    async submitBatchTransactions(txParamsList) {
        const results = [];
        let nonce = await this.provider.getTransactionCount(this.getSignerAddress(), "pending");
        for (const txParams of txParamsList) {
            try {
                const preBalances = await this.captureTrackedBalances(txParams);
                const signedTx = await this.buildSignedTransaction(txParams, nonce);
                const res = await this.submitViaPrivateRPC(signedTx, txParams, preBalances);
                results.push(res);
                nonce++;
            }
            catch (e) {
                results.push({ hash: '', status: 'failed', profitMade: 0, gasCostActual: 0, netProfit: 0, timestamp: Date.now(), profitSource: 'unknown' });
            }
        }
        return results;
    }
}
exports.TransactionSubmitter = TransactionSubmitter;
exports.default = TransactionSubmitter;
//# sourceMappingURL=transactionSubmitter.js.map