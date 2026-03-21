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

const DEFAULT_BASE_URL = 'https://1click.chaindefuser.com'

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
  constructor ({ baseUrl = DEFAULT_BASE_URL, jwt } = {}) {
    /** @private */
    this._baseUrl = baseUrl.replace(/\/+$/, '')

    /** @private */
    this._jwt = jwt
  }

  /**
   * Fetches the list of supported tokens.
   *
   * @returns {Promise<Array<{ assetId: string, decimals: number, blockchain: string, symbol: string, price: string, priceUpdatedAt: string, contractAddress: string | null }>>}
   */
  async getTokens () {
    return this._request('GET', '/v0/tokens')
  }

  /**
   * Requests a swap quote.
   *
   * @param {Object} requestBody - The full quote request body per POST /v0/quote schema.
   * @returns {Promise<Object>} The QuoteResponse.
   */
  async getQuote (requestBody) {
    return this._request('POST', '/v0/quote', requestBody)
  }

  /**
   * Polls the execution status of a swap.
   *
   * @param {string} depositAddress - The deposit address from the quote response.
   * @param {string} [depositMemo] - The deposit memo (required for Stellar/memo chains).
   * @returns {Promise<Object>} The GetExecutionStatusResponse.
   */
  async getExecutionStatus (depositAddress, depositMemo) {
    const params = new URLSearchParams({ depositAddress })
    if (depositMemo) {
      params.set('depositMemo', depositMemo)
    }
    return this._request('GET', `/v0/status?${params.toString()}`)
  }

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
  async submitDepositTx (requestBody) {
    return this._request('POST', '/v0/deposit/submit', requestBody)
  }

  /**
   * @private
   * @param {string} method
   * @param {string} path
   * @param {Object} [body]
   * @returns {Promise<any>}
   */
  async _request (method, path, body) {
    const url = `${this._baseUrl}${path}`

    const headers = {}
    if (this._jwt) {
      headers.Authorization = `Bearer ${this._jwt}`
    }

    const options = { method, headers }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      let errorBody
      try {
        errorBody = await response.text()
      } catch {
        errorBody = '<unreadable>'
      }
      throw new Error(
        `OneClickClient: ${method} ${path} returned ${response.status}: ${errorBody}`
      )
    }

    return response.json()
  }
}
