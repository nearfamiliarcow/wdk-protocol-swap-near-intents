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

import { SwapProtocol } from '@tetherto/wdk-wallet/protocols'
import OneClickClient from './one-click-client.js'
import { getRegistry } from './asset-registry.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapOptions} SwapOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapResult} SwapResult */

const DEFAULT_BASE_URL = 'https://1click.chaindefuser.com'
const DEFAULT_SLIPPAGE_BPS = 100
const DEFAULT_DEADLINE_MS = 600000

/**
 * @typedef {Object} OneClickProtocolConfig
 * @property {string} sourceChain
 *   Required. The 1Click chain identifier for the source chain.
 *   Examples: "eth", "sol", "btc", "arb", "ton", "tron"
 *
 * @property {string} [jwt]
 *   Bearer JWT token for authenticated endpoints. Required for swap().
 *   All quote requests benefit from JWT — unauthenticated quotes incur +0.2% fee.
 *   WARNING: Consumers must validate JWT exp claim before calling swap().
 *
 * @property {Array<{recipient: string, fee: number}>} [appFees]
 *   Application-level fees in basis points.
 *
 * @property {number} [slippageBps]
 *   Slippage tolerance in basis points. Default: 100 (1%).
 *
 * @property {number} [deadlineMs]
 *   Quote validity in milliseconds. Default: 600000 (10 minutes).
 *
 * @property {string} [baseUrl]
 *   Override the 1Click API base URL.
 *
 * @property {Object} [depositTxOptions]
 *   Extra params spread into sendTransaction() for native deposits (e.g., BTC feeRate).
 *
 * @property {number | bigint} [swapMaxFee]
 *   Maximum fee for the deposit transaction. Uses >= comparison.
 *
 * @property {number} [quoteWaitingTimeMs]
 *   How long the relay waits for market maker quotes (ms). Default: not set (API default).
 *   Setting to 3000 can yield better rates on less liquid pairs.
 *
 * @property {string} [referral]
 *   Referral identifier for partner tracking/analytics. Forwarded to the quote request.
 */

/**
 * @typedef {SwapResult & { depositAddress: string, depositMemo: (string|undefined), correlationId: string, quoteSignature: string, quoteResponse: Object }} OneClickSwapResult
 * @property {string} hash - The deposit transaction hash.
 * @property {bigint} fee - Deposit transaction gas cost in source chain native token base units.
 * @property {bigint} tokenInAmount - Input amount from quoteResponse.quote.amountIn.
 * @property {bigint} tokenOutAmount - Expected output from quoteResponse.quote.amountOut.
 * @property {string} depositAddress - Deposit address for status polling.
 * @property {string | undefined} depositMemo - Memo value (for Stellar forward-compat).
 * @property {string} correlationId - Unique ID for support requests.
 * @property {string} quoteSignature - Cryptographic commitment to quote terms.
 * @property {Object} quoteResponse - Full 1Click QuoteResponse for dispute resolution.
 */

/**
 * @typedef {Object} OneClickSwapStatusResult
 * @property {string} status - Raw 1Click status string.
 * @property {boolean} terminal - True if SUCCESS, REFUNDED, or FAILED.
 * @property {string} correlationId - For support requests.
 * @property {string} updatedAt - ISO 8601 timestamp.
 * @property {string|null} originTxHash - First origin chain transaction hash, or null if not yet available.
 * @property {string|null} destinationTxHash - First destination chain transaction hash, or null if not yet available.
 * @property {string|null} refundedAmount - Refunded amount in base units (string-encoded), or null/\"0\" if no refund.
 * @property {string|null} refundedAmountFormatted - Human-readable refunded amount, or null/\"0\" if no refund.
 * @property {string|null} refundedAmountUsd - Refunded amount in USD, or null/\"0\" if no refund.
 * @property {string|null} refundReason - Reason for refund if provided by the API.
 * @property {Object} swapDetails - Full raw swap details from the 1Click API.
 */

const TERMINAL_STATUSES = ['SUCCESS', 'REFUNDED', 'FAILED']

/**
 * Chain-agnostic WDK swap protocol wrapping the NEAR Intents 1Click API.
 *
 * Enables cross-chain token swaps across 29+ blockchains via a deposit-address model:
 * get a quote, transfer tokens to a deposit address, and the backend routes settlement.
 *
 * swap() returns on deposit broadcast, not settlement. Callers must poll getSwapStatus().
 *
 * @extends SwapProtocol
 */
