/* eslint-disable no-unused-vars */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const MOCK_TOKENS = [
  { assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', blockchain: 'eth', contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, symbol: 'USDT', price: 1.0 },
  { assetId: 'nep141:tron-usdt.omft.near', blockchain: 'tron', contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, symbol: 'USDT', price: 1.0 },
  { assetId: 'nep141:sol-usdt.omft.near', blockchain: 'sol', contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, symbol: 'USDT', price: 1.0 },
  { assetId: 'nep141:ton-usdt.omft.near', blockchain: 'ton', contractAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6, symbol: 'USDT', price: 1.0 },
  { assetId: 'nep141:eth.omft.near', blockchain: 'eth', contractAddress: null, decimals: 18, symbol: 'ETH', price: 2100.0 },
  { assetId: 'nep141:btc.omft.near', blockchain: 'btc', contractAddress: null, decimals: 8, symbol: 'BTC', price: 70000.0 },
  // Stellar USDT — should be excluded from supported chains (memo-required)
  { assetId: 'nep141:stellar-usdt.omft.near', blockchain: 'stellar', contractAddress: 'GA5Z...', decimals: 6, symbol: 'USDT', price: 1.0 }
]

function createMockProtocol () {
  return {
    _config: {
      sourceChain: 'btc',
      slippageBps: 100,
      deadlineMs: 600000,
      quoteWaitingTimeMs: undefined,
      appFees: undefined,
      referral: undefined
    },
    sourceChain: 'btc',
    resolveToken: jest.fn().mockImplementation(async (chain, tokenAddress) => {
      if (chain === 'btc' && (tokenAddress === 'native' || tokenAddress == null)) {
        return { assetId: 'nep141:btc.omft.near', isNative: true, decimals: 8, symbol: 'BTC' }
      }
      if (chain === 'eth' && (tokenAddress === 'native' || tokenAddress == null)) {
        return { assetId: 'nep141:eth.omft.near', isNative: true, decimals: 18, symbol: 'ETH' }
      }
      throw new Error(`Token not found: ${chain}:${tokenAddress}`)
    }),
    getSupportedTokens: jest.fn().mockResolvedValue(MOCK_TOKENS),
    quoteSwap: jest.fn().mockResolvedValue({
      fee: 0n,
      tokenInAmount: 71500n, // 0.000715 BTC for $50 USDT
      tokenOutAmount: 50000000n
    }),
    swap: jest.fn().mockResolvedValue({
      hash: '0xdeposithash',
      fee: 0n,
      tokenInAmount: 71500n,
      tokenOutAmount: 50000000n,
      depositAddress: '0xdepositaddr',
      depositMemo: undefined,
      correlationId: 'corr-pay-123',
      quoteSignature: 'sig-pay',
      quoteResponse: { quote: { amountIn: '71500' } }
    }),
    getSwapStatus: jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      terminal: true,
      correlationId: 'corr-pay-123',
      updatedAt: '2026-01-01T00:00:00Z',
      swapDetails: {}
    })
  }
}

let OneClickPay

beforeEach(async () => {
  const mod = await import('../src/one-click-pay.js')
  OneClickPay = mod.default
})

