// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

const DEFAULT_SLIPPAGE_BPS = 200
const DEFAULT_DEADLINE_MS = 7200000
const DEFAULT_QUOTE_WAITING_TIME_MS = 3000

/**
 * All known USDT symbol variants in the 1Click token list.
 * Includes future-proofing for bridged variants.
 */
const ALL_USDT_SYMBOLS = ['USDT', 'USDT0', 'USDT.e']

/**
 * Only natively issued USDT (no bridged/wrapped variants).
 */
const NATIVE_USDT_SYMBOLS = ['USDT']

/**
 * Chains that require memo/destination-tag deposits.
 * Excluded from getSupportedPaymentChains() because OneClickProtocol
 * throws on depositMemo presence.
 */
const MEMO_CHAINS = ['stellar', 'xlm']

/**
 * @typedef {Object} OneClickPayConfig
 * @property {string[]|string} [acceptedSymbols]
 *   Which USDT variants to accept. Controls which tokens appear in
 *   getSupportedPaymentChains() and getUSDTOptions(), and which are used
 *   as payment output.
 *   - 'native' — only natively issued USDT (default)
 *   - 'all' — USDT + USDT0 + any future variants
 *   - string[] — explicit list of accepted symbols, e.g. ['USDT', 'USDT0']
 *
 * @property {number} [slippageBps]
 *   Slippage tolerance in basis points. Default: 200 (2%).
 *   Can be overridden per-call via quotePay/pay options.
 *
 * @property {number} [deadlineMs]
 *   Quote deadline in milliseconds. Default: 7200000 (2 hours).
 *
 * @property {number} [quoteWaitingTimeMs]
 *   How long the relay waits for market maker quotes. Default: 3000 (3 seconds).
 *
 * @property {Array<{recipient: string, fee: number}>} [appFees]
 *   Application-level fees in basis points.
 *
 * @property {string} [referral]
 *   Referral identifier for partner tracking/analytics.
 */

/**
 * @typedef {Object} PayQuote
 * @property {string} costFormatted - Human-readable cost (e.g., "0.00715 BTC").
 * @property {bigint} costBaseUnits - Cost in source asset base units.
 * @property {string} costSymbol - Source asset symbol (e.g., "BTC").
 * @property {number|string} amount - The payment amount in human units (e.g., 50).
 * @property {string} recipientChain - Destination chain ID.
 * @property {number} slippageBps - Slippage tolerance used for this quote.
 */

/**
 * @typedef {Object} PayResult
 * @property {string} hash - Deposit transaction hash.
 * @property {string} depositAddress - For status polling.
 * @property {bigint} amountPaid - Amount deposited in source asset base units.
 * @property {number|string} amountReceived - The exact USDT amount the recipient gets.
 * @property {string} recipientChain - Destination chain ID.
 * @property {string} recipientAddress - Where USDT was sent.
 * @property {string} correlationId - For support requests.
 * @property {Object} quoteResponse - Full 1Click response for debugging.
 */

/**
 * Payment helper built on top of OneClickProtocol.
 *
 * Enables "Pay anyone in USDT from any asset you hold" via the 1Click API.
 * Uses EXACT_OUTPUT to guarantee the recipient receives the exact amount.
 * If price moves beyond slippage tolerance, the payment is reversed and the
 * sender gets a full refund (minus network fees).
 */
export default class OneClickPay {
  /**
   * @param {import('./one-click-protocol.js').default} protocol - An initialized OneClickProtocol instance.
   * @param {OneClickPayConfig} [config]
   */
  constructor (protocol, config = {}) {
    /** @private */
    this._protocol = protocol

    /** @private */
    this._config = config

    /** @private */
    this._acceptedSymbols = resolveAcceptedSymbols(config.acceptedSymbols)

    /**
     * Memoized USDT resolution per chain.
     * @private
     * @type {Map<string, Array<{assetId: string, blockchain: string, symbol: string, decimals: number, contractAddress: string|null}>>}
     */
    this._usdtCache = new Map()
  }