export default class OneClickProtocol extends SwapProtocol {
  /**
   * @param {import('@tetherto/wdk-wallet/protocols').IWalletAccountReadOnly | import('@tetherto/wdk-wallet/protocols').IWalletAccount} account
   * @param {OneClickProtocolConfig} [config]
   */
  constructor (account, config = {}) {
    super(account, config)

    if (!config.sourceChain) {
      throw new Error('OneClickProtocol: sourceChain is required')
    }

    /** @private */
    this._client = new OneClickClient({
      baseUrl: config.baseUrl,
      jwt: config.jwt
    })

    /** @private */
    this._registry = getRegistry(
      config.baseUrl ?? DEFAULT_BASE_URL,
      this._client
    )
  }

  /**
   * Quotes the costs of a swap operation.
   *
   * Uses dry: true — no real deposit address is generated, no funds at risk.
   * Works without JWT but incurs +0.2% fee penalty on quoted rate.
   * The response will NOT include depositAddress, deadline, or timeWhenInactive.
   *
   * Note: for Solana SPL token swaps the fee estimate may be ~0.002 SOL low because
   * the placeholder address ATA (associated token account) is assumed to already exist.
   *
   * @param {SwapOptions} options
   * @param {Object} [overrides={}] - Per-call config overrides forwarded to _buildQuoteRequest.
   * @returns {Promise<Omit<SwapResult, 'hash'>>}
   */
  async quoteSwap (options, overrides = {}) {
    const quoteRequest = await this._buildQuoteRequest(options, true, overrides)
    const quoteResponse = await this._client.getQuote(quoteRequest)

    if (!quoteResponse?.quote) {
      throw new Error('OneClickProtocol: malformed quote response — missing quote object')
    }

    const { isNativeIn } = await this._resolveAssets(options)
    const amountIn = BigInt(quoteResponse.quote.amountIn)
    const address = await this._account.getAddress()

    const feeEstimate = isNativeIn
      ? await this._account.quoteSendTransaction({
        to: address,
        value: amountIn,
        ...(this._config.depositTxOptions ?? {})
      })
      : await this._account.quoteTransfer({
        token: options.tokenIn,
        recipient: address,
        amount: amountIn
      })

    return {
      fee: feeEstimate.fee,
      tokenInAmount: amountIn,
      tokenOutAmount: BigInt(quoteResponse.quote.amountOut),
      timeEstimate: quoteResponse.quote.timeEstimate
    }
  }

