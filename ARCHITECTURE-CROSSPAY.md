# Architecture: OneClickPay (Cross-Pay)

## Overview

OneClickPay is a payment helper built on top of `OneClickProtocol`. It enables a simple
UX: **"Pay anyone in USDT from any asset you hold."**

The user says "send Alice $50" and the app shows one number — the cost in their chosen
asset. Under the hood, the helper uses `EXACT_OUTPUT` to guarantee Alice receives exactly
the requested amount, with configurable slippage tolerance to handle price movement between
quote and deposit confirmation. If the price moves beyond the slippage tolerance, the
payment is reversed and the sender gets a full refund (minus network fees).

---

## User Story

**As a wallet user, I want to pay my friend in USDT from any crypto I hold, without
worrying about which chain they're on or how cross-chain swaps work.**

### Happy path

1. Alice tells Bob: "Send me $50 USDT on Arbitrum" (or Bob picks from a contact list)
2. Bob opens the Pay screen and enters: amount ($50), recipient (Alice's address),
   destination chain (Arbitrum)
3. App shows: "Cost: 0.00715 BTC" (a single number, the quoted cost from his BTC wallet)
4. Bob taps "Pay"
5. His BTC wallet deposits to the 1Click deposit address
6. Alice receives exactly 50.000000 USDT on Arbitrum
7. Done — Bob sees a success status

### Price movement scenario

1. Same setup — Bob sees "Cost: 0.00715 BTC" and taps Pay
2. Between quote and BTC confirmation (~10 minutes), BTC drops 1%
3. The 1Click system still delivers exactly 50 USDT to Alice (absorbed by the 2% slippage
   tolerance)
4. Bob effectively paid ~0.00722 BTC instead of 0.00715 — the difference is within slippage

### Refund scenario

1. Same setup — Bob taps Pay
2. BTC drops 3% during confirmation — beyond the 2% slippage tolerance
3. The 1Click system cannot fill the order within the price limit
4. Bob's deposit is refunded to his BTC address (minus the refund network fee)
5. Alice receives nothing — Bob can retry with a new quote

---

## How it plugs into OneClickProtocol

OneClickPay is a thin wrapper — not a new WDK protocol type. It lives in the same package
and composes `OneClickProtocol` methods.

```
┌─────────────────────────────────────────────┐
│              Wallet App (UI)                │
│  "Send Alice $50 USDT on Arbitrum"          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│            OneClickPay                      │
│  - Human dollar amounts → base units        │
│  - Stablecoin resolution per chain          │
│  - EXACT_OUTPUT with slippage               │
│  - Single "cost" number for the user        │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          OneClickProtocol                   │
│  - Quote API calls                          │
│  - Deposit execution                        │
│  - Status polling                           │
│  - Asset registry                           │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           1Click API                        │
│  (NEAR Intents infrastructure)              │
└─────────────────────────────────────────────┘
```

OneClickPay does NOT:
- Make its own API calls (delegates to OneClickProtocol)
- Manage deposit mechanics (delegates to OneClickProtocol)
- Register as a WDK protocol (it's a helper, not a protocol)

OneClickPay DOES:
- Convert human dollar amounts to base units using token decimals from the registry
- Resolve which USDT contract to use on the destination chain
- Present one cost number to the user (from the EXACT_OUTPUT quote)
- Enforce that the output token is always USDT
- Provide a simpler API surface than raw `OneClickProtocol.swap()`

---

## Swap Type: EXACT_OUTPUT

All payments use `EXACT_OUTPUT`. This means:

- The `amount` field in the quote request is the **output amount** (what Alice receives)
- The API calculates the required input (`amountIn`) and returns it
- The protocol deposits `amountIn` worth of the sender's asset
- Alice receives **exactly** the specified amount
- If price moves favorably, excess is refunded to the sender
- If price moves beyond slippage tolerance, the entire deposit is refunded

---

## Slippage Tolerance

Default: **200 basis points (2%)**.

The slippage tolerance is passed to the 1Click API as `slippageTolerance` in the quote
request. The API uses it to:
- Calculate `minAmountOut` (the minimum the recipient will receive)
- If actual execution would deliver less than `minAmountOut`, the swap is reversed
  and the sender receives a refund (minus refund network fees)

### Why 2% and not less

- Stablecoin pairs (USDT ETH → USDT ARB) have near-zero price risk — the
  2% is rarely touched. The actual spread is typically <0.01%.
- Volatile pairs (BTC → USDT) need the buffer because BTC confirmation
  takes 10-60 minutes, during which the BTC/USD price can move significantly.
- 2% is a conservative default that handles most market conditions without causing
  unnecessary refunds.
- The slippage is configurable — apps can expose a UI for users to adjust it
  (e.g., 0.5%, 1%, 2%, custom). Per-payment overrides are supported via the
  `slippageBps` option on `quotePay()` and `pay()`.

### What the user "pays" in slippage

The user does not pay 2% extra. The slippage tolerance is a **ceiling**, not a fee.
If BTC moves 0.3% against the user, they pay 0.3% more — not 2%. The 2% just defines
when the system gives up and refunds instead of filling at a bad price.

---

## Slippage Override Mechanism

`OneClickPay` accepts `slippageBps` as a per-call option on both `quotePay()` and `pay()`.
This overrides the config default for that specific call.

Since `OneClickProtocol._buildQuoteRequest()` reads slippage from `this._config.slippageBps`,
the per-call override is implemented by constructing the underlying `SwapOptions` with a
temporary config. OneClickPay creates the protocol's config at construction time, but when
a per-call `slippageBps` is provided, it overrides the value in the config before delegating
to the protocol. The protocol's `_config` is set via `super(account, config)` in the
constructor and is the same object reference — OneClickPay can mutate `_config.slippageBps`
before each call and restore it after.

Alternatively, since OneClickPay already wraps the protocol, it can construct the full
`SwapOptions` with the per-call slippage and pass a modified config. The simplest correct
approach: OneClickPay stores the protocol's config reference and temporarily overrides
`slippageBps` around each call:

```js
async _callWithSlippage(slippageBps, fn) {
  const original = this._protocol._config.slippageBps
  if (slippageBps != null) {
    this._protocol._config.slippageBps = slippageBps
  }
  try {
    return await fn()
  } finally {
    this._protocol._config.slippageBps = original
  }
}
```

This is safe because JavaScript is single-threaded — no concurrent call can observe the
temporary override. The protocol instance is not shared across async boundaries within
a single `pay()` call.

---

## Stablecoin Resolution

The helper needs to know which USDT contract to use on each destination chain. The output
is always a USDT variant — either legacy USDT or USDT0 (Tether's omnichain USDT) when
available.

### Resolution logic

```js
// Recognized USDT symbol variants
const USDT_SYMBOLS = ['USDT', 'USDT0']

// Find all USDT variants available on a chain
async _resolveUSDTOptions(chain) {
  const tokens = await this._protocol.getSupportedTokens()
  return tokens.filter(t =>
    t.blockchain === chain &&
    USDT_SYMBOLS.includes(t.symbol)
  )
}

// Get the default USDT for a chain (prefers USDT0 when available)
async _resolveUSDT(chain) {
  const options = await this._resolveUSDTOptions(chain)
  if (options.length === 0) {
    throw new Error(`OneClickPay: USDT not available on chain '${chain}'`)
  }
  // Prefer natively issued USDT over USDT0 when both are available
  return options.find(t => t.symbol === 'USDT') ?? options[0]
}
```

### How the wallet app uses this

`getSupportedPaymentChains()` returns chains where any USDT variant is available.
When multiple variants exist on the same chain (e.g., legacy USDT and USDT0), the
wallet app can show both as options:

```js
// Get all USDT options for the selected chain
const options = await pay.getUSDTOptions('eth')
// → [{ symbol: 'USDT', contractAddress: '0xdac1...', assetId: '...' },
//    { symbol: 'USDT0', contractAddress: '0x...', assetId: '...' }]
```

If the user doesn't pick, `quotePay()` and `pay()` use the default (USDT0 preferred).
The user can override by passing `tokenOut` directly — an escape hatch for explicit
variant selection:

```js
// Pay with specific USDT variant
await pay.pay({
  tokenIn: 'native',
  amount: 50,
  recipientAddress: '0xAlice',
  recipientChain: 'eth',
  tokenOut: '0xdac17f958d2ee523a2206206994597c13d831ec7'  // explicit legacy USDT
})
```

### `USDT_SYMBOLS` list

The `USDT_SYMBOLS` array is the single source of truth for which symbols are treated
as USDT variants. When 1Click adds USDT0 support, add the symbol to this array (once
the exact symbol string is known from the token list). No other code changes needed.

**Caching**: `getSupportedTokens()` calls the client directly (not the registry cache).
Resolution results should be memoized inside OneClickPay per chain to avoid redundant
API calls on repeated `quotePay()` invocations.

### Current availability

USDT (native) is available on 12 chains via 1Click:
eth, tron, sol, near, gnosis, pol, bsc, aptos, op, avax, ton, scroll.

USDT0 (omnichain) is already live on additional chains including arb, monad, bera, xlayer,
and plasma. The `USDT_SYMBOLS` filter picks up both variants automatically.

`getSupportedPaymentChains()` returns all chains where at least one USDT variant (USDT or
USDT0) is present. When both exist on the same chain, `getUSDTOptions()` returns both and
the default resolver prefers natively issued USDT.

---

## Amount Handling

The user thinks in human dollars: "$50". The API thinks in base units: `"50000000"`
(USDT has 6 decimals).

```js
/**
 * Convert human-readable amount to base units.
 * Uses string parsing to avoid float precision loss on high-decimal tokens.
 * Truncates fractional digits beyond the token's decimal precision (does not round).
 *
 * @param {number|string|bigint} amount - Human amount (e.g., 50, "50.00", 50n)
 * @param {number} decimals - Token decimal places
 * @returns {bigint}
 */
function toBaseUnits(amount, decimals) {
  if (typeof amount === 'bigint') {
    return amount * (10n ** BigInt(decimals))
  }

  // Parse via string to avoid float multiplication precision loss
  const str = typeof amount === 'number' ? amount.toString() : amount
  const [intPart, fracPart = ''] = str.split('.')

  if (fracPart.length > decimals) {
    throw new Error(
      `OneClickPay: amount has ${fracPart.length} fractional digits ` +
      `but token only supports ${decimals} decimals`
    )
  }

  const paddedFrac = fracPart.padEnd(decimals, '0')
  return BigInt(intPart) * (10n ** BigInt(decimals)) + BigInt(paddedFrac)
}

// $50.00 USDT (6 decimals) → 50000000n
toBaseUnits(50, 6)        // → 50000000n
toBaseUnits("50.00", 6)   // → 50000000n

// $9999.99 DAI (18 decimals) — SAFE, no float loss
toBaseUnits("9999.99", 18) // → 9999990000000000000000n

// Error: too many fractional digits
toBaseUnits("50.1234567", 6) // → throws (7 digits > 6 decimals)
```

The `decimals` value comes from the resolved USDT entry in the token list (6 for USDT).

**Why string parsing**: `Math.round(9999.99 * 10**18)` silently produces a wrong
value due to floating-point precision limits. The string-parsing approach handles
any amount at any decimal count without precision loss. For USDT (6 decimals) the
float approach works fine up to ~$9 billion, but since the helper supports DAI
(18 decimals) and other high-decimal tokens, we use the safe path for all amounts.

**Truncation policy**: If the caller provides more fractional digits than the token
supports, `toBaseUnits` throws an error rather than silently truncating. This prevents
a user intending to send `$50.1234567` from unknowingly sending `$50.123456`.

---

## Deadline

Default: **2 hours** (7200000ms).

Payment deadline is longer than the swap default (10 minutes) because:
- BTC confirmations can take 60+ minutes under congestion
- Users may not broadcast immediately after seeing the quote
- The longer deadline reduces failed payments from timing alone

The deadline is configurable via `deadlineMs` in the pay config.

---

## Quote Waiting Time

Default: **3000ms**.

The `quoteWaitingTimeMs` field tells the 1Click relay how long to wait for market
maker quotes. A longer wait (3s vs default) can yield better rates, especially for
less liquid pairs. This is passed through to the quote request.

---

## Config

```js
/**
 * @typedef {Object} OneClickPayConfig
 * @property {number} [slippageBps]
 *   Slippage tolerance in basis points. Default: 200 (2%).
 *   Configurable by the app or end user. Can be overridden per-call via quotePay/pay options.
 *
 * @property {number} [deadlineMs]
 *   Quote deadline in milliseconds. Default: 7200000 (2 hours).
 *
 * @property {number} [quoteWaitingTimeMs]
 *   How long the relay waits for market maker quotes. Default: 3000 (3 seconds).
 *
 * @property {Array<{recipient: string, fee: number}>} [appFees]
 *   Application-level fees in basis points. Forwarded to the quote request.
 *   Example: [{ recipient: '0xYourFeeAddress', fee: 50 }] for 0.5% app fee.
 *
 * @property {string} [referral]
 *   Referral identifier for partner tracking/analytics. Forwarded to the quote request.
 *   Set this to your partner ID if registered with NEAR Intents.
 */
```

---

## API Surface

```js
class OneClickPay {
  /**
   * @param {OneClickProtocol} protocol - An initialized OneClickProtocol instance.
   * @param {OneClickPayConfig} [config]
   */
  constructor(protocol, config = {}) { ... }

  /**
   * Quote a payment. Shows the user what it will cost in their source asset.
   *
   * @param {Object} options
   * @param {string} options.tokenIn - The source token to pay from. Contract address or 'native'.
   * @param {number|string} options.amount - Human-readable amount (e.g., 50 for "$50").
   * @param {string} options.recipientAddress - Recipient's address on destination chain.
   * @param {string} options.recipientChain - 1Click chain ID (e.g., "arb", "eth", "sol").
   * @param {number} [options.slippageBps] - Override slippage for this quote (default from config).
   * @returns {Promise<PayQuote>}
   */
  async quotePay(options) { ... }

  /**
   * Execute a payment. Deposits sender's asset, recipient gets exact USDT amount.
   *
   * @param {Object} options - Same as quotePay options.
   * @param {string} options.tokenIn - The source token to pay from. Contract address or 'native'.
   * @param {number} [options.slippageBps] - Override slippage for this payment (default from config).
   * @returns {Promise<PayResult>}
   */
  async pay(options) { ... }

  /**
   * Poll payment status. Delegates to OneClickProtocol.getSwapStatus().
   *
   * @param {string} depositAddress - From PayResult.depositAddress.
   * @returns {Promise<OneClickSwapStatusResult>}
   */
  async getPaymentStatus(depositAddress) { ... }

  /**
   * List chains where USDT is available for payments.
   * Excludes chains requiring memo/destination-tag deposits (e.g., Stellar, XRP).
   *
   * @returns {Promise<string[]>} Array of chain IDs (e.g., ["eth", "sol", "ton", ...]).
   */
  async getSupportedPaymentChains() { ... }
}
```

---

## Typedefs

```js
/**
 * @typedef {Object} PayQuote
 * @property {string} costFormatted - Human-readable cost in source asset (e.g., "0.00715 BTC").
 * @property {bigint} costBaseUnits - Cost in source asset base units.
 * @property {string} costSymbol - Source asset symbol (e.g., "BTC").
 * @property {number|string} amount - The payment amount in human units (e.g., 50).
 * @property {string} recipientChain - Destination chain ID.
 * @property {number} timeEstimate - Estimated processing time in seconds.
 * @property {number} slippageBps - Slippage tolerance used for this quote (config or per-call override).
 */

/**
 * @typedef {Object} PayResult
 * @property {string} hash - Deposit transaction hash.
 * @property {string} depositAddress - For status polling.
 * @property {bigint} amountPaid - Actual amount deposited in source asset base units.
 * @property {number|string} amountReceived - The exact USDT amount the recipient gets.
 * @property {string} recipientChain - Destination chain ID.
 * @property {string} recipientAddress - Where USDT was sent.
 * @property {string} correlationId - For support requests.
 * @property {Object} quoteResponse - Full 1Click response for debugging.
 */
```

---

## Internal Flow: `quotePay()`

```
1. Resolve USDT on recipientChain
   - Find token where blockchain === recipientChain && symbol === 'USDT'
   - Get its assetId and decimals
   - Use memoized result if available

2. Convert human amount to base units
   - baseAmount = toBaseUnits(options.amount, usdtDecimals)
   - Throws if fractional digits exceed token decimals

3. Apply per-call slippage override (if provided)
   - Temporarily set protocol._config.slippageBps = options.slippageBps
   - Restore after the call (try/finally)

4. Call protocol.quoteSwap() with:
   - tokenIn: options.tokenIn (the asset the sender is paying from)
   - tokenOut: USDT contract address on destination chain (or 'native' sentinel)
   - tokenOutAmount: baseAmount
   - destinationChain: options.recipientChain
   - to: options.recipientAddress

   Note: quoteSwap() uses dry: true internally — no funds at risk

5. Read the quote response:
   - costBaseUnits = quote.tokenInAmount (what the sender will pay)
   - costFormatted = format(costBaseUnits, sourceAssetDecimals, sourceAssetSymbol)
   - slippageBps = the effective slippage used (config or override)

6. Return PayQuote with the single cost number + metadata
```

---

## Internal Flow: `pay()`

```
1. Same resolution as quotePay() steps 1-3

2. Call protocol.swap() with:
   - tokenIn: options.tokenIn (the asset the sender is paying from)
   - tokenOut: USDT contract address on destination chain
   - tokenOutAmount: baseAmount (EXACT_OUTPUT)
   - destinationChain: options.recipientChain
   - to: options.recipientAddress

   The protocol handles:
   - Live quote (dry: false)
   - All guards (JWT, deadline, depositAddress, memo)
   - Deposit execution
   - Best-effort submitDepositTx

3. Return PayResult with deposit hash, amounts, and polling info
```

---

## What the wallet app builds on top

The wallet app (not this package) is responsible for:

- **Asset selection UI**: Show the user which assets they hold and can pay from.
  The app can call `quotePay()` for each asset in parallel to show comparative costs.
- **Slippage settings UI**: Expose slippage adjustment (0.5%, 1%, 2%, custom).
- **Contact/address book**: Let the user pick recipients.
- **Status screen**: Poll `getPaymentStatus()` and show progress.
- **Refund handling**: When status is `REFUNDED`, show "Payment failed, funds returned."
- **Amount input**: USD input field, validated against the user's balance.
- **Chain selection**: Let the recipient specify which chain they want USDT on.

---

## Integration Example

```js
import OneClickProtocol from '@tetherto/wdk-protocol-swap-1click'
import { OneClickPay } from '@tetherto/wdk-protocol-swap-1click'

// Setup: register the protocol with the user's wallet
const wdk = new WDK(seed)
  .registerWallet('bitcoin', WalletManagerBtc, btcConfig)
  .registerProtocol('bitcoin', '1click', OneClickProtocol, {
    sourceChain: 'btc',
    jwt: process.env.ONECLICK_JWT
  })

const account = await wdk.getAccount('bitcoin', 0)
const protocol = account.getSwapProtocol('1click')

// Create the pay helper
const pay = new OneClickPay(protocol, {
  slippageBps: 200,         // 2% default
  appFees: [{ recipient: '0xMyAppFeeAddress', fee: 50 }]  // 0.5% app fee
})

// Quote: "How much BTC to send Alice $50 USDT on Arbitrum?"
const quote = await pay.quotePay({
  tokenIn: 'native',        // paying from BTC (native asset on the bitcoin wallet)
  amount: 50,
  recipientAddress: '0xAliceOnArbitrum',
  recipientChain: 'arb'
})
console.log(`Cost: ${quote.costFormatted}`)  // "Cost: 0.00715 BTC"

// Pay: execute the payment
const result = await pay.pay({
  tokenIn: 'native',
  amount: 50,
  recipientAddress: '0xAliceOnArbitrum',
  recipientChain: 'arb'
})
console.log(`Deposit tx: ${result.hash}`)
console.log(`Alice receives: ${result.amountReceived} USDT`)

// Poll status
let status
do {
  await new Promise(r => setTimeout(r, 30000))
  status = await pay.getPaymentStatus(result.depositAddress)
} while (!status.terminal)

if (status.status === 'SUCCESS') {
  console.log('Payment complete!')
} else if (status.status === 'REFUNDED') {
  console.log('Payment failed — funds refunded to your wallet')
}
```

---

## What's different from raw OneClickProtocol.swap()

| Aspect | OneClickProtocol.swap() | OneClickPay.pay() |
|---|---|---|
| Amount input | Base units (`50000000n`) | Human dollars (`50`) |
| Output token | Any token (caller resolves) | Always USDT (auto-resolved per chain) |
| Swap type | EXACT_INPUT or EXACT_OUTPUT | Always EXACT_OUTPUT |
| Recipient | Optional (defaults to self) | Required (always someone else) |
| Destination chain | Optional | Required |
| Slippage default | 100 bps (1%) | 200 bps (2%) |
| Deadline default | 10 minutes | 2 hours |
| Return value | OneClickSwapResult (technical) | PayResult (user-friendly) |

---

## Destination chains WDK doesn't support

A key feature: the **sender** needs a WDK wallet, but the **recipient** does not.
Alice can be on any chain 1Click supports — even chains with no WDK wallet implementation.
The recipient address is just a string passed to the 1Click API.

For example, a BTC wallet user can pay someone on Cardano (if 1Click supports it),
even though there's no `wdk-wallet-cardano` package. The deposit happens on BTC
(where WDK has a wallet), and 1Click routes the output to Cardano.

`getSupportedPaymentChains()` returns all chains where the output USDT is available,
regardless of whether WDK has a wallet for that chain. **Exception**: chains that require
memo/destination-tag deposits (Stellar, potentially XRP) are excluded — `OneClickProtocol`
throws on `depositMemo` presence, so these chains cannot be used as payment destinations
until WDK's transfer interface supports memo fields.

---

## Error Handling

### Minimum amount errors

The 1Click API returns raw error messages like
`"Amount is too low for bridge, try at least 1000000"` — unhelpful to a user thinking
in dollars. OneClickPay catches these errors and transforms them to human-readable messages:

```js
// API: "Amount is too low for bridge, try at least 1000000"
// OneClickPay: "Minimum payment requires 0.01000000 BTC"
```

The implementation parses the minimum amount from the error message, converts from base
units to human units using the source asset's decimals, and throws a user-friendly error.

### Quote unavailable

If no market maker can fill the quote (illiquid pair, extreme volatility), the API returns
a "Failed to get quote" error. OneClickPay transforms this to:
`"We couldn't get a quote for this payment. Try adjusting slippage or try again later."`

### Large payment warning

Payments above ~$50,000 may fail to quote if market maker liquidity is insufficient. The
architecture does not enforce a maximum, but wallet apps should consider a sanity check
or warning for very large amounts.

---

## Cost Display Formatting

`PayQuote.costFormatted` uses the following rules:
- Display up to 8 significant digits
- Trim trailing zeros
- Use the source asset's symbol as suffix

Examples:
- `"0.00715 BTC"` (not `"0.00715000 BTC"`)
- `"0.0234 ETH"` (not `"0.023400000000000000 ETH"`)
- `"142.35 SOL"`

**Important**: `costFormatted` (and `costBaseUnits`) does NOT include the source chain
network fee for the deposit transaction. The wallet app should display the network fee
separately. The total cost to the sender is `costBaseUnits + networkFee`.

---

## Production Concerns

### Double-spend on retry

If `pay()` broadcasts the deposit transaction and the app crashes before returning
`PayResult`, the user may retry. Each `pay()` call generates a new quote and deposit
address, so a retry creates a second deposit. The first deposit may have already been
picked up by the relay.

**Mitigation (wallet app responsibility)**: Persist `PayResult` (specifically
`depositAddress` and `hash`) immediately after `pay()` returns, before showing any
success UI. On app restart, check for persisted in-flight payments and poll their
status before allowing a retry.

### JWT expiry during long payments

BTC payments can take 60+ minutes for confirmation, and polling continues after that.
The JWT must remain valid for the entire duration. If the JWT expires at 1 hour and
BTC settlement takes 90 minutes, `getPaymentStatus()` calls will fail.

**Recommendation**: Use JWTs with at least 3-hour expiry for payment flows, or
implement JWT refresh logic in the wallet app. Note that JWT is frozen at
`OneClickProtocol` construction time — to use a refreshed JWT, create a new protocol
instance (which happens automatically via WDK's `getSwapProtocol()` lazy instantiation
if the config's JWT has been updated).

### Refund address on UTXO chains

For BTC, `refundTo` is set to `account.getAddress()` — the sender's address. WDK BTC
wallets use static single-address accounts (no HD cycling), so the refund goes to the
same address the user controls. This is correct and safe.

---

## File location

OneClickPay lives in the same package as OneClickProtocol:

```
wdk-protocol-swap-1click/
  src/
    one-click-protocol.js    # existing
    one-click-client.js      # existing
    asset-registry.js         # existing
    one-click-pay.js          # NEW — OneClickPay helper
  tests/
    one-click-pay.test.js     # NEW — unit tests
    ...existing test files...
  index.js                    # updated to also export OneClickPay
```

No new dependencies. No changes to existing files except `index.js` (add named export).

---

## Testing Strategy

Unit tests with mocked `OneClickProtocol`:

- `quotePay()` resolves USDT contract address on destination chain correctly
- `quotePay()` converts human amount to base units with correct decimals
- `quotePay()` throws when fractional digits exceed token decimals
- `quotePay()` calls `protocol.quoteSwap()` with EXACT_OUTPUT and correct params
- `quotePay()` returns formatted cost string (8 significant digits, trimmed zeros)
- `quotePay()` applies per-call slippageBps override
- `quotePay()` restores config slippageBps after call (even on error)
- `pay()` calls `protocol.swap()` with EXACT_OUTPUT
- `pay()` returns PayResult with all fields
- `getPaymentStatus()` delegates to `protocol.getSwapStatus()`
- `getSupportedPaymentChains()` filters token list correctly
- `getSupportedPaymentChains()` excludes memo-required chains
- Throws if USDT is not available on destination chain
- Throws if amount is zero or negative
- Slippage, deadline, quoteWaitingTimeMs, appFees, referral forwarded correctly
- Minimum amount API error is transformed to human-readable message
- Quote unavailable API error is transformed to user-friendly message
- Stablecoin resolution is memoized (no redundant API calls)

Integration tests (dry: true, no funds at risk):

- `quotePay()` against live API: BTC → $50 USDT on Arbitrum
- `quotePay()` against live API: ETH → $100 USDT on Ethereum (same-chain)
- `getSupportedPaymentChains()` returns expected chains (eth, tron, sol, etc.)
- Resolved USDT contract address matches expected canonical address per chain

---

## Resolved Design Decisions

1. **`referral` field**: Added to `OneClickProtocolConfig` and forwarded in quote requests.
   Exposed as `referral` in `OneClickPayConfig`. Set to your partner ID if registered.

2. **`costFormatted` precision**: Up to 8 significant digits, trailing zeros trimmed.
   Rule is specified in the "Cost Display Formatting" section above.

3. **Multiple quote comparison**: NOT built into OneClickPay. Keep `quotePay()` simple —
   one source token, one quote. The wallet app calls `quotePay()` in parallel for each
   asset in the user's portfolio to show comparative costs.

4. **`FLEX_INPUT` / `payAll()`**: Deferred. Breaks the core guarantee ("Alice receives
   exactly $50"). A `payAll()` would need different typedefs, different UX language
   ("Alice receives approximately..."), and different error messaging. Not part of this layer.

5. **`quoteWaitingTimeMs`**: Added to `OneClickProtocolConfig` and forwarded in quote
   requests. Default 3000ms in OneClickPay config.

6. **Per-payment slippage**: `slippageBps` accepted as an optional parameter on both
   `quotePay()` and `pay()`, overriding the config default for that specific call.
   Implemented via temporary config mutation (see "Slippage Override Mechanism" section).

7. **Amount truncation**: `toBaseUnits` throws on excess fractional digits rather than
   silently truncating. Prevents users from unknowingly sending a different amount.

## Deferred / Out of Scope

- **`FLEX_INPUT` / send-all payments** — different UX paradigm, breaks exact-amount guarantee
- **Memo-required destination chains** (Stellar, XRP) — blocked by WDK transfer interface
- **Automatic JWT refresh** — wallet app responsibility
- **Payment persistence/idempotency** — wallet app responsibility
