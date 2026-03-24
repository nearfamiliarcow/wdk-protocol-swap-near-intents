# @tetherto/wdk-protocol-swap-near-intents

**Note**: This package is currently in beta. Please test thoroughly in development environments before using in production.

A chain-agnostic WDK swap protocol that wraps the [NEAR Intents 1Click API](https://docs.near-intents.org/) for cross-chain token swaps across 29+ blockchains. Works with any WDK wallet implementation — EVM, Solana, BTC, TON, Tron — with no chain-specific logic.

This package also includes **OneClickPay**, a payment helper that enables "pay anyone in USDT from any asset you hold" with exact-output guarantees and automatic refunds.

This module can be managed by the [`@tetherto/wdk`](https://github.com/tetherto/wdk-core) package, which provides a unified interface for managing multiple WDK wallet and protocol modules across different blockchains.

## About WDK

This module is part of the [**WDK (Wallet Development Kit)**](https://wallet.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control.

For detailed documentation about the complete WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

## Features

- **Cross-Chain Swaps**: Swap tokens across 29+ blockchains via NEAR Intents routing
- **Chain-Agnostic**: Works with any WDK wallet (EVM, Solana, BTC, TON, Tron) — no chain-specific imports
- **Deposit-Address Model**: Get a quote, deposit to an address, settlement happens automatically
- **Cross-Pay (USDT)**: Pay anyone in USDT from any asset — recipient gets the exact dollar amount
- **Automatic Refunds**: If price moves beyond slippage tolerance, deposits are refunded automatically
- **Partial Refund Support**: EXACT_OUTPUT payments refund excess deposits back to sender
- **Status Polling**: Track swap progress from deposit to settlement with detailed status updates
- **App Fees**: Built-in support for application-level fee collection
- **JWT Authentication**: Authenticated quotes get better rates (unauthenticated incur +0.2% fee)
- **TypeScript Support**: Full TypeScript definitions included

## Installation

```bash
npm install @tetherto/wdk-protocol-swap-near-intents
```

## Quick Start

### Cross-Chain Swap

```javascript
import OneClickProtocol from '@tetherto/wdk-protocol-swap-near-intents'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

// Create wallet account (EVM wallets use `new` — synchronous constructor)
const account = new WalletAccountEvm(seedPhrase, "0'/0/0", {
  provider: 'https://mainnet.base.org'
})

// Create swap protocol for Base chain
const protocol = new OneClickProtocol(account, {
  sourceChain: 'base',
  jwt: 'your-1click-jwt-token'
})

// Get a quote (dry run — no funds at risk)
const quote = await protocol.quoteSwap({
  tokenIn: 'native',
  tokenOut: 'native',
  tokenInAmount: 1000000000000000n, // 0.001 ETH
  destinationChain: 'sol',
  to: 'SOLANA_RECIPIENT_ADDRESS'
})

console.log('You send:', quote.tokenInAmount)   // BigInt
console.log('You receive:', quote.tokenOutAmount) // BigInt
console.log('Est. time:', quote.timeEstimate, 'seconds')
console.log('Est. deposit fee:', quote.fee)       // BigInt (gas estimate)

// Execute the swap
const result = await protocol.swap({
  tokenIn: 'native',
  tokenOut: 'native',
  tokenInAmount: 1000000000000000n,
  destinationChain: 'sol',
  to: 'SOLANA_RECIPIENT_ADDRESS'
})

console.log('Deposit TX:', result.hash)
console.log('Deposit fee:', result.fee)             // actual gas cost
console.log('Deposit address:', result.depositAddress)
console.log('Correlation ID:', result.correlationId) // for support

// Poll for completion
const poll = async () => {
  const status = await protocol.getSwapStatus(result.depositAddress)
  console.log('Status:', status.status)
  console.log('Origin TX:', status.originTxHash)
  console.log('Dest TX:', status.destinationTxHash)

  if (status.terminal) {
    if (status.refundedAmountFormatted && status.refundedAmountFormatted !== '0') {
      console.log('Partial refund:', status.refundedAmountFormatted)
    }
    return status
  }
  // Poll every 10 seconds
  await new Promise(r => setTimeout(r, 10000))
  return poll()
}

const finalStatus = await poll()
```

### Cross-Pay (USDT Payments)

```javascript
import OneClickProtocol from '@tetherto/wdk-protocol-swap-near-intents'
import { OneClickPay } from '@tetherto/wdk-protocol-swap-near-intents'
import { WalletAccountSolana } from '@tetherto/wdk-wallet-solana'

// Create Solana wallet (Solana wallets use async `at()` factory — not `new`)
const account = await WalletAccountSolana.at(seedPhrase, "0'/0/0", {
  rpcUrl: 'https://api.mainnet-beta.solana.com'
})

// Create protocol + pay helper
const protocol = new OneClickProtocol(account, {
  sourceChain: 'sol',
  jwt: 'your-1click-jwt-token'
})

const pay = new OneClickPay(protocol, {
  slippageBps: 200,           // 2% slippage tolerance
  acceptedSymbols: 'all'      // accept USDT + USDT0 variants
})

// Quote: "How much SOL to send $50 USDT to Arbitrum?"
const quote = await pay.quotePay({
  tokenIn: 'native',
  amount: 50,                              // $50 USDT
  recipientAddress: 'RECIPIENT_ADDRESS',
  recipientChain: 'arb'
})

console.log('Cost:', quote.costFormatted)  // e.g., "0.5842 SOL"
console.log('Slippage:', quote.slippageBps / 100 + '%')

// Execute payment
const result = await pay.pay({
  tokenIn: 'native',
  amount: 50,
  recipientAddress: 'RECIPIENT_ADDRESS',
  recipientChain: 'arb'
})

console.log('Paid:', result.amountPaid)          // BigInt in lamports
console.log('Recipient gets:', result.amountReceived, 'USDT')
console.log('Deposit TX:', result.hash)

// Poll for completion
const status = await pay.getPaymentStatus(result.depositAddress)
```

### Using with WDK Core

```javascript
import WDK from '@tetherto/wdk'
import { WalletManagerEvm } from '@tetherto/wdk-wallet-evm'
import OneClickProtocol from '@tetherto/wdk-protocol-swap-near-intents'

const wdk = new WDK(seedPhrase)
  .registerWallet('base', WalletManagerEvm, {
    provider: 'https://mainnet.base.org'
  })
  .registerProtocol('base', 'oneclick', OneClickProtocol, {
    sourceChain: 'base',
    jwt: 'your-jwt-token'
  })

const account = await wdk.getAccount('base', 0)
const swap = account.getSwapProtocol('oneclick')

const result = await swap.swap({
  tokenIn: 'native',
  tokenOut: 'native',
  tokenInAmount: 1000000000000000n,
  destinationChain: 'sol',
  to: 'SOLANA_ADDRESS'
})
```

## How It Works

Unlike atomic swap protocols (e.g., Velora/ParaSwap), the 1Click protocol uses a **deposit-address model**:

1. **Quote** — Call the 1Click API to get an exchange rate and deposit address
2. **Deposit** — Transfer tokens to the deposit address on the source chain
3. **Settlement** — The 1Click backend routes the swap through NEAR Intents and delivers tokens on the destination chain
4. **Poll** — Check `getSwapStatus()` until the swap reaches a terminal state

`swap()` returns when the deposit transaction broadcasts — **not when the swap settles**. Settlement can take 15–60+ seconds depending on chains involved. Always poll `getSwapStatus()` for completion.

## API Reference

### OneClickProtocol

#### Constructor

```javascript
new OneClickProtocol(account, config)
```

| Parameter | Type | Description |
|---|---|---|
| `account` | `IWalletAccount` | Any WDK wallet account |
| `config.sourceChain` | `string` | **Required.** 1Click chain ID: `"eth"`, `"sol"`, `"btc"`, `"base"`, `"arb"`, `"ton"`, `"tron"`, etc. |
| `config.jwt` | `string` | Bearer JWT for authenticated endpoints. Required for `swap()`. Unauthenticated quotes incur +0.2% fee. |
| `config.slippageBps` | `number` | Slippage tolerance in basis points. Default: `100` (1%). |
| `config.deadlineMs` | `number` | Quote validity in milliseconds. Default: `600000` (10 min). |
| `config.swapMaxFee` | `number \| bigint` | Maximum deposit transaction fee. Swap is rejected if gas meets or exceeds this. |
| `config.depositTxOptions` | `Object` | Extra params spread into deposit transactions for both native (`sendTransaction`) and token (`transfer`) paths (e.g., BTC `feeRate`). |
| `config.quoteWaitingTimeMs` | `number` | How long the relay waits for market maker quotes. `3000` can yield better rates on illiquid pairs. |
| `config.appFees` | `Array<{recipient, fee}>` | Application fees in basis points. |
| `config.referral` | `string` | Referral identifier for partner tracking. |
| `config.baseUrl` | `string` | Override 1Click API URL. Default: `https://1click.chaindefuser.com` |

#### `quoteSwap(options)` → `Promise<QuoteResult>`

Get a swap quote without executing. No funds at risk.

| Option | Type | Description |
|---|---|---|
| `tokenIn` | `string` | Source token address, or `'native'` for native asset |
| `tokenOut` | `string` | Destination token address, or `'native'` |
| `tokenInAmount` | `bigint` | Exact input amount (mutually exclusive with `tokenOutAmount`) |
| `tokenOutAmount` | `bigint` | Exact output amount (mutually exclusive with `tokenInAmount`) |
| `destinationChain` | `string` | 1Click chain ID for the destination |
| `to` | `string` | Recipient address on destination chain |

**Returns:**

| Field | Type | Description |
|---|---|---|
| `fee` | `bigint` | Estimated deposit transaction gas cost (approximation using placeholder address) |
| `tokenInAmount` | `bigint` | Amount to send in source token base units |
| `tokenOutAmount` | `bigint` | Amount to receive in destination token base units |
| `timeEstimate` | `number` | Estimated settlement time in seconds |

#### `swap(options)` → `Promise<OneClickSwapResult>`

Execute a cross-chain swap. Deposits tokens and returns when the deposit transaction broadcasts.

Takes the same options as `quoteSwap()`. Requires `jwt` in config.

**Returns:**

| Field | Type | Description |
|---|---|---|
| `hash` | `string` | Deposit transaction hash on the source chain |
| `fee` | `bigint` | Actual deposit transaction gas cost |
| `tokenInAmount` | `bigint` | Amount deposited |
| `tokenOutAmount` | `bigint` | Expected output amount |
| `depositAddress` | `string` | Address tokens were deposited to (use for status polling) |
| `depositMemo` | `string \| undefined` | Deposit memo for memo-based chains (Stellar forward-compat) |
| `correlationId` | `string` | Unique ID for support requests |
| `quoteSignature` | `string` | Cryptographic commitment to quoted terms |
| `quoteResponse` | `Object` | Full 1Click API response for debugging/dispute resolution |

#### `getSwapStatus(depositAddress, depositMemo?)` → `Promise<OneClickSwapStatusResult>`

Poll the execution status of a swap. The optional `depositMemo` parameter is for forward-compatibility with memo-based chains (e.g., Stellar).

**Returns:**

| Field | Type | Description |
|---|---|---|
| `status` | `string` | `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED` |
| `terminal` | `boolean` | `true` if `SUCCESS`, `REFUNDED`, or `FAILED` |
| `correlationId` | `string` | For support requests |
| `updatedAt` | `string` | ISO 8601 timestamp of last status change |
| `originTxHash` | `string \| null` | Deposit transaction hash on source chain |
| `destinationTxHash` | `string \| null` | Delivery transaction hash on destination chain |
| `refundedAmount` | `string \| null` | Refunded amount in base units (string-encoded) |
| `refundedAmountFormatted` | `string \| null` | Human-readable refunded amount |
| `refundedAmountUsd` | `string \| null` | Refunded amount in USD |
| `refundReason` | `string \| null` | Reason for refund if provided |
| `swapDetails` | `Object` | Full raw swap details from the 1Click API |

#### `getSupportedTokens()` → `Promise<Array>`

Returns the full list of tokens supported by the 1Click API. Each entry contains:

| Field | Type | Description |
|---|---|---|
| `assetId` | `string` | 1Click NEP-141 asset ID |
| `decimals` | `number` | Token decimal places |
| `blockchain` | `string` | 1Click chain ID |
| `symbol` | `string` | Token symbol (e.g., `"USDT"`, `"ETH"`) |
| `price` | `string` | Current price in USD |
| `contractAddress` | `string \| null` | Token contract address, or `null` for native assets |

#### `resolveToken(chain, tokenAddress)` → `Promise<Object>`

Resolves a WDK token address to a 1Click asset entry. Pass `'native'` for native assets. Returns `{ assetId, isNative, decimals, symbol }`.

#### `sourceChain` (getter) → `string`

Returns the 1Click chain identifier this protocol instance is configured for.

### OneClickPay

Payment helper for "pay anyone in USDT from any asset." Uses `EXACT_OUTPUT` to guarantee the recipient receives the exact amount requested.

#### Constructor

```javascript
new OneClickPay(protocol, config)
```

| Parameter | Type | Description |
|---|---|---|
| `protocol` | `OneClickProtocol` | An initialized protocol instance |
| `config.acceptedSymbols` | `string \| string[]` | `'native'` (default, natively issued USDT only — not native blockchain assets), `'all'` (USDT + USDT0 + future variants), or explicit array e.g. `['USDT', 'USDT0']` |
| `config.slippageBps` | `number` | Slippage tolerance. Default: `200` (2%). |
| `config.deadlineMs` | `number` | Quote deadline. Default: `7200000` (2 hours). |
| `config.quoteWaitingTimeMs` | `number` | Relay wait time. Default: `3000` (3 seconds). |
| `config.appFees` | `Array<{recipient, fee}>` | Application fees in basis points. |
| `config.referral` | `string` | Referral identifier. |

#### `quotePay(options)` → `Promise<PayQuote>`

| Option | Type | Description |
|---|---|---|
| `tokenIn` | `string` | Source token address or `'native'` |
| `amount` | `number \| string` | USDT amount in human units (e.g., `50` for $50) |
| `recipientAddress` | `string` | Recipient's address on destination chain |
| `recipientChain` | `string` | 1Click chain ID (e.g., `"eth"`, `"sol"`, `"ton"`) |
| `tokenOut` | `string` | *(Optional)* Explicit USDT variant contract address. Bypasses auto-resolution. |
| `slippageBps` | `number` | *(Optional)* Override slippage tolerance for this call only. |

**Returns:** `{ costFormatted, costBaseUnits, costSymbol, amount, recipientChain, timeEstimate, slippageBps }`

#### `pay(options)` → `Promise<PayResult>`

Same options as `quotePay()` (including optional `tokenOut` and `slippageBps` overrides).

**Returns:** `{ hash, depositAddress, amountPaid, amountReceived, recipientChain, recipientAddress, correlationId, quoteResponse }`

#### `getPaymentStatus(depositAddress)` → `Promise<OneClickSwapStatusResult>`

Delegates to `protocol.getSwapStatus()`. Returns the same status shape.

#### `getSupportedPaymentChains()` → `Promise<string[]>`

Returns chain IDs where USDT is available (e.g., `["eth", "sol", "ton", "arb", ...]`).

#### `getUSDTOptions(chain)` → `Promise<Array>`

Returns all USDT variants available on a specific chain.

## Supported Chains

The 1Click API supports 29+ chains. Common chain IDs:

| Chain ID | Network |
|---|---|
| `eth` | Ethereum |
| `base` | Base |
| `arb` | Arbitrum |
| `pol` | Polygon |
| `op` | Optimism |
| `bsc` | BNB Chain |
| `avax` | Avalanche |
| `sol` | Solana |
| `btc` | Bitcoin |
| `ton` | TON |
| `tron` | Tron |
| `near` | NEAR |

Use `getSupportedTokens()` for the full list.

## Swap Status Values

| Status | Terminal | Description |
|---|---|---|
| `PENDING_DEPOSIT` | No | Waiting for deposit to confirm on source chain |
| `KNOWN_DEPOSIT_TX` | No | Deposit seen, waiting for block confirmation |
| `PROCESSING` | No | Swap executing via NEAR Intents |
| `SUCCESS` | Yes | Funds delivered to recipient |
| `REFUNDED` | Yes | Funds returned to sender (price moved beyond slippage) |
| `FAILED` | Yes | Swap failed |

## Key Concepts

### Deposit-Address Model

Unlike atomic swap protocols where the swap executes in a single on-chain transaction, 1Click uses a two-phase approach:

- `swap()` returns when the **deposit broadcasts** — not when the swap settles
- Settlement happens asynchronously through NEAR Intents (typically 15–60 seconds)
- Always poll `getSwapStatus()` for completion

### Fee Reporting

- `quoteSwap().fee` — Estimated deposit gas cost (uses a placeholder address, may be slightly off for Solana SPL tokens)
- `swap().fee` — Actual deposit gas cost paid on the source chain
- The 1Click protocol fee is embedded in the exchange rate spread, not reported separately

### Partial Refunds

For `EXACT_OUTPUT` payments (OneClickPay), the 1Click system may refund excess deposits:
- User deposits 0.117 SOL to pay $10 USDT
- Only 0.115 SOL was needed at settlement
- 0.002 SOL is refunded automatically (minus a small relayer fee)

Check `refundedAmountFormatted` in the status response to surface this to users.

### JWT Authentication

A JWT token is required for executing swaps. Unauthenticated quote and status requests work but may incur a +0.2% fee penalty on quoted rates.

To obtain a JWT token, visit the [NEAR Intents documentation](https://docs.near-intents.org/) or contact the NEAR Intents team to register as a distribution channel partner.

| Endpoint | JWT Required | Effect |
|---|---|---|
| `quoteSwap()` | No | Works without JWT, but quoted rate has +0.2% penalty |
| `swap()` | **Yes** | JWT must be valid and not expired |
| `getSwapStatus()` | No | Works without JWT; JWT recommended for better rate quotes |

### Solana Rent-Exempt Minimum

Solana accounts must maintain a minimum balance (~0.00089 SOL) to remain rent-exempt. When swapping the full SOL balance, leave enough for the rent-exempt minimum plus the transaction fee, or the transaction simulation will fail.

### Explorer URLs

The 1Click API returns empty `explorerUrl` fields in status responses. If you need block explorer links, you'll need to maintain your own chain-to-URL mapping. The demo includes one for reference (`getExplorerForChain()`).

### `depositMode: "SIMPLE"`

The 1Click API echoes `depositMode: "SIMPLE"` in quote responses. This is an internal routing parameter set by the API — you do not need to send it. The protocol correctly uses `depositType: "ORIGIN_CHAIN"` which is the only mode relevant for WDK wallet integrations.

## Demo

A full demo server and web UI are included in `demo/` for testing cross-chain swaps and cross-pay flows with real funds.

### Setup

```bash
# Copy the example env file
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# BIP-39 seed phrase — DEMO USE ONLY. This seed is used by the demo server
# to derive wallet accounts for BTC, Base (EVM), and Solana. Do NOT use a
# seed phrase that holds significant funds.
WALLET_SEED=your twelve word mnemonic seed phrase here

# 1Click API JWT token for authenticated quotes and swaps.
# Contact the NEAR Intents team or visit https://docs.near-intents.org/ to obtain one.
ONECLICK_JWT=your-jwt-token-here
```

Start the demo:

```bash
node demo/server.js
# Open http://localhost:3000
```

### Demo Wallets

The demo derives 3 wallet accounts from a single seed phrase (BTC, Base EVM, Solana), with the Solana account used for both native SOL and USDT SPL tokens:

| Wallet | Chain | Asset | Description |
|---|---|---|---|
| BTC | Bitcoin | Native BTC | SegWit (bc1q) address |
| ETH (Base) | Base L2 | Native ETH | Low gas fees for testing |
| SOL | Solana | Native SOL | |
| USDT (Solana) | Solana | USDT SPL token | Same address as SOL wallet |

Fund any wallet address shown in the UI to start testing. Base ETH and SOL are the cheapest to test with.

### Demo Features

**Cross-Chain Swap tab:**
- Select source and destination wallets
- Get a quote showing exchange rate and estimated time
- Execute swap and watch live status updates (Pending → Processing → Complete)
- Origin and destination TX hashes with block explorer links
- "Show Advanced" toggle for raw 1Click API response data

**Cross-Pay (USDT) tab:**
- Pay anyone in USDT from any asset you hold
- Uses `EXACT_OUTPUT` — recipient gets the exact dollar amount
- Automatic partial refund if less source asset was needed than deposited
- Supports 17+ destination chains

**Tracking & debugging:**
- **Transaction History** — persists across swap resets; shows status, TX hashes, amounts, refunds, correlation IDs
- **API Event Log** — captures every request/response with timestamps and syntax-highlighted JSON; click entries to expand
- **Balance Refresh** — auto-refreshes on swap completion; manual refresh button in header
- **Partial Refund Display** — shows refunded amount in yellow when EXACT_OUTPUT returns excess funds

### Demo Quirks

- The demo reads `index.html` into memory at startup. If you edit the HTML, restart the server to pick up changes.
- BTC swaps require 1-3 block confirmations (10-60 min) before the 1Click system begins processing.
- Sending near-full SOL balance will fail due to Solana's rent-exempt minimum (~0.00089 SOL).
- The demo uses `https://api.mainnet-beta.solana.com` which has rate limits. For heavy testing, use a dedicated RPC.

## Related Links

- [WDK Documentation](https://docs.wallet.tether.io) — Full WDK ecosystem docs
- [WDK GitHub](https://github.com/tetherto) — WDK wallet and protocol packages
- [NEAR Intents / 1Click API](https://docs.near-intents.org/) — 1Click API documentation
- [1Click API Base URL](https://1click.chaindefuser.com) — API endpoint

## Development

```bash
# Run unit tests
npm test

# Run integration tests (requires .env with real credentials)
npm run test:integration

# Run all tests
npm run test:all

# Lint
npm run lint

# Build TypeScript definitions
npm run build:types
```

## License

Apache-2.0
