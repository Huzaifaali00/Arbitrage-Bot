# ArbitrageBot Deployment Checklist

## Pre-Deployment Review (Do This First!)

### Code Review
- [ ] Read `AUDIT_ANALYSIS.md` completely
- [ ] Read `IMPLEMENTATION_GUIDE.md` completely  
- [ ] Understand each of the 13 vulnerabilities and fixes
- [ ] Review `src/ArbitrageBot.sol` line by line
- [ ] Review test file `test/ArbitrageBot.t.sol`
- [ ] Verify all imports are correct
- [ ] Check compilation: `forge build` ✅ SUCCESS

### Functionality Review
- [ ] Understand `executeSandwich()` parameters
- [ ] Understand `executeMultiHopArb()` parameters
- [ ] Understand approval workflow (pools + tokens)
- [ ] Understand withdrawal functions
- [ ] Understand pause/unpause mechanism
- [ ] Understand two-step ownership transfer

### Security Review
- [ ] Reentrancy guard uses OpenZeppelin ✅
- [ ] Pool whitelist required before trading ✅
- [ ] Token whitelist required before trading ✅
- [ ] ETH transfer uses call pattern ✅
- [ ] Swap deadlines validated ✅
- [ ] Callbacks multi-validated ✅
- [ ] Max hops limited to 10 ✅
- [ ] Emergency pause available ✅

---

## Testing Phase

### Unit Tests
- [ ] Run full test suite: `forge test`
- [ ] All tests pass
- [ ] No errors or warnings (except lints)
- [ ] Coverage > 90%: `forge coverage`
- [ ] Test specific security features: `forge test --match "test_only_owner"`

### Manual Testing

#### Setup Test Network (Sepolia)
- [ ] Have Sepolia RPC endpoint
- [ ] Have private key with Sepolia ETH
- [ ] Have Etherscan API key for verification

#### Deploy to Sepolia
```bash
forge script script/Deploy.s.sol:DeployArbitrageBot \
    --rpc-url $SEPOLIA_RPC \
    --private-key $PRIVATE_KEY \
    --broadcast
```
- [ ] Deployment succeeds
- [ ] Contract address noted
- [ ] Owner address correct
- [ ] Contract verified on Etherscan

#### Setup Whitelists on Sepolia
- [ ] Approve at least 2 test pools
- [ ] Approve at least 2 test tokens
- [ ] Verify approvals: `cast call`

#### Fund Test Contract
- [ ] Send test ETH to contract
- [ ] Send test tokens to contract
- [ ] Verify balances: `cast call`

#### Test Sandwich Function
- [ ] Call `executeSandwich()` with test parameters
- [ ] Transaction succeeds
- [ ] Event emitted correctly
- [ ] Profit tracked correctly
- [ ] Verify withdrawal works

#### Test Multi-Hop Function
- [ ] Call `executeMultiHopArb()` with 2 hops
- [ ] Transaction succeeds
- [ ] Event emitted correctly
- [ ] Profit tracked correctly

#### Test Admin Functions
- [ ] `pause()` works
- [ ] Trading blocked when paused
- [ ] `unpause()` works
- [ ] Trading resumes

#### Test Withdrawal Functions
- [ ] `withdrawProfit(token)` works
- [ ] Profit resets to 0
- [ ] `withdrawAll(token)` works
- [ ] Balance transfers correctly
- [ ] `withdrawETH()` works

#### Test Error Handling
- [ ] Unapproved pool rejected
- [ ] Unapproved token rejected
- [ ] Expired deadline rejected
- [ ] Zero amount rejected
- [ ] Too many hops rejected
- [ ] Hacker cannot call admin functions

#### Test Pause/Unpause
- [ ] Pause prevents trading
- [ ] Unpause enables trading
- [ ] Only owner can pause/unpause
- [ ] Events emitted correctly

#### Test Ownership Transfer
- [ ] `transferOwnership()` sets pending owner
- [ ] Old owner still in control
- [ ] `acceptOwnership()` from pending owner works
- [ ] New owner now in control
- [ ] Only pending owner can accept

---

## Pre-Mainnet Final Checks

### Gas Optimization
- [ ] Test gas costs on Sepolia
- [ ] 2-hop sandwich ~250k gas
- [ ] 3-hop arb ~450k gas
- [ ] 10-hop arb ~1.2M gas
- [ ] Acceptable for your use case

### Integration Testing
- [ ] Off-chain bot code written
- [ ] Off-chain bot tested with contract
- [ ] Profit calculation verified
- [ ] Event parsing verified
- [ ] Transaction submission tested

### Documentation
- [ ] Pool whitelist documented
- [ ] Token whitelist documented
- [ ] Important addresses documented
- [ ] Deployment config saved
- [ ] Emergency procedures documented

### Security Preparations
- [ ] Dedicated bot wallet created (not your main wallet)
- [ ] Multi-sig wallet for owner (optional but recommended)
- [ ] Private RPC selected (avoid public RPC for transactions)
- [ ] Monitor service configured
- [ ] Alert system configured
- [ ] Emergency pause trigger documented

### Financial Preparations
- [ ] Initial capital allocated
- [ ] Daily loss limits set
- [ ] Profit extraction schedule planned
- [ ] Gas budget calculated
- [ ] Slippage parameters conservative

---

## Mainnet Deployment

### Pre-Deployment Final Check
- [ ] All Sepolia testing completed
- [ ] Independent audit completed (RECOMMENDED)
- [ ] Team reviewed all documentation
- [ ] All signatories approved deployment
- [ ] Monitoring systems online
- [ ] Emergency contacts ready
- [ ] ✅ All above checkboxes completed

### Deployment Steps

