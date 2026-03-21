/* eslint-disable no-unused-vars */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import OneClickClient from '../src/one-click-client.js'

describe('OneClickClient', () => {
  let client
  let mockFetch

  function setupFetch (responseBody, status = 200) {
    mockFetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValue(responseBody),
      text: jest.fn().mockResolvedValue(JSON.stringify(responseBody))
    })
    globalThis.fetch = mockFetch
  }

  afterEach(() => {
    delete globalThis.fetch
  })

  describe('getTokens', () => {
    it('sends GET request to /v0/tokens', async () => {
      const tokens = [{ assetId: 'nep141:eth.omft.near', blockchain: 'eth' }]
      setupFetch(tokens)
      client = new OneClickClient()

      const result = await client.getTokens()

      expect(result).toEqual(tokens)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://1click.chaindefuser.com/v0/tokens',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('sends no Authorization header when JWT is absent', async () => {
      setupFetch([])
      client = new OneClickClient()

      await client.getTokens()

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers.Authorization).toBeUndefined()
    })

    it('sends Authorization header when JWT is configured', async () => {
      setupFetch([])
      client = new OneClickClient({ jwt: 'test-jwt-token' })

      await client.getTokens()

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers.Authorization).toBe('Bearer test-jwt-token')
    })
  })

  describe('getQuote', () => {
    it('sends POST request with correct Content-Type and body', async () => {
      const quoteResponse = { correlationId: 'abc', quote: { amountIn: '100' } }
      setupFetch(quoteResponse)
      client = new OneClickClient({ jwt: 'my-jwt' })

      const body = { dry: true, swapType: 'EXACT_INPUT', amount: '1000000' }
      const result = await client.getQuote(body)

      expect(result).toEqual(quoteResponse)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://1click.chaindefuser.com/v0/quote')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.headers.Authorization).toBe('Bearer my-jwt')
      expect(options.body).toBe(JSON.stringify(body))
    })
  })

  describe('getExecutionStatus', () => {
    it('sends GET request with depositAddress query param', async () => {
      const statusResponse = { status: 'PROCESSING', correlationId: 'xyz' }
      setupFetch(statusResponse)
      client = new OneClickClient({ jwt: 'jwt' })

      const result = await client.getExecutionStatus('0xdeposit123')

      expect(result).toEqual(statusResponse)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('/v0/status?')
      expect(url).toContain('depositAddress=0xdeposit123')
    })

    it('includes depositMemo query param when provided', async () => {
      setupFetch({ status: 'PENDING_DEPOSIT' })
      client = new OneClickClient({ jwt: 'jwt' })

      await client.getExecutionStatus('0xdeposit', 'memo-value')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('depositMemo=memo-value')
    })

    it('omits depositMemo query param when not provided', async () => {
      setupFetch({ status: 'PENDING_DEPOSIT' })
      client = new OneClickClient({ jwt: 'jwt' })

      await client.getExecutionStatus('0xdeposit')

      const [url] = mockFetch.mock.calls[0]
      expect(url).not.toContain('depositMemo')
    })
  })

  describe('submitDepositTx', () => {
    it('sends POST with correct body including memo and nearSenderAccount', async () => {
      setupFetch({ success: true })
      client = new OneClickClient({ jwt: 'jwt' })

      const body = {
        txHash: '0xhash',
        depositAddress: '0xdeposit',
        memo: 'stellar-memo',
        nearSenderAccount: 'alice.near'
      }
      await client.submitDepositTx(body)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://1click.chaindefuser.com/v0/deposit/submit')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual(body)
    })
  })

  describe('error handling', () => {
    it('throws on non-2xx response with status and body', async () => {
      setupFetch({ error: 'bad request' }, 400)
      client = new OneClickClient()

      await expect(client.getTokens()).rejects.toThrow(
        'OneClickClient: GET /v0/tokens returned 400'
      )
    })

    it('includes response body text in error message', async () => {
      setupFetch('Not found', 404)
      client = new OneClickClient()

      await expect(client.getQuote({})).rejects.toThrow('returned 404')
    })
  })

  describe('baseUrl', () => {
    it('uses custom baseUrl', async () => {
      setupFetch([])
      client = new OneClickClient({ baseUrl: 'https://custom.api.com/' })

      await client.getTokens()

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('https://custom.api.com/v0/tokens')
    })

    it('strips trailing slashes from baseUrl', async () => {
      setupFetch([])
      client = new OneClickClient({ baseUrl: 'https://custom.api.com///' })

      await client.getTokens()

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('https://custom.api.com/v0/tokens')
    })
  })
})
