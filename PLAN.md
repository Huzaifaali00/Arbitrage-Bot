# MEV Arbitrage Bot - Development Plan

## Project Vision

Build a production-ready, multi-tenant MEV arbitrage bot as a SaaS platform where users can deposit funds and earn from arbitrage opportunities without exposing their private keys.

---
## Imp Notes

- Security of smart contracts, backend and overall bot is the CORE of this project - prioritize them
- We are building it as a Saas Model so take decisions accordingly, dont leave anything halfdone and dont do skeleton implementation.
- Security is paramount - no shortcuts
- Before taking any critical decision, also backtrack to see if you're not breaking anything
- Think like a security auditor/analyst while making every small and big security moves.

## Objective 1: Expand Exchange Coverage ON Base Chain (10+ DEXes)

### Current State
- Only 4 DEXes: Uniswap V3, Curve, Balancer, dYdX

### Target
- Minimum 10+ exchanges actively monitored
- Ability to add new exchanges dynamically

### Implementation Plan

#### Phase 1: Add More DEX Support
| Priority | DEX | Type | Notes |
|----------|-----|------|-------|
| P0 | Uniswap V2 | AMM | Legacy but still has opportunities |
| P0 | SushiSwap | AMM | Large TVL, good for arb |
| P0 | PancakeSwap (BSC) | AMM | Cross-chain opportunities |
| P1 | Fraxtal/Mode | AMM | Emerging L2s |
| P1 | Aerodrome/Base | AMM | Base's main DEX |
| P1 | Trader Joe | AMM | Avalanche |
| P1 | Quickswap | AMM | Polygon |
| P2 | Camelot | AMM | Arbitrum |
| P2 | Orca | AMM | Solana (if multi-chain) |
| P2 | Raydium | AMM | Solana |

#### Phase 2: Dynamic Exchange Discovery
- Build an automated pool discovery system
- Scan new pools as they're created
- Monitor TVL, volume, and age to filter quality pools
- Maintain a live registry of high-opportunity pools


---

## Objective 2: Remove Front-Run (Keep Back-Run Only)

### Current State
- Sandwich function executes BOTH front-run AND back-run
- This constitutes MEV extraction (controversial/gray area)

### Target
- Only execute back-run arbitrage (pure arbitrage, no victim)
- No front-running other users' transactions

### Implementation Plan

1. Rename `executeSandwich` → `executeBackrun`
2. Remove the front-run swap (first swap)
3. Keep only the second swap (back-run)
4. Update backend to only send back-run parameters
5. Update documentation to reflect this change

### Why Back-Run Is Safe
- Back-running extracts value from market inefficiency AFTER it occurs
- No manipulation of other users' transactions
- Consider legitimate market making
- No ethical/legal concerns

---

## Objective 3: Secure Delegation/Vault Model

### Current State
- Single user architecture
- Private key required for execution
- Not suitable for multi-user SaaS

### Target
- Vault smart contract where users deposit funds
- Bot operates as a service without access to user keys
- Profit sharing with automatic distribution

---

### Vault Contract Parameters (Finalized)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Min Deposit | $10 (in ETH/USDC equivalent) | Low barrier for users |
| Max Deposit | $100,000 | Prevent whale concentration |
| Performance Fee | 15-20% | Standard SaaS revenue |
| Min Withdraw | $1 | No dust left |
| Pause Lock | 0 blocks | Immediate pause/unpause |


---

