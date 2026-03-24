/**
 * Returns the AssetRegistry singleton for the given baseUrl.
 * If a registry already exists for this baseUrl, the client parameter is ignored —
 * the cached instance with its original client is returned. This is safe because
 * GET /v0/tokens is a public endpoint (no JWT required).
 *
 * @param {string} baseUrl
 * @param {import('./one-click-client.js').default} client
 * @returns {AssetRegistry}
 */
export function getRegistry(baseUrl: string, client: import("./one-click-client.js").default): AssetRegistry;
/**
 * Clears all cached registries. For test isolation only.
 * @visibleForTesting
 */
export function _clearRegistriesForTesting(): void;
export type AssetEntry = {
    /**
     * - The 1Click NEP-141 asset ID (e.g., "nep141:eth-0xdac1...omft.near").
     */
    assetId: string;
    /**
     * - True if the asset is a native chain token (ETH, BTC, SOL, etc.).
     */
    isNative: boolean;
    /**
     * - Token decimal places.
     */
    decimals: number;
    /**
     * - Token symbol (e.g., "USDT", "ETH").
     */
    symbol: string;
};
/**
 * Lazy token map that resolves WDK token addresses to 1Click asset IDs.
 *
 * Fetches GET /v0/tokens on first resolve() call and caches the result.
 * Lookup key format: "chain:contractaddress" (lowercased) for tokens,
 * "chain:native" for native assets.
 *
 * The `isNative` flag is authoritative for deposit method selection —
 * it comes from the 1Click token list (contractAddress === null), not
 * from any chain-specific heuristic.
 */
declare class AssetRegistry {
    /**
     * @param {import('./one-click-client.js').default} client
     */
    constructor(client: import("./one-click-client.js").default);
    /** @private */
    private _client;
    /**
     * @private
     * @type {Map<string, AssetEntry>}
     */
    private _cache;
    /**
     * @private
     * @type {Promise<void> | null}
     */
    private _loadPromise;
    /**
     * Resolves a WDK token address to a 1Click asset entry.
     *
     * For native assets (ETH, BTC, SOL, etc.), pass 'native' as tokenAddress.
     * This is the ONLY accepted sentinel — do not use chain-specific symbols.
     *
     * @param {string} chain - The 1Click chain identifier (e.g., "eth", "sol", "btc").
     * @param {string} tokenAddress - The token contract address, or 'native' for native assets.
     * @returns {Promise<AssetEntry>}
     */
    resolve(chain: string, tokenAddress: string): Promise<AssetEntry>;
    /**
     * Ensures the token list has been fetched and cached.
     * Uses a promise cache to prevent duplicate fetches on concurrent first calls.
     *
     * @private
     * @returns {Promise<void>}
     */
    private _ensureLoaded;
    /**
     * @private
     * @returns {Promise<void>}
     */
    private _doLoad;
}
export {};