describe('OneClickPay', () => {
  describe('quotePay', () => {
    it('resolves USDT on destination chain and calls quoteSwap with EXACT_OUTPUT', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(protocol.quoteSwap).toHaveBeenCalledWith(
        {
          tokenIn: 'native',
          tokenOut: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          tokenOutAmount: 50000000n,
          destinationChain: 'eth',
          to: '0xAlice'
        },
        expect.objectContaining({ slippageBps: 200 })
      )
    })

    it('converts human amount to base units correctly (6 decimals)', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await pay.quotePay({
        tokenIn: 'native',
        amount: '100.50',
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      const call = protocol.quoteSwap.mock.calls[0][0]
      expect(call.tokenOutAmount).toBe(100500000n)
    })

    it('returns formatted cost with symbol', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(quote.costFormatted).toContain('BTC')
      expect(quote.costBaseUnits).toBe(71500n)
      expect(quote.costSymbol).toBe('BTC')
      expect(quote.amount).toBe(50)
      expect(quote.recipientChain).toBe('eth')
      expect(quote.slippageBps).toBe(200) // OneClickPay default
    })

    it('applies per-call slippage override via overrides object', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth',
        slippageBps: 50
      })
      expect(quote.slippageBps).toBe(50)

      // protocol._config must never be mutated
      expect(protocol._config.slippageBps).toBe(100)

      // The overrides passed to quoteSwap should contain slippageBps: 50
      const overrides = protocol.quoteSwap.mock.calls[0][1]
      expect(overrides.slippageBps).toBe(50)
    })

    it('does not mutate protocol._config even on error', async () => {
      const protocol = createMockProtocol()
      protocol.quoteSwap.mockRejectedValue(new Error('API error'))
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth',
        slippageBps: 50
      })).rejects.toThrow('API error')

      // Config must be completely untouched (no mutation, no restore needed)
      expect(protocol._config.slippageBps).toBe(100)
      expect(protocol._config.deadlineMs).toBe(600000)
      expect(protocol._config.quoteWaitingTimeMs).toBeUndefined()
    })

    it('uses tokenOut override when provided (bypasses USDT resolution)', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth',
        tokenOut: '0xcustom_usdt_address'
      })

      const call = protocol.quoteSwap.mock.calls[0][0]
      expect(call.tokenOut).toBe('0xcustom_usdt_address')
    })

    it('throws if USDT is not available on destination chain', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'arb' // No USDT on Arbitrum in mock
      })).rejects.toThrow("USDT is not available on chain 'arb'")
    })

    it('throws if amount is zero', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 0,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('amount must be a positive number')
    })

    it('throws if amount is negative', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: -50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('amount must be a positive number')
    })

    it('throws if amount has too many fractional digits', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: '50.1234567', // 7 digits > 6 decimals for USDT
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('fractional digits')
    })

    it('memoizes USDT resolution per chain', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await pay.quotePay({ tokenIn: 'native', amount: 50, recipientAddress: '0xA', recipientChain: 'eth' })
      await pay.quotePay({ tokenIn: 'native', amount: 100, recipientAddress: '0xB', recipientChain: 'eth' })

      // getSupportedTokens called once for resolution, not twice
      expect(protocol.getSupportedTokens).toHaveBeenCalledTimes(1)
    })

    it('forwards OneClickPay config to protocol (deadline, quoteWaitingTimeMs, appFees, referral) via overrides', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol, {
        deadlineMs: 3600000,
        quoteWaitingTimeMs: 5000,
        appFees: [{ recipient: '0xfee', fee: 50 }],
        referral: 'myapp'
      })

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      // Overrides must be forwarded to quoteSwap, not applied to protocol._config
      const overrides = protocol.quoteSwap.mock.calls[0][1]
      expect(overrides.deadlineMs).toBe(3600000)
      expect(overrides.quoteWaitingTimeMs).toBe(5000)
      expect(overrides.appFees).toEqual([{ recipient: '0xfee', fee: 50 }])
      expect(overrides.referral).toBe('myapp')

      // protocol._config must be completely untouched
      expect(protocol._config.deadlineMs).toBe(600000)
      expect(protocol._config.quoteWaitingTimeMs).toBeUndefined()
      expect(protocol._config.appFees).toBeUndefined()
      expect(protocol._config.referral).toBeUndefined()
    })
  })

  describe('pay', () => {
    it('calls protocol.swap with EXACT_OUTPUT and returns PayResult', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const result = await pay.pay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(protocol.swap).toHaveBeenCalledWith(
        {
          tokenIn: 'native',
          tokenOut: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          tokenOutAmount: 50000000n,
          destinationChain: 'eth',
          to: '0xAlice'
        },
        expect.objectContaining({ slippageBps: 200 })
      )

      expect(result.hash).toBe('0xdeposithash')
      expect(result.depositAddress).toBe('0xdepositaddr')
      expect(result.amountPaid).toBe(71500n)
      expect(result.amountReceived).toBe(50)
      expect(result.recipientChain).toBe('eth')
      expect(result.recipientAddress).toBe('0xAlice')
      expect(result.correlationId).toBe('corr-pay-123')
      expect(result.quoteResponse).toBeDefined()
    })

    it('applies per-call slippage override via overrides object', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      await pay.pay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth',
        slippageBps: 300
      })

      // Config must never be mutated
      expect(protocol._config.slippageBps).toBe(100)

      // The overrides passed to swap should contain slippageBps: 300
      const overrides = protocol.swap.mock.calls[0][1]
      expect(overrides.slippageBps).toBe(300)
    })
  })

  describe('getPaymentStatus', () => {
    it('delegates to protocol.getSwapStatus', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const status = await pay.getPaymentStatus('0xdepositaddr')

      expect(protocol.getSwapStatus).toHaveBeenCalledWith('0xdepositaddr')
      expect(status.status).toBe('SUCCESS')
      expect(status.terminal).toBe(true)
    })
  })

  describe('getSupportedPaymentChains', () => {
    it('returns chains where USDT is available', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const chains = await pay.getSupportedPaymentChains()

      expect(chains).toContain('eth')
      expect(chains).toContain('tron')
      expect(chains).toContain('sol')
      expect(chains).toContain('ton')
    })

    it('excludes memo-required chains', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const chains = await pay.getSupportedPaymentChains()

      expect(chains).not.toContain('stellar')
    })

    it('does not include chains without USDT', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const chains = await pay.getSupportedPaymentChains()

      expect(chains).not.toContain('btc') // BTC has no USDT in mock
      expect(chains).not.toContain('arb') // ARB has no USDT in mock
    })
  })

  describe('getUSDTOptions', () => {
    it('returns USDT variants available on a chain', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const options = await pay.getUSDTOptions('eth')

      expect(options).toHaveLength(1)
      expect(options[0].symbol).toBe('USDT')
      expect(options[0].contractAddress).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7')
    })

    it('returns empty array for chains without USDT', async () => {
      const protocol = createMockProtocol()
      const pay = new OneClickPay(protocol)

      const options = await pay.getUSDTOptions('arb')

      expect(options).toHaveLength(0)
    })
  })

  describe('acceptedSymbols config', () => {
    it('defaults to native USDT only', async () => {
      const protocol = createMockProtocol()
      // Add a USDT0 token to the mock
      protocol.getSupportedTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:arb-usdt0.omft.near', blockchain: 'arb', contractAddress: '0xusdt0onarb', decimals: 6, symbol: 'USDT0', price: 1.0 }
      ])
      const pay = new OneClickPay(protocol) // default = 'native'

      const chains = await pay.getSupportedPaymentChains()
      expect(chains).toContain('eth') // has native USDT
      expect(chains).not.toContain('arb') // only has USDT0, not native USDT
    })

    it('acceptedSymbols: "all" includes USDT0 chains', async () => {
      const protocol = createMockProtocol()
      protocol.getSupportedTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:arb-usdt0.omft.near', blockchain: 'arb', contractAddress: '0xusdt0onarb', decimals: 6, symbol: 'USDT0', price: 1.0 }
      ])
      const pay = new OneClickPay(protocol, { acceptedSymbols: 'all' })

      const chains = await pay.getSupportedPaymentChains()
      expect(chains).toContain('eth') // native USDT
      expect(chains).toContain('arb') // USDT0
    })

    it('acceptedSymbols: ["USDT0"] includes only USDT0 chains', async () => {
      const protocol = createMockProtocol()
      protocol.getSupportedTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:arb-usdt0.omft.near', blockchain: 'arb', contractAddress: '0xusdt0onarb', decimals: 6, symbol: 'USDT0', price: 1.0 }
      ])
      const pay = new OneClickPay(protocol, { acceptedSymbols: ['USDT0'] })

      const chains = await pay.getSupportedPaymentChains()
      expect(chains).not.toContain('eth') // only native USDT, not USDT0
      expect(chains).toContain('arb') // USDT0
    })

    it('acceptedSymbols: "all" resolves USDT0 when native USDT unavailable', async () => {
      const protocol = createMockProtocol()
      protocol.getSupportedTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:arb-usdt0.omft.near', blockchain: 'arb', contractAddress: '0xusdt0onarb', decimals: 6, symbol: 'USDT0', price: 1.0 }
      ])
      const pay = new OneClickPay(protocol, { acceptedSymbols: 'all' })

      const options = await pay.getUSDTOptions('arb')
      expect(options).toHaveLength(1)
      expect(options[0].symbol).toBe('USDT0')
    })

    it('acceptedSymbols: "all" still prefers native USDT when both available', async () => {
      const protocol = createMockProtocol()
      protocol.getSupportedTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:eth-usdt0.omft.near', blockchain: 'eth', contractAddress: '0xusdt0oneth', decimals: 6, symbol: 'USDT0', price: 1.0 }
      ])
      protocol.quoteSwap.mockResolvedValue({ fee: 0n, tokenInAmount: 71500n, tokenOutAmount: 50000000n })

      const pay = new OneClickPay(protocol, { acceptedSymbols: 'all' })

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      // Should use native USDT (0xdac1...), not USDT0
      const call = protocol.quoteSwap.mock.calls[0][0]
      expect(call.tokenOut).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7')
    })

    it('throws on invalid acceptedSymbols config', () => {
      const protocol = createMockProtocol()
      expect(() => new OneClickPay(protocol, { acceptedSymbols: 123 }))
        .toThrow('invalid acceptedSymbols config')
    })
  })

  describe('error enrichment', () => {
    it('transforms minimum amount API error to user-friendly message', async () => {
      const protocol = createMockProtocol()
      protocol.quoteSwap.mockRejectedValue(
        new Error('OneClickClient: POST /v0/quote returned 400: {"message":"Amount is too low for bridge, try at least 1000000"}')
      )
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 0.01,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('payment amount is too low')
    })

    it('transforms quote unavailable API error to user-friendly message', async () => {
      const protocol = createMockProtocol()
      protocol.quoteSwap.mockRejectedValue(
        new Error('OneClickClient: POST /v0/quote returned 400: {"message":"Failed to get quote"}')
      )
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('could not get a quote')
    })

    it('passes through non-enrichable errors unchanged', async () => {
      const protocol = createMockProtocol()
      protocol.quoteSwap.mockRejectedValue(new Error('Network timeout'))
      const pay = new OneClickPay(protocol)

      await expect(pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('Network timeout')
    })

    it('transforms errors from pay() as well', async () => {
      const protocol = createMockProtocol()
      protocol.swap.mockRejectedValue(
        new Error('Amount is too low for bridge, try at least 500000')
      )
      const pay = new OneClickPay(protocol)

      await expect(pay.pay({
        tokenIn: 'native',
        amount: 0.01,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })).rejects.toThrow('payment amount is too low')
    })
  })

  describe('costFormatted precision', () => {
    it('formats with up to 8 significant digits, trimming trailing zeros', async () => {
      const protocol = createMockProtocol()
      // 71500 satoshis = 0.000715 BTC (8 decimals)
      protocol.quoteSwap.mockResolvedValue({
        fee: 0n,
        tokenInAmount: 71500n,
        tokenOutAmount: 50000000n
      })
      const pay = new OneClickPay(protocol)

      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(quote.costFormatted).toBe('0.000715 BTC')
    })

    it('does not show trailing zeros', async () => {
      const protocol = createMockProtocol()
      protocol.quoteSwap.mockResolvedValue({
        fee: 0n,
        tokenInAmount: 100000000n, // 1.0 BTC exactly
        tokenOutAmount: 50000000n
      })
      const pay = new OneClickPay(protocol)

      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      // Should be "1 BTC" not "1.0000000 BTC"
      expect(quote.costFormatted).toBe('1 BTC')
    })
  })

  describe('config forwarding verification', () => {
    it('passes all OneClickPay config fields as overrides without mutating protocol._config', async () => {
      const protocol = createMockProtocol()
      const originalConfig = { ...protocol._config }

      const pay = new OneClickPay(protocol, {
        deadlineMs: 3600000,
        quoteWaitingTimeMs: 5000,
        appFees: [{ recipient: '0xfee', fee: 50 }],
        referral: 'myapp'
      })

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      // Overrides are passed as second argument to quoteSwap
      const overrides = protocol.quoteSwap.mock.calls[0][1]
      expect(overrides.slippageBps).toBe(200) // OneClickPay default
      expect(overrides.deadlineMs).toBe(3600000)
      expect(overrides.quoteWaitingTimeMs).toBe(5000)
      expect(overrides.appFees).toEqual([{ recipient: '0xfee', fee: 50 }])
      expect(overrides.referral).toBe('myapp')

      // protocol._config is completely unchanged before, during, and after
      expect(protocol._config).toEqual(originalConfig)
    })

    it('protocol._config is unchanged after quotePay', async () => {
      const protocol = createMockProtocol()
      const configBefore = JSON.parse(JSON.stringify(protocol._config))

      const pay = new OneClickPay(protocol, {
        deadlineMs: 9999999,
        quoteWaitingTimeMs: 1000,
        slippageBps: 500
      })

      await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(protocol._config).toEqual(configBefore)
    })

    it('protocol._config is unchanged after pay', async () => {
      const protocol = createMockProtocol()
      const configBefore = JSON.parse(JSON.stringify(protocol._config))

      const pay = new OneClickPay(protocol, {
        deadlineMs: 9999999,
        quoteWaitingTimeMs: 1000,
        slippageBps: 500
      })

      await pay.pay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: '0xAlice',
        recipientChain: 'eth'
      })

      expect(protocol._config).toEqual(configBefore)
    })
  })
})