  /**
   * Quote a payment. Shows the user what it will cost in their source asset.
   *
   * @param {Object} options
   * @param {string} options.tokenIn - Source token to pay from. Contract address or 'native'.
   * @param {number|string} options.amount - Human-readable USDT amount (e.g., 50 for "$50").
   * @param {string} options.recipientAddress - Recipient's address on destination chain.
   * @param {string} options.recipientChain - 1Click chain ID (e.g., "eth", "sol", "ton").
   * @param {string} [options.tokenOut] - Explicit USDT variant contract address. Bypasses auto-resolution.
   * @param {number} [options.slippageBps] - Override slippage for this quote.
   * @returns {Promise<PayQuote>}
   */
  async quotePay (options) {
    this._validateAmount(options.amount)

    const usdt = options.tokenOut
      ? { contractAddress: options.tokenOut, decimals: 6 }
      : await this._resolveUSDT(options.recipientChain)

    const baseAmount = toBaseUnits(options.amount, usdt.decimals)
    const slippageBps = options.slippageBps ?? this._config.slippageBps ?? DEFAULT_SLIPPAGE_BPS

    let quote
    try {
      quote = await this._callWithSlippage(slippageBps, () =>
        this._protocol.quoteSwap({
          tokenIn: options.tokenIn,
          tokenOut: usdt.contractAddress ?? 'native',
          tokenOutAmount: baseAmount,
          destinationChain: options.recipientChain,
          to: options.recipientAddress
        })
      )
    } catch (err) {
      throw this._enrichError(err)
    }

    const sourceEntry = await this._protocol._registry.resolve(
      this._protocol._config.sourceChain,
      options.tokenIn
    )

    return {
      costFormatted: formatCost(quote.tokenInAmount, sourceEntry.decimals, sourceEntry.symbol),
      costBaseUnits: quote.tokenInAmount,
      costSymbol: sourceEntry.symbol,
      amount: options.amount,
      recipientChain: options.recipientChain,
      timeEstimate: quote.timeEstimate,
      slippageBps
    }
  }

  /**
   * Execute a payment. Deposits sender's asset, recipient gets exact USDT amount.
   *
   * Returns on deposit broadcast, not settlement. Poll getPaymentStatus() for completion.
   * If price moves beyond slippage tolerance, the deposit is refunded (minus network fees).
   *
   * @param {Object} options
   * @param {string} options.tokenIn - Source token to pay from. Contract address or 'native'.
   * @param {number|string} options.amount - Human-readable USDT amount (e.g., 50 for "$50").
   * @param {string} options.recipientAddress - Recipient's address on destination chain.
   * @param {string} options.recipientChain - 1Click chain ID (e.g., "eth", "sol", "ton").
   * @param {string} [options.tokenOut] - Explicit USDT variant contract address. Bypasses auto-resolution.
   * @param {number} [options.slippageBps] - Override slippage for this payment.
   * @returns {Promise<PayResult>}
   */
  async pay (options) {
    this._validateAmount(options.amount)

    const usdt = options.tokenOut
      ? { contractAddress: options.tokenOut, decimals: 6 }
      : await this._resolveUSDT(options.recipientChain)

    const baseAmount = toBaseUnits(options.amount, usdt.decimals)
    const slippageBps = options.slippageBps ?? this._config.slippageBps ?? DEFAULT_SLIPPAGE_BPS

    let result
    try {
      result = await this._callWithSlippage(slippageBps, () =>
        this._protocol.swap({
          tokenIn: options.tokenIn,
          tokenOut: usdt.contractAddress ?? 'native',
          tokenOutAmount: baseAmount,
          destinationChain: options.recipientChain,
          to: options.recipientAddress
        })
      )
    } catch (err) {
      throw this._enrichError(err)
    }

    return {
      hash: result.hash,
      depositAddress: result.depositAddress,
      amountPaid: result.tokenInAmount,
      amountReceived: options.amount,
      recipientChain: options.recipientChain,
      recipientAddress: options.recipientAddress,
      correlationId: result.correlationId,
      quoteResponse: result.quoteResponse
    }
  }

  /**
   * Poll payment status. Delegates to OneClickProtocol.getSwapStatus().
   *
   * @param {string} depositAddress - From PayResult.depositAddress.
   * @returns {Promise<import('./one-click-protocol.js').OneClickSwapStatusResult>}
   */
  async getPaymentStatus (depositAddress) {
    return this._protocol.getSwapStatus(depositAddress)
  }

  /**
   * List chains where USDT is available for payments.
   * Excludes chains requiring memo/destination-tag deposits.
   *
   * @returns {Promise<string[]>} Array of chain IDs (e.g., ["eth", "sol", "ton", ...]).
   */
  async getSupportedPaymentChains () {
    const tokens = await this._protocol.getSupportedTokens()
    const chains = new Set()

    for (const token of tokens) {
      if (this._acceptedSymbols.includes(token.symbol) && !MEMO_CHAINS.includes(token.blockchain)) {
        chains.add(token.blockchain)
      }
    }

    return [...chains]
  }

  /**
   * Get all USDT variants available on a specific chain.
   * Useful for wallet apps that want to show both USDT and USDT0 options.
   *
   * @param {string} chain - 1Click chain ID.
   * @returns {Promise<Array<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>>}
   */
  async getUSDTOptions (chain) {
    return this._resolveUSDTOptions(chain)
  }

  /**
   * Transform raw API errors into user-friendly messages.
   * @private
   * @param {Error} err
   * @returns {Error}
   */
  _enrichError (err) {
    const msg = err.message || ''

    if (msg.includes('Amount is too low for bridge') || msg.includes('amount is too low')) {
      return new Error(
        'OneClickPay: payment amount is too low. Try a larger amount.'
      )
    }

    if (msg.includes('Failed to get quote')) {
      return new Error(
        'OneClickPay: could not get a quote for this payment. Try adjusting slippage or try again later.'
      )
    }

    return err
  }

