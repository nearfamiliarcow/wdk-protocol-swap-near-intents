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
    constructor(account: import("@tetherto/wdk-wallet/protocols").IWalletAccountReadOnly | import("@tetherto/wdk-wallet/protocols").IWalletAccount, config?: OneClickProtocolConfig);
    /** @private */
    private _client;
    /** @private */
    private _registry;
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
    quoteSwap(options: SwapOptions, overrides?: any): Promise<Omit<SwapResult, "hash">>;
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
    swap(options: SwapOptions, overrides?: any): Promise<OneClickSwapResult>;
    /**
     * Polls the execution status of a swap.
     *
     * Requires JWT in config. If the JWT expires during polling, calls will fail.
     *
     * @param {string} depositAddress - From OneClickSwapResult.depositAddress.
     * @param {string} [depositMemo] - Required for Stellar/memo chains (forward-compat).
     * @returns {Promise<OneClickSwapStatusResult>}
     */
    getSwapStatus(depositAddress: string, depositMemo?: string): Promise<OneClickSwapStatusResult>;
    /**
     * Returns the full list of tokens supported by the 1Click API.
     *
     * @returns {Promise<Array<{ assetId: string, decimals: number, blockchain: string, symbol: string, price: string, contractAddress: string | null }>>}
     */
    getSupportedTokens(): Promise<Array<{
        assetId: string;
        decimals: number;
        blockchain: string;
        symbol: string;
        price: string;
        contractAddress: string | null;
    }>>;
    /**
     * Resolves a WDK token address to its 1Click asset registry entry.
     *
     * @param {string} chain - 1Click chain identifier (e.g., "eth", "sol").
     * @param {string} tokenAddress - WDK token address or 'native'.
     * @returns {Promise<{ assetId: string, isNative: boolean, decimals: number, symbol: string }>}
     */
    resolveToken(chain: string, tokenAddress: string): Promise<{
        assetId: string;
        isNative: boolean;
        decimals: number;
        symbol: string;
    }>;
    /**
     * The 1Click chain identifier for the source chain this protocol instance is configured for.
     *
     * @returns {string}
     */
    get sourceChain(): string;
    /**
     * Resolves WDK token addresses to 1Click asset IDs for origin and destination.
     *
     * @private
     * @param {SwapOptions} options
     * @returns {Promise<{ originAssetId: string, destinationAssetId: string, isNativeIn: boolean }>}
     */
    private _resolveAssets;
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
    private _buildQuoteRequest;
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
    private _deposit;
}
export type SwapOptions = import("@tetherto/wdk-wallet/protocols").SwapOptions;
export type SwapResult = import("@tetherto/wdk-wallet/protocols").SwapResult;
export type OneClickProtocolConfig = {
    /**
     *   Required. The 1Click chain identifier for the source chain.
     *   Examples: "eth", "sol", "btc", "arb", "ton", "tron"
     */
    sourceChain: string;
    /**
     * Bearer JWT token for authenticated endpoints. Required for swap().
     * All quote requests benefit from JWT — unauthenticated quotes incur +0.2% fee.
     * WARNING: Consumers must validate JWT exp claim before calling swap().
     */
    jwt?: string;
    /**
     * Application-level fees in basis points.
     */
    appFees?: Array<{
        recipient: string;
        fee: number;
    }>;
    /**
     * Slippage tolerance in basis points. Default: 100 (1%).
     */
    slippageBps?: number;
    /**
     * Quote validity in milliseconds. Default: 600000 (10 minutes).
     */
    deadlineMs?: number;
    /**
     * Override the 1Click API base URL.
     */
    baseUrl?: string;
    /**
     * Extra params spread into sendTransaction() for native deposits (e.g., BTC feeRate).
     */
    depositTxOptions?: any;
    /**
     * Maximum fee for the deposit transaction. Uses >= comparison.
     */
    swapMaxFee?: number | bigint;
    /**
     * How long the relay waits for market maker quotes (ms). Default: not set (API default).
     * Setting to 3000 can yield better rates on less liquid pairs.
     */
    quoteWaitingTimeMs?: number;
    /**
     * Referral identifier for partner tracking/analytics. Forwarded to the quote request.
     */
    referral?: string;
};
export type OneClickSwapResult = SwapResult & {
    depositAddress: string;
    depositMemo: (string | undefined);
    correlationId: string;
    quoteSignature: string;
    quoteResponse: any;
};
export type OneClickSwapStatusResult = {
    /**
     * - Raw 1Click status string.
     */
    status: string;
    /**
     * - True if SUCCESS, REFUNDED, or FAILED.
     */
    terminal: boolean;
    /**
     * - For support requests.
     */
    correlationId: string;
    /**
     * - ISO 8601 timestamp.
     */
    updatedAt: string;
    /**
     * - First origin chain transaction hash, or null if not yet available.
     */
    originTxHash: string | null;
    /**
     * - First destination chain transaction hash, or null if not yet available.
     */
    destinationTxHash: string | null;
    /**
     * - Refunded amount in base units (string-encoded), or null/\"0\" if no refund.
     */
    refundedAmount: string | null;
    /**
     * - Human-readable refunded amount, or null/\"0\" if no refund.
     */
    refundedAmountFormatted: string | null;
    /**
     * - Refunded amount in USD, or null/\"0\" if no refund.
     */
    refundedAmountUsd: string | null;
    /**
     * - Reason for refund if provided by the API.
     */
    refundReason: string | null;
    /**
     * - Full raw swap details from the 1Click API.
     */
    swapDetails: any;
};
import { SwapProtocol } from '@tetherto/wdk-wallet/protocols';
