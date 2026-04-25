// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/DEXRegistry.sol";

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title RegisterPools
 * @notice Register real Uniswap V3 pools from Base Sepolia into DEXRegistry.
 *
 * What this script does
 * ─────────────────────
 * 1. Lowers minTVL to 1 ETH so testnet-level pools pass the threshold.
 * 2. Lowers minOpportunityScore to 0 so all registered pools appear in
 *    getHighOpportunityPools() — their score is ~20 on a fresh testnet.
 * 3. Queries the canonical Uniswap V3 factory for the WETH/USDC 0.05% and
 *    WETH/USDC 0.3% pools and registers each one that exists.
 *
 * Synthetic TVL / volume
 * ──────────────────────
 * On a testnet the on-chain TVL is negligible.  We pass synthetic values that
 * satisfy minTVL (>= 1 ETH) but keep the opportunity score honest.
 *
 * Run
 * ───
 * export DEXRegistry=<address>
 * forge script script/RegisterPools.s.sol --rpc-url $RPC_URL --broadcast
 */
contract RegisterPools is Script {

    // ── Base Sepolia token addresses ──────────────────────────────────────────
    address private constant WETH  = 0x4200000000000000000000000000000000000006;
    address private constant USDC  = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // ── Uniswap V3 factory — differs between Base mainnet and Base Sepolia ────
    address private constant UNISWAP_V3_FACTORY_MAINNET = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD; // chain 8453
    address private constant UNISWAP_V3_FACTORY_SEPOLIA = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24; // chain 84532

    // ── Uniswap V2 factory ────────────────────────────────────────────────────
    address private constant UNISWAP_V2_FACTORY_MAINNET = 0x8909Dc15e40953B386fa8f440Db4C4702d4f9b93; // chain 8453
    address private constant UNISWAP_V2_FACTORY_SEPOLIA = 0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e; // chain 84532

    // ── Synthetic metrics (testnet values) ───────────────────────────────────
    // tvl >= minTVL (1 ETH after we lower the threshold).
    // Enough volume to give a reasonable opportunity score.
    uint256 private constant SYNTHETIC_TVL     = 1 ether;
    uint256 private constant SYNTHETIC_VOL24H  = 0;

    function run() external {
        address registryAddr = vm.envAddress("DEXRegistry");

        // Resolve factory addresses by chain
        address v3Factory = block.chainid == 84532
            ? UNISWAP_V3_FACTORY_SEPOLIA
            : UNISWAP_V3_FACTORY_MAINNET;
        address v2Factory = block.chainid == 84532
            ? UNISWAP_V2_FACTORY_SEPOLIA
            : UNISWAP_V2_FACTORY_MAINNET;

        // Abort early if factory is not deployed on this network
        require(v3Factory.code.length > 0,
            "RegisterPools: Uniswap V3 factory not deployed on this chain");

        vm.startBroadcast();

        DEXRegistry registry = DEXRegistry(registryAddr);

        console.log("RegisterPools: registry =", registryAddr);
        console.log("RegisterPools: chain    =", block.chainid);
        console.log("RegisterPools: factory  =", v3Factory);
        console.log("");

        // ── 1. Relax thresholds for testnet ──────────────────────────────────
        // minTVL default is 1000 ETH — far too high for any testnet pool.
        uint256 currentMinTVL = registry.minTVL();
        if (currentMinTVL > 1 ether) {
            registry.setMinTVL(1 ether);
            console.log("[OK] minTVL lowered to 1 ETH (was", currentMinTVL / 1 ether, "ETH)");
        } else {
            console.log("[--] minTVL already <=1 ETH, no change");
        }

        // minOpportunityScore default is 30 — fresh testnet pools score ~20.
        uint256 currentMinScore = registry.minOpportunityScore();
        if (currentMinScore > 0) {
            registry.setMinOpportunityScore(0);
            console.log("[OK] minOpportunityScore lowered to 0 (was", currentMinScore, ")");
        } else {
            console.log("[--] minOpportunityScore already 0, no change");
        }

        console.log("");

        // ── 2. Register pools ─────────────────────────────────────────────────
        uint256 registered = 0;

        // Pool A: WETH/USDC 0.05% (fee = 500)
        address poolA = IUniswapV3Factory(v3Factory).getPool(WETH, USDC, 500);
        if (poolA != address(0)) {
            // Always derive token0/token1 from the pool itself — AMM factories sort
            // tokens by address so pool.token0() < pool.token1() is guaranteed.
            // Passing WETH/USDC in the wrong order was the original bug.
            (address t0a, address t1a) = _poolTokens(poolA);
            registered += _tryRegister(registry, poolA, DEXRegistry.DEXType.UniswapV3, t0a, t1a, 500, "WETH/USDC 0.05%");
        } else {
            console.log("[SKIP] WETH/USDC 0.05% - pool does not exist on this network");
        }

        // Pool B: WETH/USDC 0.3% (fee = 3000)
        address poolB = IUniswapV3Factory(v3Factory).getPool(WETH, USDC, 3000);
        if (poolB != address(0)) {
            (address t0b, address t1b) = _poolTokens(poolB);
            registered += _tryRegister(registry, poolB, DEXRegistry.DEXType.UniswapV3, t0b, t1b, 3000, "WETH/USDC 0.3%");
        } else {
            console.log("[SKIP] WETH/USDC 0.3% - pool does not exist on this network");
        }

        // Pool C: WETH/USDC 1% (fee = 10000)
        address poolC = IUniswapV3Factory(v3Factory).getPool(WETH, USDC, 10000);
        if (poolC != address(0)) {
            (address t0c, address t1c) = _poolTokens(poolC);
            registered += _tryRegister(registry, poolC, DEXRegistry.DEXType.UniswapV3, t0c, t1c, 10000, "WETH/USDC 1%");
        } else {
            console.log("[SKIP] WETH/USDC 1% - pool does not exist on this network");
        }

        // Pool D: WETH/USDC UniswapV2 pair — primary arb target against V3 pools
        if (v2Factory.code.length > 0) {
            address poolD = IUniswapV2Factory(v2Factory).getPair(WETH, USDC);
            if (poolD != address(0)) {
                (address t0d, address t1d) = _poolTokens(poolD);
                registered += _tryRegister(registry, poolD, DEXRegistry.DEXType.UniswapV2, t0d, t1d, 3000, "WETH/USDC V2");
            } else {
                console.log("[SKIP] WETH/USDC V2 - pair does not exist");
            }
        } else {
            console.log("[SKIP] WETH/USDC V2 - UniswapV2 factory not deployed on this chain");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  RegisterPools complete");
        console.log("===========================================");
        console.log("  Pools registered this run:", registered);
        console.log("  DEXRegistry:", registryAddr);
        console.log("===========================================");

        if (registered == 0) {
            console.log("");
            console.log("WARNING: 0 pools registered.");
            console.log("The Uniswap V3 factory returned address(0) for all queried pairs.");
            console.log("This means those pools do not exist on this network yet.");
            console.log("To create them, add liquidity via the Uniswap interface or deploy");
            console.log("pool creation code separately, then re-run this script.");
        }
    }

    /**
     * @dev Try to register a single pool. Returns 1 on success, 0 if skipped.
     *      Skips without reverting if the pool address is zero or already registered.
     */
    function _tryRegister(
        DEXRegistry registry,
        address pool,
        DEXRegistry.DEXType dexType,
        address token0,
        address token1,
        uint256 fee,
        string memory label
    ) internal returns (uint256) {
        if (pool == address(0)) {
            console.log("[SKIP]", label, "- pool does not exist on this network");
            return 0;
        }

        // Check if already registered (getPoolInfo reverts via poolMustExist if not found)
        bool alreadyRegistered = false;
        try registry.getPoolInfo(pool) returns (DEXRegistry.PoolInfo memory) {
            alreadyRegistered = true;
        } catch {}
        if (alreadyRegistered) {
            console.log("[SKIP]", label, "- already registered at", pool);
            return 0;
        }

        registry.addPool(pool, dexType, token0, token1, fee, SYNTHETIC_TVL, SYNTHETIC_VOL24H);
        console.log("[OK]", label, "registered at", pool);
        return 1;
    }

    /**
     * @dev Return (token0, token1) from a pool/pair contract.
     *      Works for both V2 pairs and V3 pools.
     */
    function _poolTokens(address pool) internal view returns (address t0, address t1) {
        t0 = IUniswapV3Pool(pool).token0();
        t1 = IUniswapV3Pool(pool).token1();
    }
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
}
