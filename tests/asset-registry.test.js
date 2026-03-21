/* eslint-disable no-unused-vars */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const MOCK_TOKENS = [
  {
    assetId: 'nep141:eth.omft.near',
    blockchain: 'eth',
    contractAddress: null,
    decimals: 18,
    symbol: 'ETH'
  },
  {
    assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
    blockchain: 'eth',
    contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    symbol: 'USDT'
  },
  {
    assetId: 'nep141:btc.omft.near',
    blockchain: 'btc',
    contractAddress: null,
    decimals: 8,
    symbol: 'BTC'
  },
  {
    assetId: 'nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near',
    blockchain: 'arb',
    contractAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
    symbol: 'USDT'
  }
]

import { getRegistry, _clearRegistriesForTesting } from '../src/asset-registry.js'

beforeEach(() => {
  _clearRegistriesForTesting()
})

function createMockClient (tokens = MOCK_TOKENS) {
  return {
    getTokens: jest.fn().mockResolvedValue(tokens)
  }
}

describe('AssetRegistry', () => {
  describe('resolve', () => {
    it('fetches tokens on first resolve call', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      await registry.resolve('eth', 'native')

      expect(client.getTokens).toHaveBeenCalledTimes(1)
    })

    it('does not re-fetch on subsequent resolve calls', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      await registry.resolve('eth', 'native')
      await registry.resolve('btc', 'native')
      await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      expect(client.getTokens).toHaveBeenCalledTimes(1)
    })

    it('resolves native assets with isNative: true', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      const entry = await registry.resolve('eth', 'native')

      expect(entry.isNative).toBe(true)
      expect(entry.assetId).toBe('nep141:eth.omft.near')
      expect(entry.decimals).toBe(18)
      expect(entry.symbol).toBe('ETH')
    })

    it('resolves token assets with isNative: false', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      const entry = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      expect(entry.isNative).toBe(false)
      expect(entry.assetId).toBe('nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near')
      expect(entry.decimals).toBe(6)
      expect(entry.symbol).toBe('USDT')
    })

    it('resolves case-insensitively (checksummed vs lowercased)', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      const upper = await registry.resolve('eth', '0xDAC17F958D2EE523A2206206994597C13D831EC7')
      const lower = await registry.resolve('eth', '0xdac17f958d2ee523a2206206994597c13d831ec7')
      const mixed = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      expect(upper.assetId).toBe(lower.assetId)
      expect(lower.assetId).toBe(mixed.assetId)
    })

    it('resolves null tokenAddress as native', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      const entry = await registry.resolve('btc', null)

      expect(entry.isNative).toBe(true)
      expect(entry.assetId).toBe('nep141:btc.omft.near')
    })

    it('throws when token is not found', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      await expect(registry.resolve('eth', '0xunknown'))
        .rejects.toThrow('OneClickProtocol: token not found in 1Click registry: eth:0xunknown')
    })

    it('throws when chain is not found', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      await expect(registry.resolve('polygon', 'native'))
        .rejects.toThrow('OneClickProtocol: token not found in 1Click registry: polygon:native')
    })

    it('uses token.blockchain field for lookup key', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      const entry = await registry.resolve('arb', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9')

      expect(entry.assetId).toBe('nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near')
    })
  })

  describe('getRegistry singleton', () => {
    it('returns the same instance for the same baseUrl', () => {
      const client = createMockClient()
      const r1 = getRegistry('https://api.test', client)
      const r2 = getRegistry('https://api.test', client)

      expect(r1).toBe(r2)
    })

    it('returns different instances for different baseUrls', () => {
      const client = createMockClient()
      const r1 = getRegistry('https://api-a.test', client)
      const r2 = getRegistry('https://api-b.test', client)

      expect(r1).not.toBe(r2)
    })

    it('ignores client parameter on cache hit', async () => {
      const client1 = createMockClient()
      const client2 = createMockClient()

      const r1 = getRegistry('https://api.test', client1)
      const r2 = getRegistry('https://api.test', client2)

      await r1.resolve('eth', 'native')

      expect(client1.getTokens).toHaveBeenCalledTimes(1)
      expect(client2.getTokens).toHaveBeenCalledTimes(0)
    })
  })

  describe('_clearRegistriesForTesting', () => {
    it('clears cached registries', () => {
      const client = createMockClient()
      const r1 = getRegistry('https://api.test', client)

      _clearRegistriesForTesting()

      const r2 = getRegistry('https://api.test', client)
      expect(r1).not.toBe(r2)
    })
  })

  describe('concurrent loading', () => {
    it('does not double-fetch on concurrent resolve calls', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.test', client)

      await Promise.all([
        registry.resolve('eth', 'native'),
        registry.resolve('btc', 'native'),
        registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')
      ])

      expect(client.getTokens).toHaveBeenCalledTimes(1)
    })
  })

  describe('load failure and retry', () => {
    it('retries after transient load failure', async () => {
      const client = {
        getTokens: jest.fn()
          .mockRejectedValueOnce(new Error('network error'))
          .mockResolvedValueOnce(MOCK_TOKENS)
      }
      const registry = getRegistry('https://api.retry', client)

      // First call fails
      await expect(registry.resolve('eth', 'native')).rejects.toThrow('network error')

      // Second call retries and succeeds
      const entry = await registry.resolve('eth', 'native')
      expect(entry.isNative).toBe(true)
      expect(entry.symbol).toBe('ETH')
      expect(client.getTokens).toHaveBeenCalledTimes(2)
    })

    it('does not retry after successful load', async () => {
      const client = createMockClient()
      const registry = getRegistry('https://api.noretry', client)

      await registry.resolve('eth', 'native')

      // Subsequent failure should not happen — still uses cache
      client.getTokens.mockRejectedValue(new Error('should not be called'))

      const entry = await registry.resolve('btc', 'native')
      expect(entry.isNative).toBe(true)
      expect(client.getTokens).toHaveBeenCalledTimes(1)
    })
  })
})