```bash
# 1. Deploy to mainnet
forge script script/Deploy.s.sol:DeployArbitrageBot \
    --rpc-url $MAINNET_RPC \
    --private-key $PRIVATE_KEY \
    --broadcast
```
- [ ] Deployment succeeds
- [ ] Contract address noted
- [ ] Etherscan verification (wait 30 seconds before verifying)

```bash
# 2. Verify on Etherscan
forge verify-contract <address> ArbitrageBot \
    --etherscan-api-key $ETHERSCAN_KEY
```
- [ ] Contract verified on Etherscan
- [ ] Source code visible
- [ ] ABI accessible

### Post-Deployment Setup

#### Whitelist Pools
- [ ] Research top Uniswap V3 pools
- [ ] Start with major pools: ETH-USDC, ETH-DAI, USDC-DAI, etc.
- [ ] Call `approvePool()` for each
- [ ] Verify on Etherscan

#### Whitelist Tokens
- [ ] WETH, USDC, DAI, USDT minimum
- [ ] Add others based on strategy
- [ ] Call `approveToken()` for each
- [ ] Verify on Etherscan

#### Fund Contract
- [ ] Send initial capital (start small!)
- [ ] Record transaction hash
- [ ] Verify balance on Etherscan
- [ ] Example: 10 ETH + stablecoins

### Post-Deployment Validation

#### On-Chain Verification
- [ ] Check owner: `cast call <addr> "owner()" --rpc-url $MAINNET_RPC`
- [ ] Check paused status: `cast call <addr> "paused()" --rpc-url $MAINNET_RPC`
- [ ] Check ETH balance: `cast call <addr> "getETHBalance()" --rpc-url $MAINNET_RPC`
- [ ] Verify events are emitted correctly
- [ ] Verify no unusual errors

#### Off-Chain Verification  
- [ ] Monitor service connected and running
- [ ] Bot receiving contract events
- [ ] Profit tracking working
- [ ] Withdrawal logic tested
- [ ] Alerts working

---

## First Week Operations

### Day 1: Conservative Testing
- [ ] Start with very small amounts (0.1 ETH equivalent)
- [ ] Execute 5-10 test trades
- [ ] Monitor all events
- [ ] Check profit calculation
- [ ] Test withdrawal function
- [ ] No losses should occur

### Day 2-3: Gradual Scale-Up
- [ ] Increase amounts to 1 ETH equivalent
- [ ] Execute 20+ trades
- [ ] Monitor gas costs
- [ ] Verify profitability
- [ ] Check for any issues

### Day 4-7: Full Operations
- [ ] Scale to full capital allocation
- [ ] Execute normal trading operations
- [ ] Daily profit tracking
- [ ] Weekly report generation
- [ ] Check for any vulnerabilities
- [ ] Adjust thresholds as needed

### Continuous Monitoring
- [ ] Daily review of profits
- [ ] Daily review of event logs
- [ ] Weekly security check
- [ ] Weekly gas cost analysis
- [ ] Monthly profit report

---

## Ongoing Maintenance

### Regular Tasks (Daily)
- [ ] Check contract balance
- [ ] Review profit tracker
- [ ] Monitor for errors
- [ ] Check gas prices
- [ ] Review transaction success rate

### Regular Tasks (Weekly)
- [ ] Withdraw accumulated profits
- [ ] Analyze profitable strategies
- [ ] Check for market changes
- [ ] Review competitors' activities
- [ ] Update pool/token whitelists if needed

### Regular Tasks (Monthly)
- [ ] Generate P&L report
- [ ] Analyze strategy performance
- [ ] Optimize parameters
- [ ] Plan next month's operations
- [ ] Security review

### Maintenance Tasks (As Needed)
- [ ] Update whitelists for new pools
- [ ] Adjust minimum profit thresholds
- [ ] Emergency pause if issues detected
- [ ] Adjust gas settings
- [ ] Update off-chain bot parameters

---

## Emergency Procedures

### If Contract Gets Stuck/Locked
1. [ ] Identify the issue
2. [ ] Call `pause()` immediately
3. [ ] Review logs
4. [ ] Call `acceptOwnership()` on new owner if needed
5. [ ] Withdraw remaining funds
6. [ ] Deploy new version

### If Unexpected Losses Detected
1. [ ] Call `pause()` immediately
2. [ ] Stop all trading
3. [ ] Investigate the cause
4. [ ] Fix the issue
5. [ ] Deploy fix or patch
6. [ ] Resume operations cautiously

### If Security Vulnerability Found
1. [ ] Call `pause()` immediately
2. [ ] Alert team
3. [ ] Investigate severity
4. [ ] If critical: `acceptOwnership()` to safe wallet
5. [ ] Withdraw all funds
6. [ ] Publish incident report
7. [ ] Deploy patched version

---

## Completion Checklist

### Before Launching
- [ ] All documentation read and understood
- [ ] All testing completed successfully
- [ ] All Sepolia testing passed
- [ ] Security review completed
- [ ] Financial planning done
- [ ] Monitoring systems online
- [ ] Emergency procedures documented
- [ ] Team trained
- [ ] Approvals obtained

### Deployment Complete When
- [ ] Contract deployed to mainnet
- [ ] Contract verified on Etherscan
- [ ] Pools whitelisted
- [ ] Tokens whitelisted
- [ ] Initial capital funded
- [ ] Off-chain bot operational
- [ ] First trades executed successfully
- [ ] Profits tracking correctly
- [ ] All systems green

---

## Notes & Observations

After first week, document:
- [ ] Actual vs projected profits
- [ ] Gas costs accuracy
- [ ] Failure rate and causes
- [ ] Best performing pools
- [ ] Best performing times
- [ ] Adjustments needed
- [ ] Lessons learned

---

**Remember**: Start small, test thoroughly, monitor continuously, and scale gradually!

Good luck! 🚀
