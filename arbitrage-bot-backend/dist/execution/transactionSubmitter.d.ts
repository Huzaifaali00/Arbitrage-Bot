import { TransactionParams, ExecutionResult } from '../types';
export declare class TransactionSubmitter {
    private provider;
    private signer;
    private maxRetries;
    private retryDelay;
    private useMEVBundle;
    private mevRelayUrl;
    private mevRelayEndpoints;
    private botInterface;
    private erc20Abi;
    private v3FactoryAbi;
    private v3QuoterV2Abi;
    private tokenDecimalsCache;
    private tokenSymbolCache;
    private v3FactoryByChain;
    private v3QuoterByChain;
    constructor(rpcUrl: string, privateKey: string, useMEVBundle?: boolean, mevRelayUrl?: string);
    private getSignerAddress;
    private getTokenDecimals;
    private getTokenSymbol;
    private formatSignedUnits;
    private captureTrackedBalances;
    private quoteTokenToStable;
    private parseEventProfitUsd;
    submitTransaction(txParams: TransactionParams, useMEVBundle?: boolean): Promise<ExecutionResult>;
    private buildSignedTransaction;
    private submitViaPrivateRPC;
    private submitToMEVRelay;
    private processReceipt;
    private waitForReceipt;
    submitBatchTransactions(txParamsList: TransactionParams[]): Promise<ExecutionResult[]>;
}
export default TransactionSubmitter;
//# sourceMappingURL=transactionSubmitter.d.ts.map