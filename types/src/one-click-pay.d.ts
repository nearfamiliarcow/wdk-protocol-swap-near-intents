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
    constructor(protocol: import("./one-click-protocol.js").default, config?: OneClickPayConfig);
    /** @private */
    private _protocol;
    /** @private */
    private _config;
    /** @private */
    private _acceptedSymbols;
    /**
     * Memoized USDT resolution per chain.
     * @private
     * @type {Map<string, Array<{assetId: string, blockchain: string, symbol: string, decimals: number, contractAddress: string|null}>>}
     */
    private _usdtCache;
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
    quotePay(options: {
        tokenIn: string;
        amount: number | string;
        recipientAddress: string;
        recipientChain: string;
        tokenOut?: string;
        slippageBps?: number;
    }): Promise<PayQuote>;
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
    pay(options: {
        tokenIn: string;
        amount: number | string;
        recipientAddress: string;
        recipientChain: string;
        tokenOut?: string;
        slippageBps?: number;
    }): Promise<PayResult>;
    /**
     * Poll payment status. Delegates to OneClickProtocol.getSwapStatus().
     *
     * @param {string} depositAddress - From PayResult.depositAddress.
     * @returns {Promise<import('./one-click-protocol.js').OneClickSwapStatusResult>}
     */
    getPaymentStatus(depositAddress: string): Promise<import("./one-click-protocol.js").OneClickSwapStatusResult>;
    /**
     * List chains where USDT is available for payments.
     * Excludes chains requiring memo/destination-tag deposits.
     *
     * @returns {Promise<string[]>} Array of chain IDs (e.g., ["eth", "sol", "ton", ...]).
     */
    getSupportedPaymentChains(): Promise<string[]>;
    /**
     * Get all USDT variants available on a specific chain.
     * Useful for wallet apps that want to show both USDT and USDT0 options.
     *
     * @param {string} chain - 1Click chain ID.
     * @returns {Promise<Array<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>>}
     */
    getUSDTOptions(chain: string): Promise<Array<{
        assetId: string;
        symbol: string;
        contractAddress: string | null;
        decimals: number;
    }>>;
    /**
     * Transform raw API errors into user-friendly messages.
     * @private
     * @param {Error} err
     * @returns {Error}
     */
    private _enrichError;
    /**
     * @private
     * @param {number|string} amount
     */
    private _validateAmount;
    /**
     * Find all USDT variants on a chain. Results are memoized.
     * @private
     * @param {string} chain
     * @returns {Promise<Array<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>>}
     */
    private _resolveUSDTOptions;
    /**
     * Resolve the preferred USDT variant on a chain.
     * Prefers natively issued USDT over USDT0.
     * @private
     * @param {string} chain
     * @returns {Promise<{assetId: string, symbol: string, contractAddress: string|null, decimals: number}>}
     */
    private _resolveUSDT;
    /**
     * Build an overrides object and call fn with it, forwarding OneClickPay config
     * values and the per-call slippageBps to the protocol without mutating its config.
     * @private
     * @param {number} slippageBps
     * @param {Function} fn - Receives the overrides object and must forward it to the protocol call.
     * @returns {Promise<any>}
     */
    private _callWithSlippage;
}
export type OneClickPayConfig = {
    /**
     * Which USDT variants to accept. Controls which tokens appear in
     * getSupportedPaymentChains() and getUSDTOptions(), and which are used
     * as payment output.
     * - 'native' — only natively issued USDT (default)
     * - 'all' — USDT + USDT0 + any future variants
     * - string[] — explicit list of accepted symbols, e.g. ['USDT', 'USDT0']
     */
    acceptedSymbols?: string[] | string;
    /**
     * Slippage tolerance in basis points. Default: 200 (2%).
     * Can be overridden per-call via quotePay/pay options.
     */
    slippageBps?: number;
    /**
     * Quote deadline in milliseconds. Default: 7200000 (2 hours).
     */
    deadlineMs?: number;
    /**
     * How long the relay waits for market maker quotes. Default: 3000 (3 seconds).
     */
    quoteWaitingTimeMs?: number;
    /**
     * Application-level fees in basis points.
     */
    appFees?: Array<{
        recipient: string;
        fee: number;
    }>;
    /**
     * Referral identifier for partner tracking/analytics.
     */
    referral?: string;
};
export type PayQuote = {
    /**
     * - Human-readable cost (e.g., "0.00715 BTC").
     */
    costFormatted: string;
    /**
     * - Cost in source asset base units.
     */
    costBaseUnits: bigint;
    /**
     * - Source asset symbol (e.g., "BTC").
     */
    costSymbol: string;
    /**
     * - The payment amount in human units (e.g., 50).
     */
    amount: number | string;
    /**
     * - Destination chain ID.
     */
    recipientChain: string;
    /**
     * - Slippage tolerance used for this quote.
     */
    slippageBps: number;
};
export type PayResult = {
    /**
     * - Deposit transaction hash.
     */
    hash: string;
    /**
     * - For status polling.
     */
    depositAddress: string;
    /**
     * - Amount deposited in source asset base units.
     */
    amountPaid: bigint;
    /**
     * - The exact USDT amount the recipient gets.
     */
    amountReceived: number | string;
    /**
     * - Destination chain ID.
     */
    recipientChain: string;
    /**
     * - Where USDT was sent.
     */
    recipientAddress: string;
    /**
     * - For support requests.
     */
    correlationId: string;
    /**
     * - Full 1Click response for debugging.
     */
    quoteResponse: any;
};