### Vault Contract Architecture

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract ArbitrageVault is ReentrancyGuard, Pausable {
    
    // ═══════════════════════════════════════════════════════════════════
    // USER ACCOUNT STRUCTURE
    // ═══════════════════════════════════════════════════════════════════
    
    struct UserAccount {
        uint256 principal;         // Deposited funds (active for trading)
        uint256 pendingProfit;    // Earned but not claimed
        uint256 realizedProfit;   // Already withdrawn
        uint256 totalDeposited;  // All-time deposits
        uint256 totalWithdrawn;  // All-time withdrawals
        bool isPaused;           // User paused their funds
        uint256 pauseBlock;      // Block when paused
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════
    
    mapping(address => UserAccount) public accounts;
    
    // Vault totals
    uint256 public totalPrincipal;        // Sum of all active principal
    uint256 public totalPendingProfit;    // Sum of pending profits
    
    // Vault Parameters
    uint256 public performanceFeeBps = 2000;  // 20% to operator
    uint256 public minDeposit = 0.01 ether;   // ~$10
    uint256 public maxDeposit = 100e18;       // ~$100,000
    
    // Roles
    mapping(address => bool) public executors;  // Bot can execute trades
    mapping(address => bool) public authorizedAdmins;
    
    // ═══════════════════════════════════════════════════════════════════
    // USER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    /// @notice Deposit funds into vault
    function deposit() external payable nonReentrant whenNotPaused {
        require(msg.value >= minDeposit, "Below minimum deposit");
        require(msg.value <= maxDeposit, "Exceeds maximum deposit");
        require(accounts[msg.sender].totalDeposited + msg.value <= maxDeposit, "Total exceeds max");
        
        UserAccount storage user = accounts[msg.sender];
        user.principal += msg.value;
        user.totalDeposited += msg.value;
        user.isPaused = false;  // Auto-unpause
        
        totalPrincipal += msg.value;
        
        emit Deposited(msg.sender, msg.value);
    }
    
    /// @notice Custom withdraw - user specifies exact profit + principal amounts
    /// @param profitAmount Exact profit amount to withdraw (0 allowed)
    /// @param principalAmount Exact principal amount to withdraw (0 allowed)
    function withdraw(uint256 profitAmount, uint256 principalAmount) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        UserAccount storage user = accounts[msg.sender];
        
        uint256 totalWithdrawal = profitAmount + principalAmount;
        require(totalWithdrawal > 0, "Nothing to withdraw");
        
        // Validate amounts
        if (profitAmount > 0) {
            require(profitAmount <= user.pendingProfit, "Insufficient profit");
        }
        if (principalAmount > 0) {
            require(principalAmount <= user.principal, "Insufficient principal");
        }
        
        // Execute withdrawal
        if (profitAmount > 0) {
            user.pendingProfit -= profitAmount;
            user.realizedProfit += profitAmount;
            totalPendingProfit -= profitAmount;
        }
        
        if (principalAmount > 0) {
            user.principal -= principalAmount;
            user.totalWithdrawn += principalAmount;
            totalPrincipal -= principalAmount;
            
            if (user.principal == 0) {
                user.isPaused = true;
                user.pauseBlock = block.number;
            }
        }
        
        // Transfer
        (bool success, ) = msg.sender.call{value: totalWithdrawal}("");
        require(success, "Transfer failed");
        
        emit Withdrawn(msg.sender, profitAmount, principalAmount, totalWithdrawal);
    }
    
    /// @notice Withdraw all (convenience function)
    function withdrawAll() external nonReentrant whenNotPaused {
        UserAccount storage user = accounts[msg.sender];
        uint256 total = user.principal + user.pendingProfit;
        require(total > 0, "Nothing to withdraw");
        
        this.withdraw(user.pendingProfit, user.principal);
    }
    
    /// @notice Check if withdrawal is possible
    function canWithdraw(uint256 profitAmount, uint256 principalAmount) 
        external 
        view 
        returns (bool, string memory) 
    {
        UserAccount storage user = accounts[msg.sender];
        
        if (profitAmount > user.pendingProfit) {
            return (false, "Insufficient profit balance");
        }
        if (principalAmount > user.principal) {
            return (false, "Insufficient principal balance");
        }
        if (profitAmount == 0 && principalAmount == 0) {
            return (false, "Nothing to withdraw");
        }
        
        return (true, "OK");
    }
    
    /// @notice User pauses their funds (stops being used for trading)
    function pauseMyFunds() external {
        UserAccount storage user = accounts[msg.sender];
        require(user.principal > 0, "No funds to pause");
        
        user.isPaused = true;
        user.pauseBlock = block.number;
        
        totalPrincipal -= user.principal;
        
        emit FundsPaused(msg.sender);
    }
    
    /// @notice User resumes their funds
    function unpauseMyFunds() external {
        UserAccount storage user = accounts[msg.sender];
        require(user.isPaused, "Not paused");
        
        user.isPaused = false;
        totalPrincipal += user.principal;
        
        emit FundsUnpaused(msg.sender);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // BOT OPERATOR FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    /// @notice Distribute profit to active users proportionally
    function distributeProfit(uint256 profitTotal) external onlyExecutor {
        require(totalPrincipal > 0, "No active funds");
        
        // Calculate operator fee
        uint256 operatorFee = (profitTotal * performanceFeeBps) / 10000;
        uint256 netProfit = profitTotal - operatorFee;
        
        // Note: In production, iterate through active users
        // or maintain a list of active user addresses
        
        emit ProfitDistributed(profitTotal, operatorFee);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function getMyAccount() external view returns (
        uint256 principal,
        uint256 pendingProfit,
        uint256 realizedProfit,
        bool isPaused,
        uint256 totalValue,
        uint256 availableProfit,
        uint256 availablePrincipal
    ) {
        UserAccount storage user = accounts[msg.sender];
        return (
            user.principal,
            user.pendingProfit,
            user.realizedProfit,
            user.isPaused,
            user.principal + user.pendingProfit,
            user.pendingProfit,
            user.principal
        );
    }
}
```

---

### Individual User Control (Key Feature)

**Each user can independently control their funds:**

| Function | Action |
|----------|--------|
| `pauseMyFunds()` | User A pauses → only their funds stop trading |
| `unpauseMyFunds()` | User A resumes → their funds back in pool |
| `getMyAccount()` | Check status (paused/active, balances) |

**Scenario:**
- User A: Calls `pauseMyFunds()` → their $5k removed from trading pool
- User B: Continues trading normally ($10k in pool)
- User C: Continues trading normally ($2k in pool)
- Bot trades with $12k (B + C only)
- User A's profit frozen, can still claim or withdraw

---

### Profit Distribution Formula

```solidity
// Your share = (Your Principal / Total Active Principal) × Net Profit
uint256 yourShare = (accounts[user].principal * netProfit) / totalPrincipal;
```

**Example:**
- User A: $5,000 (29.4% of pool)
- User B: $10,000 (58.8% of pool)  
- User C: $2,000 (11.8% of pool)
- Bot makes $1,700 profit
- Fee (20%): $340 to operator
- Net to users: $1,360

| User | Share | Gets |
|------|-------|------|
| A | 29.4% | $400 |
| B | 58.8% | $800 |
| C | 11.8% | $160 |

---

### Profit Impact: Solo vs Vault (For Low Portfolio Users)

```
SOLO TRADING (User has $1,000):
┌─────────────────────────────────────────────────────────────────────┐
│ • Max opportunity = your capital (limited to small opps)          │
│ • Pay full gas ($3-5 per trade)                                    │
│ • Missing big opportunities (can't afford them)                   │
│ • Realistic monthly profit: ~$100-150                            │
└─────────────────────────────────────────────────────────────────────┘

VAULT TRADING (User has $1,000 in $100k pool):
┌─────────────────────────────────────────────────────────────────────┐
│ • Can take ALL opportunities (small to $10k+)                     │
│ • Gas shared among 100 users (~$0.03/trade each)                 │
│ • More opportunities taken = more profit                          │
│ • Realistic monthly profit: ~$400-600                            │
│ • 3-4x better ROI than solo trading                                │
└─────────────────────────────────────────────────────────────────────┘

Why Vault is Better for Small Investors:
1. Access to bigger opportunities (solo can't afford)
2. Lower gas costs (shared)
3. More opportunities captured (capital not limiting factor)
4. Professional bot execution (better than amateur trading)
```

---

## Objective 4: SaaS Model Architecture

### Revenue Model

| Model | Description | Fee Structure |
|-------|-------------|---------------|
| **Performance Fee** | Take % of profits | 15-20% of net profit |
| **Management Fee** | Flat monthly fee | Optional |
| **Hybrid** | Both performance + management | 15% + small monthly |

### Vault Parameters for SaaS

| Parameter | Value |
|-----------|-------|
| Performance Fee | 15-20% |
| Min Deposit | $10 |
| Max Deposit | $100,000 |
| Min Withdraw | $1 |
| Emergency Delay | 24 hours |

---

### User Flow

```
New User
    │
    ▼
┌─────────────────────────┐
│ 1. Connect Wallet        │ ← Metamask, WalletConnect
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 2. Deposit ETH/USDC     │ ← Min $10, Max $100k
│    (Min: $10)           │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 3. Auto-Unpause         │ ← Funds ready for trading
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 4. Earn Continuously    │ ← Bot trades, profit accumulates
│                         │ ← Check dashboard anytime
└──────────┬──────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Withdraw      Stay
    │             │
    ▼             ▼
Custom       Continue
Amount        Earning
```

---

## Objective 5: Security Audit & Vulnerability Analysis

### Critical Security Areas

#### A. Smart Contract Security

| Vulnerability | Risk Level | Mitigation |
|---------------|------------|------------|
| **Reentrancy** | Critical | Use ReentrancyGuard on all functions |
| **Access Control** | Critical | Role-based modifiers (executor vs admin) |
| **Integer Overflow** | High | Solidity 0.8+ built-in checks |
| **Flash Loan Attack** | High | Profit verification, slippage limits |
| **Price Oracle Manipulation** | High | Use TWAP, multi-source oracle |
| **Vault Drain** | Critical | Rate limiting, max withdrawal limits |
| **User Fund Isolation** | Critical | Each user's funds independent |

#### B. Vault-Specific Security

| Risk | Mitigation |
|------|------------|
| User A affects User B | Each account isolated |
| Executor steals funds | Executor can trade, CANNOT withdraw user funds |
| Admin rug pull | 24h timelock, multi-sig for critical functions |
| Bank run | Rate limiting, optional daily caps |
| Pause abuse | User can unpause anytime immediately |

#### C. Endpoint Protection

| Area | Protection |
|------|------------|
| RPC Endpoints | Rate limiting, multiple providers |
| Backend API | Input validation, sanitization |
| Database | Parameterized queries, ORM |
| Private Key | KMS, encrypted env vars, never commit |
| Websocket | Connection limits, message rate limiting |

#### D. Rate Limiting

```solidity
uint256 public dailyWithdrawLimitBps = 2500; // 25% of balance per 24h
mapping(address => uint256) public withdrawalAmounts24h;
```

---

## Implementation Priority

### Phase 1 (Weeks 1-2): Foundation
1. ✅ Remove front-run, keep back-run only
2. ✅ Expand DEX support to 10+
3. Create vault contract with finalized parameters

### Phase 2 (Weeks 3-4): Vault Core
1. Implement deposit/withdraw logic with custom amounts
2. Add individual pause/unpause for users
3. Add role-based access (executor vs admin)
4. Implement profit distribution (proportional)
5. Add performance fee collection

### Phase 3 (Weeks 5-6): Security
1. Comprehensive security audit
2. Fix all vulnerabilities found
3. Add rate limiting and circuit breakers
4. Implement emergency controls

### Phase 4 (Weeks 7-8): SaaS Features
1. Dashboard for users
2. Admin panel for operator
3. Multi-chain support
4. Production deployment

---

## Success Metrics

| Metric | Target |
|--------|--------|
| DEX Support | 10+ exchanges |
| Vault Security | No critical vulnerabilities |
| User Control | Individual pause/resume |
| Withdrawal | Custom amounts (any profit + any principal) |
| Uptime | 99.9% |
| User Capacity | 1000+ users |
| Fee Structure | 15-20% performance fee |
| Min Investment | $10 |

---

## Notes

- Vault and overall security is the CORE of this project - prioritize them
- User control (pause/resume) is critical differentiator
- Low portfolio users benefit most from vault (3-4x better ROI)
- Security is paramount - no shortcuts
- Before taking any critical decision, also backtrack to see if you're not breaking anything
- Think like a security auditor/analyst while making every small and big security moves.

- Front-run removal is non-negotiable (legal/safety)
---

## Objective 6: User-Led Security (Self-Freeze & Guardians)

### Current State
- Withdrawals are atomic (instant)
- If a private key is stolen, funds can be drained before the user can react
- Only admin has "Global Pause" power

### Target
- **2-Step Withdrawal Pipeline**: Every withdrawal requires a 12-hour "Request" period.
- **Self-Freezing**: Users can immediately freeze their own account if they see a suspicious withdrawal request.
- **Guardian Support**: Users can set a secondary hardware wallet or friend's address as a "Guardian" to freeze their account or help with recovery.
- **Unfreeze Delay**: Frozen accounts require a mandatory 3-day "cooling off" period to unfreeze, preventing hackers from quickly reversing a move.

### Implementation Plan

1. **Phase 1: Smart Contract Upgrades**
   - Add `withdrawalRequest` tracking to `UserAccount` struct.
   - Implement `requestWithdrawal()` and `executeWithdrawal()` functions.
   - Implement `freezeAccount()` (accessible by user and guardian).
   - Implement `initiateUnfreeze()` with the 3-day timelock.

2. **Phase 2: Notification Backend**
   - Update `VaultService.ts` to detect `WithdrawalRequested` events.
   - Integrate with an alert system (Telegram/Email) to notify users in real-time.

3. **Phase 3: Frontend Security Dashboard**
   - Build a UI for users to manage their "Guardian" address.
   - Add a large "Freeze My Account" button for emergency use.
   - Add a progress bar for pending withdrawals.

---
## Success Metrics (Updated)

| Metric | Target |
|--------|--------|
| Withdrawal Security | 12h Challenge Period for all txns |
| Account Recovery | 3-day Unfreeze Delay |
| User Autonomy | 100% (No admin needed for freezing) |
