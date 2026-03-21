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

/**
 * @typedef {Object} AssetEntry
 * @property {string} assetId - The 1Click NEP-141 asset ID (e.g., "nep141:eth-0xdac1...omft.near").
 * @property {boolean} isNative - True if the asset is a native chain token (ETH, BTC, SOL, etc.).
 * @property {number} decimals - Token decimal places.
 * @property {string} symbol - Token symbol (e.g., "USDT", "ETH").
 */

/**
 * Module-level singleton map: baseUrl -> AssetRegistry instance.
 *
 * This exists because wdk-manager creates a new OneClickProtocol instance on every
 * account.getSwapProtocol() call. Without a module-level cache, each call would
 * trigger a fresh GET /v0/tokens fetch. The singleton ensures the fetch happens
 * once per baseUrl per process.
 *
 * @type {Map<string, AssetRegistry>}
 */
const _registries = new Map()

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
export function getRegistry (baseUrl, client) {
  if (!_registries.has(baseUrl)) {
    _registries.set(baseUrl, new AssetRegistry(client))
  }
  return _registries.get(baseUrl)
}

/**
 * Clears all cached registries. For test isolation only.
 * @visibleForTesting
 */
export function _clearRegistriesForTesting () {
  _registries.clear()
}

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
class AssetRegistry {
  /**
   * @param {import('./one-click-client.js').default} client
   */
  constructor (client) {
    /** @private */
    this._client = client

    /**
     * @private
     * @type {Map<string, AssetEntry>}
     */
    this._cache = new Map()

    /**
     * @private
     * @type {Promise<void> | null}
     */
    this._loadPromise = null
  }

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
  async resolve (chain, tokenAddress) {
    await this._ensureLoaded()
    const key = `${chain}:${(tokenAddress ?? 'native').toLowerCase()}`
    const entry = this._cache.get(key)
    if (!entry) {
      throw new Error(`OneClickProtocol: token not found in 1Click registry: ${key}`)
    }
    return entry
  }

  /**
   * Ensures the token list has been fetched and cached.
   * Uses a promise cache to prevent duplicate fetches on concurrent first calls.
   *
   * @private
   * @returns {Promise<void>}
   */
  async _ensureLoaded () {
    if (!this._loadPromise) {
      this._loadPromise = this._doLoad().catch((err) => {
        this._loadPromise = null
        throw err
      })
    }
    return this._loadPromise
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _doLoad () {
    const tokens = await this._client.getTokens()
    for (const token of tokens) {
      const key = `${token.blockchain}:${(token.contractAddress ?? 'native').toLowerCase()}`
      this._cache.set(key, {
        assetId: token.assetId,
        isNative: !token.contractAddress,
        decimals: token.decimals,
        symbol: token.symbol
      })
    }
  }
}
