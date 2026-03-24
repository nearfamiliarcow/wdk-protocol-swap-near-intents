/**
 * Thin fetch wrapper for the NEAR Intents 1Click API.
 * No business logic — handles URL construction, JWT injection, JSON serialization, and error detection.
 */
export default class OneClickClient {
    /**
     * @param {Object} [options]
     * @param {string} [options.baseUrl] - API base URL. Default: "https://1click.chaindefuser.com".
     * @param {string} [options.jwt] - Bearer JWT token for authenticated endpoints.
     */
    constructor({ baseUrl, jwt }?: {
        baseUrl?: string;
        jwt?: string;
    });
    /** @private */
    private _baseUrl;
    /** @private */
    private _jwt;
    /**
     * Fetches the list of supported tokens.
     *
     * @returns {Promise<Array<{ assetId: string, decimals: number, blockchain: string, symbol: string, price: string, priceUpdatedAt: string, contractAddress: string | null }>>}
     */
    getTokens(): Promise<Array<{
        assetId: string;
        decimals: number;
        blockchain: string;
        symbol: string;
        price: string;
        priceUpdatedAt: string;
        contractAddress: string | null;
    }>>;
    /**
     * Requests a swap quote.
     *
     * @param {Object} requestBody - The full quote request body per POST /v0/quote schema.
     * @returns {Promise<Object>} The QuoteResponse.
     */
    getQuote(requestBody: any): Promise<any>;
    /**
     * Polls the execution status of a swap.
     *
     * @param {string} depositAddress - The deposit address from the quote response.
     * @param {string} [depositMemo] - The deposit memo (required for Stellar/memo chains).
     * @returns {Promise<Object>} The GetExecutionStatusResponse.
     */
    getExecutionStatus(depositAddress: string, depositMemo?: string): Promise<any>;
    /**
     * Submits a deposit transaction hash to speed up processing.
     *
     * @param {Object} requestBody
     * @param {string} requestBody.txHash - The deposit transaction hash.
     * @param {string} requestBody.depositAddress - The deposit address.
     * @param {string} [requestBody.memo] - Deposit memo if applicable.
     * @param {string} [requestBody.nearSenderAccount] - Required for NEAR-origin deposits.
     * @returns {Promise<Object>}
     */
    submitDepositTx(requestBody: {
        txHash: string;
        depositAddress: string;
        memo?: string;
        nearSenderAccount?: string;
    }): Promise<any>;
    /**
     * @private
     * @param {string} method
     * @param {string} path
     * @param {Object} [body]
     * @returns {Promise<any>}
     */
    private _request;
}