  /**
   * Executes a cross-chain or same-chain swap via the 1Click deposit-address model.
   *
   * Returns when the deposit transaction broadcasts — NOT when the swap settles.
   * Cross-chain settlement can take 15+ minutes. Poll getSwapStatus() for completion.
   *
   * fee is the deposit transaction gas cost in source chain native token base units.
   * The 1Click protocol fee is embedded in the exchange rate (not in fee).
   *
   * @param {SwapOptions} options
   * @param {Object} [overrides={}] - Per-call config overrides forwarded to _buildQuoteRequest.
   * @returns {Promise<OneClickSwapResult>}
   */
  async swap (options, overrides = {}) {
    // 1. Guard: account must be writable
    if (typeof this._account.sendTransaction !== 'function') {
      throw new Error('OneClickProtocol: swap() requires a non-read-only account.')
    }

    // 2. Guard: JWT must be configured
    if (!this._config.jwt) {
      throw new Error('OneClickProtocol: jwt is required for swap()')
    }

    // 3-4. Resolve assets (only need isNativeIn here; _buildQuoteRequest resolves IDs separately)
    const { isNativeIn } = await this._resolveAssets(options)

    // 5-8. Build and send live quote request
    const quoteRequest = await this._buildQuoteRequest(options, false, overrides)
    const quoteResponse = await this._client.getQuote(quoteRequest)

    if (!quoteResponse?.quote) {
      throw new Error('OneClickProtocol: malformed quote response — missing quote object')
    }

    // 10. Guard: depositAddress must be present on live quote
    if (!quoteResponse.quote.depositAddress) {
      throw new Error('OneClickProtocol: quote response missing depositAddress on live quote')
    }

    // 11. Guard: memo-based deposits not yet supported
    if (quoteResponse.quote.depositMemo) {
      throw new Error(
        'OneClickProtocol: memo-based deposits are not yet supported. ' +
        'This deposit requires a memo/tag value which WDK TransferOptions does not support. ' +
        'Affected chains include Stellar (memo) and potentially XRP (destination tag).'
      )
    }

    // 12. Guard: deadline must be present and not expired
    if (!quoteResponse.quote.deadline) {
      throw new Error('OneClickProtocol: quote response missing deadline — cannot proceed')
    }
    if (Date.now() >= new Date(quoteResponse.quote.deadline).getTime()) {
      throw new Error('OneClickProtocol: quote expired before deposit could be initiated')
    }

    // 13. Determine deposit amount
    const depositAmount = BigInt(quoteResponse.quote.amountIn)

    // 14. swapMaxFee guard
    if (this._config.swapMaxFee !== undefined) {
      const feeEstimate = isNativeIn
        ? await this._account.quoteSendTransaction({
          to: quoteResponse.quote.depositAddress,
          value: depositAmount,
          ...(this._config.depositTxOptions ?? {})
        })
        : await this._account.quoteTransfer({
          token: options.tokenIn,
          recipient: quoteResponse.quote.depositAddress,
          amount: depositAmount
        })

      if (feeEstimate.fee >= this._config.swapMaxFee) {
        throw new Error('OneClickProtocol: exceeded maximum fee for deposit transaction.')
      }
    }

    // 15. Execute deposit
    const { hash, fee: depositFee } = await this._deposit(
      quoteResponse.quote.depositAddress,
      options.tokenIn,
      depositAmount,
      isNativeIn,
      this._config.depositTxOptions ?? {}
    )

    // 16. Best-effort submit deposit tx
    try {
      const submitBody = {
        txHash: hash,
        depositAddress: quoteResponse.quote.depositAddress
      }
      if (quoteResponse.quote.depositMemo) {
        submitBody.memo = quoteResponse.quote.depositMemo
      }
      if (this._config.sourceChain === 'near') {
        submitBody.nearSenderAccount = await this._account.getAddress()
      }
      await this._client.submitDepositTx(submitBody)
    } catch {
      // Fire-and-forget — 1Click backend detects deposits independently
    }

    // 17. Return OneClickSwapResult
    return {
      hash,
      fee: depositFee,
      tokenInAmount: BigInt(quoteResponse.quote.amountIn),
      tokenOutAmount: BigInt(quoteResponse.quote.amountOut),
      depositAddress: quoteResponse.quote.depositAddress,
      depositMemo: quoteResponse.quote.depositMemo,
      correlationId: quoteResponse.correlationId,
      quoteSignature: quoteResponse.signature,
      quoteResponse
    }
  }

  /**
   * Polls the execution status of a swap.
   *
   * Requires JWT in config. If the JWT expires during polling, calls will fail.
   *
   * @param {string} depositAddress - From OneClickSwapResult.depositAddress.
   * @param {string} [depositMemo] - Required for Stellar/memo chains (forward-compat).
   * @returns {Promise<OneClickSwapStatusResult>}
   */
  async getSwapStatus (depositAddress, depositMemo) {
    const response = await this._client.getExecutionStatus(depositAddress, depositMemo)
    const details = response.swapDetails ?? {}
    return {
      status: response.status,
      terminal: TERMINAL_STATUSES.includes(response.status),
      correlationId: response.correlationId,
      updatedAt: response.updatedAt,
      originTxHash: details.originChainTxHashes?.[0]?.hash ?? null,
      destinationTxHash: details.destinationChainTxHashes?.[0]?.hash ?? null,
      refundedAmount: details.refundedAmount ?? null,
      refundedAmountFormatted: details.refundedAmountFormatted ?? null,
      refundedAmountUsd: details.refundedAmountUsd ?? null,
      refundReason: details.refundReason ?? null,
      swapDetails: details
    }
  }

  /**
   * Returns the full list of tokens supported by the 1Click API.
   *
   * @returns {Promise<Array<{ assetId: string, decimals: number, blockchain: string, symbol: string, price: string, contractAddress: string | null }>>}
   */
  async getSupportedTokens () {
    return this._client.getTokens()
  }

  /**
   * Resolves a WDK token address to its 1Click asset registry entry.
   *
   * @param {string} chain - 1Click chain identifier (e.g., "eth", "sol").
   * @param {string} tokenAddress - WDK token address or 'native'.
   * @returns {Promise<{ assetId: string, isNative: boolean, decimals: number, symbol: string }>}
   */
  async resolveToken (chain, tokenAddress) {
    return this._registry.resolve(chain, tokenAddress)
  }

