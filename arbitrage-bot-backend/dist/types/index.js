"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEX_PROTOCOL_MAP = exports.ChainType = exports.DEXProtocol = exports.DEXType = void 0;
// DEXes the bot monitors on Base mainnet. Keep this list in sync with
// script/RegisterDEXes.s.sol and arbitrage-bot-backend/src/core/poolDiscoveryService.ts.
// DEXes without a canonical Base deployment (dYdX, QuickSwap, Camelot) are deliberately
// excluded — the ArbitrageBot would waste RPC calls and revert when swapping on them.
var DEXType;
(function (DEXType) {
    DEXType["UniswapV2"] = "uniswapv2";
    DEXType["UniswapV3"] = "uniswapv3";
    DEXType["SushiSwap"] = "sushiswap";
    DEXType["Aerodrome"] = "aerodrome";
    DEXType["Curve"] = "curve";
    DEXType["Balancer"] = "balancer";
    DEXType["PancakeSwap"] = "pancakeswap";
})(DEXType || (exports.DEXType = DEXType = {}));
var DEXProtocol;
(function (DEXProtocol) {
    DEXProtocol["UniswapV2Style"] = "v2_style";
    DEXProtocol["UniswapV3Style"] = "v3_style";
    DEXProtocol["CurveStyle"] = "curve_style";
    DEXProtocol["BalancerStyle"] = "balancer_style";
})(DEXProtocol || (exports.DEXProtocol = DEXProtocol = {}));
var ChainType;
(function (ChainType) {
    ChainType["BASE_MAINNET"] = "base";
    ChainType["BASE_SEPOLIA"] = "baseSepolia";
    ChainType["ARBITRUM_MAINNET"] = "arbitrum";
    ChainType["ARBITRUM_SEPOLIA"] = "arbitrumSepolia";
})(ChainType || (exports.ChainType = ChainType = {}));
exports.DEX_PROTOCOL_MAP = {
    [DEXType.UniswapV2]: DEXProtocol.UniswapV2Style,
    [DEXType.UniswapV3]: DEXProtocol.UniswapV3Style,
    [DEXType.SushiSwap]: DEXProtocol.UniswapV2Style,
    [DEXType.Aerodrome]: DEXProtocol.UniswapV2Style,
    [DEXType.Curve]: DEXProtocol.CurveStyle,
    [DEXType.Balancer]: DEXProtocol.BalancerStyle,
    [DEXType.PancakeSwap]: DEXProtocol.UniswapV2Style,
};
//# sourceMappingURL=index.js.map