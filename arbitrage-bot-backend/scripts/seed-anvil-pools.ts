import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

// process.cwd() is arbitrage-bot-backend/ when run via npm — .env lives there
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ─────────────────────────────────────────────────────────────────
const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const ANVIL_KEY = process.env.ANVIL_PRIVATE_KEY!;

if (!ANVIL_KEY) {
  console.error('ERROR: ANVIL_PRIVATE_KEY not set in .env');
  process.exit(1);
}

// Base Sepolia addresses — same on the Anvil fork since we forked Base Sepolia.
// Replace V2_POOL and V3_POOL with your actual deployed pool addresses from DEXRegistry.
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // canonical WETH on Base Sepolia
const V2_POOL = process.env.V2_POOL_ADDRESS ?? '';
const V3_POOL = process.env.V3_POOL_ADDRESS ?? '';

// ABIs — minimal
const WETH_ABI = [
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const V2_POOL_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
  'function token0() view returns (address)',
  'function sync()',
];
const V3_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(ANVIL_RPC);
  const signer   = new ethers.Wallet(ANVIL_KEY, provider);
  const addr     = await signer.getAddress();

  console.log('=== Anvil Pool Seeding Script ===');
  console.log(`Wallet: ${addr}`);
  console.log(`RPC:    ${ANVIL_RPC}`);

  // ── 1. Fund wallet with extra ETH via Anvil cheatcode ──
  console.log('\n[1] Setting ETH balance to 10,000 ETH...');
  await provider.send('anvil_setBalance', [
    addr,
    '0x' + (BigInt('10000') * BigInt(10 ** 18)).toString(16),
  ]);
  const ethBal = await provider.getBalance(addr);
  console.log(`    ETH balance: ${ethers.formatEther(ethBal)} ETH`);

  // ── 2. Wrap ETH → WETH ──
  console.log('\n[2] Wrapping 500 ETH to WETH...');
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
  const wrapTx = await weth.deposit({ value: ethers.parseEther('500') });
  await wrapTx.wait();
  const wethBal = await weth.balanceOf(addr);
  console.log(`    WETH balance: ${ethers.formatEther(wethBal)} WETH`);

  // ── 3. V2 pool imbalance ──
  if (!V2_POOL) {
    console.log('\n[3] V2_POOL_ADDRESS not set in .env — skipping V2 imbalance step.');
    console.log('    Add V2_POOL_ADDRESS=<pool> to arbitrage-bot-backend/.env and re-run.');
  } else {
    console.log(`\n[3] V2 pool reserves BEFORE imbalance (${V2_POOL}):`);
    const v2Pool = new ethers.Contract(V2_POOL, V2_POOL_ABI, provider);
    const [r0_before, r1_before] = await v2Pool.getReserves();
    const token0 = await new ethers.Contract(V2_POOL, ['function token0() view returns (address)'], provider).token0();
    const isWethToken0 = String(token0).toLowerCase() === WETH_ADDRESS.toLowerCase();
    const wethReserveBefore = isWethToken0 ? r0_before : r1_before;
    const usdcReserveBefore = isWethToken0 ? r1_before : r0_before;
    console.log(`    WETH reserve: ${ethers.formatEther(wethReserveBefore)}`);
    console.log(`    USDC reserve: ${ethers.formatUnits(usdcReserveBefore, 6)}`);

    // Transfer WETH directly into the V2 pool to skew reserves
    // UniswapV2 requires sync() after a direct transfer to update internal reserves
    console.log('\n[4] Injecting 100 WETH into V2 pool to create price imbalance...');
    const transferTx = await weth.transfer(V2_POOL, ethers.parseEther('100'));
    await transferTx.wait();

    const v2PoolSigner = new ethers.Contract(V2_POOL, V2_POOL_ABI, signer);
    const syncTx = await v2PoolSigner.sync();
    await syncTx.wait();

    console.log('\n[5] V2 pool reserves AFTER imbalance:');
    const [r0_after, r1_after] = await v2Pool.getReserves();
    const wethReserveAfter = isWethToken0 ? r0_after : r1_after;
    const usdcReserveAfter = isWethToken0 ? r1_after : r0_after;
    console.log(`    WETH reserve: ${ethers.formatEther(wethReserveAfter)}`);
    console.log(`    USDC reserve: ${ethers.formatUnits(usdcReserveAfter, 6)}`);

    const priceBefore = Number(ethers.formatUnits(usdcReserveBefore, 6)) /
                        Number(ethers.formatEther(wethReserveBefore));
    const priceAfter  = Number(ethers.formatUnits(usdcReserveAfter, 6)) /
                        Number(ethers.formatEther(wethReserveAfter));
    console.log('\n=== V2 Price Summary ===');
    console.log(`WETH price before: $${priceBefore.toFixed(2)}`);
    console.log(`WETH price after:  $${priceAfter.toFixed(2)}`);
    console.log(`Price moved by:    ${((priceAfter / priceBefore - 1) * 100).toFixed(2)}%`);
  }

  // ── 4. V3 pool info (read-only, no seeding needed) ──
  if (V3_POOL) {
    console.log(`\n[6] V3 pool state (${V3_POOL}):`);
    const v3Pool = new ethers.Contract(V3_POOL, V3_POOL_ABI, provider);
    const slot0 = await v3Pool.slot0();
    console.log(`    sqrtPriceX96: ${slot0.sqrtPriceX96.toString()}`);
    console.log(`    tick:         ${slot0.tick}`);
  }
// Fund bot contract with WETH so self-funded execution works
console.log('\n[6] Funding bot contract with 10 WETH...');
const BOT_CONTRACT = '0x1466737d955Edf7fa47949EAfCf8213bAFcc2867';
const wrapTx2 = await weth.deposit({ value: ethers.parseEther('10') });
await wrapTx2.wait();
const fundTx = await weth.transfer(BOT_CONTRACT, ethers.parseEther('10'));
await fundTx.wait();
const botWethBal = await weth.balanceOf(BOT_CONTRACT);
console.log(`    Bot contract WETH balance: ${ethers.formatEther(botWethBal)} WETH`);
  console.log('\nSeeding complete. Start the bot now:');
  console.log('  cd arbitrage-bot-backend && npm run dev:anvil');
}

main().catch(console.error);