  /**
   * The 1Click chain identifier for the source chain this protocol instance is configured for.
   *
   * @returns {string}
   */
  get sourceChain () {
    return this._config.sourceChain
  }

  /**
   * Resolves WDK token addresses to 1Click asset IDs for origin and destination.
   *
   * @private
   * @param {SwapOptions} options
   * @returns {Promise<{ originAssetId: string, destinationAssetId: string, isNativeIn: boolean }>}
   */
  async _resolveAssets (options) {
    const originEntry = await this._registry.resolve(this._config.sourceChain, options.tokenIn)

    let destinationAssetId
    if (options.destinationAsset) {
      destinationAssetId = options.destinationAsset
    } else {
      const destChain = options.destinationChain ?? this._config.sourceChain
      const destEntry = await this._registry.resolve(destChain, options.tokenOut)
      destinationAssetId = destEntry.assetId
    }

    return {
      originAssetId: originEntry.assetId,
      destinationAssetId,
      isNativeIn: originEntry.isNative
    }
  }

  /**
   * Builds the full POST /v0/quote request body.
   *
   * @private
   * @param {SwapOptions} options
   * @param {boolean} dry - true for quoteSwap(), false for swap().
   * @param {Object} [overrides={}] - Per-call config overrides. Supported keys:
   *   slippageBps (maps to slippageTolerance in the request body),
   *   deadlineMs, quoteWaitingTimeMs, appFees, referral.
   * @returns {Promise<Object>} Complete request body matching POST /v0/quote schema.
   */
  async _buildQuoteRequest (options, dry, overrides = {}) {
    const { originAssetId, destinationAssetId } = await this._resolveAssets(options)
    const address = await this._account.getAddress()

    if (options.tokenInAmount == null && options.tokenOutAmount == null) {
      throw new Error('OneClickProtocol: either tokenInAmount or tokenOutAmount must be provided')
    }

    const swapType = options.tokenInAmount != null ? 'EXACT_INPUT' : 'EXACT_OUTPUT'
    const amount = options.tokenInAmount != null
      ? BigInt(options.tokenInAmount).toString()
      : BigInt(options.tokenOutAmount).toString()

    if (BigInt(amount) <= 0n) {
      throw new Error('OneClickProtocol: swap amount must be greater than zero')
    }

    const effectiveDeadlineMs = overrides.deadlineMs ?? this._config.deadlineMs ?? DEFAULT_DEADLINE_MS
    const effectiveAppFees = overrides.appFees ?? this._config.appFees
    const effectiveQuoteWaitingTimeMs = overrides.quoteWaitingTimeMs ?? this._config.quoteWaitingTimeMs
    const effectiveReferral = overrides.referral ?? this._config.referral

    const request = {
      dry,
      swapType,
      slippageTolerance: overrides.slippageBps ?? this._config.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
      originAsset: originAssetId,
      destinationAsset: destinationAssetId,
      amount,
      depositType: 'ORIGIN_CHAIN',
      recipient: options.to ?? address,
      recipientType: 'DESTINATION_CHAIN',
      refundTo: address,
      refundType: 'ORIGIN_CHAIN',
      deadline: new Date(Date.now() + effectiveDeadlineMs).toISOString()
    }

    if (effectiveAppFees) {
      request.appFees = effectiveAppFees
    }

    if (effectiveQuoteWaitingTimeMs) {
      request.quoteWaitingTimeMs = effectiveQuoteWaitingTimeMs
    }

    if (effectiveReferral) {
      request.referral = effectiveReferral
    }

    return request
  }

  /**
   * Deposits tokens to the 1Click deposit address.
   *
   * Uses sendTransaction() for native assets, transfer() for token contracts.
   * The determination is made from the AssetRegistry, not from chain identity.
   *
   * @private
   * @param {string} depositAddress
   * @param {string} tokenIn - The WDK token address.
   * @param {bigint} amount - Deposit amount in base units.
   * @param {boolean} isNative - Whether tokenIn is a native asset.
   * @param {Object} txOptions - Extra params for sendTransaction (e.g., BTC feeRate).
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async _deposit (depositAddress, tokenIn, amount, isNative, txOptions) {
    if (isNative) {
      return this._account.sendTransaction({
        to: depositAddress,
        value: amount,
        ...txOptions
      })
    }

    return this._account.transfer({
      token: tokenIn,
      recipient: depositAddress,
      amount
    })
  }
}