  /**
   * @private
   * @param {number|string} amount
   */
  _validateAmount (amount) {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (!num || num <= 0 || !Number.isFinite(num)) {
      throw new Error('OneClickPay: amount must be a positive number')
    }
  }

  /**
   * Find all USDT variants on a chain. Results are memoized.
   * @private
   * @param {string} chain
   * @returns {Promise<Array<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>>}
   */
  async _resolveUSDTOptions (chain) {
    if (this._usdtCache.has(chain)) {
      return this._usdtCache.get(chain)
    }

    const tokens = await this._protocol.getSupportedTokens()
    const matches = tokens.filter(t =>
      t.blockchain === chain &&
      this._acceptedSymbols.includes(t.symbol)
    )

    this._usdtCache.set(chain, matches)
    return matches
  }

  /**
   * Resolve the preferred USDT variant on a chain.
   * Prefers natively issued USDT over USDT0.
   * @private
   * @param {string} chain
   * @returns {Promise<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>}
   */
  async _resolveUSDT (chain) {
    const options = await this._resolveUSDTOptions(chain)
    if (options.length === 0) {
      throw new Error(`OneClickPay: USDT is not available on chain '${chain}'`)
    }
    // Prefer natively issued USDT over USDT0
    return options.find(t => t.symbol === 'USDT') ?? options[0]
  }

  /**
   * Execute a function with temporary config overrides on the protocol.
   * NOT safe for concurrent calls on the same instance — await creates interleaving
   * that can cause one call to read another's config values. In practice, payment UIs
   * do not issue concurrent pay() calls on the same instance (user clicks Pay, waits,
   * then clicks again). If concurrent use is needed, use separate OneClickPay instances.
   * @private
   * @param {number} slippageBps
   * @param {Function} fn
   * @returns {Promise<any>}
   */
  async _callWithSlippage (slippageBps, fn) {
    const original = this._protocol._config.slippageBps
    const originalDeadline = this._protocol._config.deadlineMs
    const originalQuoteWaiting = this._protocol._config.quoteWaitingTimeMs
    const originalAppFees = this._protocol._config.appFees
    const originalReferral = this._protocol._config.referral

    // Apply OneClickPay config overrides for this call
    this._protocol._config.slippageBps = slippageBps
    this._protocol._config.deadlineMs = this._config.deadlineMs ?? DEFAULT_DEADLINE_MS
    this._protocol._config.quoteWaitingTimeMs = this._config.quoteWaitingTimeMs ?? DEFAULT_QUOTE_WAITING_TIME_MS
    if (this._config.appFees) {
      this._protocol._config.appFees = this._config.appFees
    }
    if (this._config.referral) {
      this._protocol._config.referral = this._config.referral
    }

    try {
      return await fn()
    } finally {
      this._protocol._config.slippageBps = original
      this._protocol._config.deadlineMs = originalDeadline
      this._protocol._config.quoteWaitingTimeMs = originalQuoteWaiting
      this._protocol._config.appFees = originalAppFees
      this._protocol._config.referral = originalReferral
    }
  }
}

/**
 * Convert human-readable amount to base units.
 * Uses string parsing to avoid float precision loss on high-decimal tokens.
 * Throws if fractional digits exceed the token's decimal precision.
 *
 * @param {number|string|bigint} amount
 * @param {number} decimals
 * @returns {bigint}
 */
function toBaseUnits (amount, decimals) {
  if (typeof amount === 'bigint') {
    return amount * (10n ** BigInt(decimals))
  }

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

/**
 * Format a base-unit cost as a human-readable string with symbol.
 * Up to 8 significant digits, trailing zeros trimmed.
 *
 * @param {bigint} baseUnits
 * @param {number} decimals
 * @param {string} symbol
 * @returns {string}
 */
function formatCost (baseUnits, decimals, symbol) {
  const divisor = 10 ** decimals
  const num = Number(baseUnits) / divisor

  // Use toPrecision for significant digits, then trim trailing zeros
  let formatted = num.toPrecision(8)

  // Remove trailing zeros after decimal point
  if (formatted.includes('.')) {
    formatted = formatted.replace(/0+$/, '').replace(/\.$/, '')
  }

  return `${formatted} ${symbol}`
}

/**
 * Resolve the acceptedSymbols config into a concrete array of symbol strings.
 *
 * @param {string[]|string|undefined} config
 * @returns {string[]}
 */
function resolveAcceptedSymbols (config) {
  if (config === undefined || config === 'native') {
    return NATIVE_USDT_SYMBOLS
  }
  if (config === 'all') {
    return ALL_USDT_SYMBOLS
  }
  if (Array.isArray(config)) {
    return config
  }
  throw new Error(`OneClickPay: invalid acceptedSymbols config: ${config}`)
}
