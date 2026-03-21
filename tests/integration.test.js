/**
 * Integration tests against the live 1Click API.
 *
 * These tests use dry: true (no funds at risk) and GET /v0/tokens (public).
 * Requires ONECLICK_JWT in .env for authenticated quote tests.
 *
 * Run with: npm run test:integration
 */

/* eslint-disable no-unused-vars */

import dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

import OneClickClient from '../src/one-click-client.js'
import OneClickProtocol from '../src/one-click-protocol.js'
import OneClickPay from '../src/one-click-pay.js'
import { getRegistry, _clearRegistriesForTesting } from '../src/asset-registry.js'

const JWT = process.env.ONECLICK_JWT
const BASE_URL = 'https://1click.chaindefuser.com'

// Use a known valid EVM address for test recipient/refund
const TEST_EVM_ADDRESS = '0x0000000000000000000000000000000000000001'
const TEST_BTC_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

if (!JWT) {
  throw new Error('ONECLICK_JWT not set in .env — cannot run integration tests')
}

describe('1Click API Integration', () => {
  let client

  beforeAll(() => {
    client = new OneClickClient({ baseUrl: BASE_URL, jwt: JWT })
  })

  describe('GET /v0/tokens', () => {
    it('returns a non-empty array of tokens', async () => {
      const tokens = await client.getTokens()

      expect(Array.isArray(tokens)).toBe(true)
      expect(tokens.length).toBeGreaterThan(0)
    })

    it('each token has required fields', async () => {
      const tokens = await client.getTokens()
      const token = tokens[0]

      expect(typeof token.assetId).toBe('string')
      expect(typeof token.blockchain).toBe('string')
      expect(typeof token.symbol).toBe('string')
      expect(typeof token.decimals).toBe('number')
    })

    it('includes known tokens (ETH native, USDT on ETH)', async () => {
      const tokens = await client.getTokens()

      // Native tokens have contractAddress absent (not null)
      const ethNative = tokens.find(t => t.blockchain === 'eth' && !t.contractAddress)
      expect(ethNative).toBeDefined()
      expect(ethNative.symbol).toBe('ETH')

      const usdtEth = tokens.find(t =>
        t.blockchain === 'eth' &&
        t.contractAddress?.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7'
      )
      expect(usdtEth).toBeDefined()
      expect(usdtEth.symbol).toBe('USDT')
    })

    it('includes BTC and SOL native tokens', async () => {
      const tokens = await client.getTokens()

      const btc = tokens.find(t => t.blockchain === 'btc' && !t.contractAddress)
      expect(btc).toBeDefined()
      expect(btc.symbol).toBe('BTC')

      const sol = tokens.find(t => t.blockchain === 'sol' && !t.contractAddress)
      expect(sol).toBeDefined()
      expect(sol.symbol).toBe('SOL')
    })
  })

  describe('AssetRegistry with live data', () => {
    beforeAll(() => {
      _clearRegistriesForTesting()
    })

    it('resolves ETH native asset', async () => {
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('eth', 'native')

      expect(entry.isNative).toBe(true)
      expect(entry.symbol).toBe('ETH')
      expect(entry.assetId).toContain('eth')
    })

    it('resolves USDT on ETH by contract address', async () => {
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      expect(entry.isNative).toBe(false)
      expect(entry.symbol).toBe('USDT')
      expect(entry.decimals).toBe(6)
    })

    it('resolves BTC native asset', async () => {
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('btc', 'native')

      expect(entry.isNative).toBe(true)
      expect(entry.symbol).toBe('BTC')
    })
  })

  describe('POST /v0/quote (dry: true)', () => {
    it('returns a quote for USDT ETH → USDT ARB (cross-chain, EXACT_INPUT)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')
      const dest = await registry.resolve('arb', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '1000000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      expect(quoteResponse.correlationId).toBeDefined()
      expect(typeof quoteResponse.correlationId).toBe('string')
      expect(quoteResponse.signature).toBeDefined()
      expect(quoteResponse.quote).toBeDefined()

      expect(typeof quoteResponse.quote.amountIn).toBe('string')
      expect(typeof quoteResponse.quote.amountOut).toBe('string')

      expect(() => BigInt(quoteResponse.quote.amountIn)).not.toThrow()
      expect(() => BigInt(quoteResponse.quote.amountOut)).not.toThrow()

      const amountOut = BigInt(quoteResponse.quote.amountOut)
      expect(amountOut).toBeGreaterThan(0n)

      console.log('  Quote: %s USDT in → %s USDT out', quoteResponse.quote.amountIn, quoteResponse.quote.amountOut)
      console.log('  correlationId:', quoteResponse.correlationId)
    })

    it('returns a quote for ETH native → USDT ETH (same-chain, native→token)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('eth', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '100000000000000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      expect(quoteResponse.quote).toBeDefined()
      const amountOut = BigInt(quoteResponse.quote.amountOut)
      expect(amountOut).toBeGreaterThan(0n)

      console.log('  Quote: 0.1 ETH → %s USDT', quoteResponse.quote.amountOut)
    })

    it('returns a quote for EXACT_OUTPUT (buy exact USDT amount)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('eth', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_OUTPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '100000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      expect(quoteResponse.quote).toBeDefined()
      expect(quoteResponse.quote.amountIn).toBeDefined()
      expect(quoteResponse.quote.amountOut).toBeDefined()

      console.log('  EXACT_OUTPUT: need %s ETH (wei) for 100 USDT', quoteResponse.quote.amountIn)
      if (quoteResponse.quote.minAmountIn) {
        console.log('  minAmountIn:', quoteResponse.quote.minAmountIn)
      }
      if (quoteResponse.quote.maxAmountIn) {
        console.log('  maxAmountIn:', quoteResponse.quote.maxAmountIn)
      }
    })

    it('returns a quote for BTC → USDT on ETH (cross-chain, BTC source)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('btc', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '1000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_BTC_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      expect(quoteResponse.quote).toBeDefined()
      const amountOut = BigInt(quoteResponse.quote.amountOut)
      expect(amountOut).toBeGreaterThan(0n)

      console.log('  Quote: 0.01 BTC → %s USDT', quoteResponse.quote.amountOut)
      console.log('  timeEstimate:', quoteResponse.quote.timeEstimate, 'seconds')
    })

    it('returns a quote for SOL → USDT on ETH (non-EVM source)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('sol', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '1000000000', // 1 SOL (9 decimals)
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: 'So11111111111111111111111111111111111111112', // SOL system program (valid pubkey)
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      expect(quoteResponse.quote).toBeDefined()
      expect(BigInt(quoteResponse.quote.amountOut)).toBeGreaterThan(0n)
      console.log('  Quote: 1 SOL → %s USDT', quoteResponse.quote.amountOut)
    })
  })

  describe('Quote response shape validation', () => {
    it('dry: true response has expected fields and types', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)

      const origin = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')
      const dest = await registry.resolve('arb', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9')

      const quoteResponse = await client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '1000000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })

      // Top-level fields
      expect(typeof quoteResponse.correlationId).toBe('string')
      expect(typeof quoteResponse.signature).toBe('string')
      expect(quoteResponse.quote).toBeDefined()

      // Amounts are parseable bigint strings
      expect(typeof quoteResponse.quote.amountIn).toBe('string')
      expect(typeof quoteResponse.quote.amountOut).toBe('string')
      expect(() => BigInt(quoteResponse.quote.amountIn)).not.toThrow()
      expect(() => BigInt(quoteResponse.quote.amountOut)).not.toThrow()

      // timeEstimate is a number
      expect(typeof quoteResponse.quote.timeEstimate).toBe('number')
      expect(quoteResponse.quote.timeEstimate).toBeGreaterThan(0)

      // minAmountOut exists and is <= amountOut
      expect(typeof quoteResponse.quote.minAmountOut).toBe('string')
      expect(BigInt(quoteResponse.quote.minAmountOut)).toBeLessThanOrEqual(BigInt(quoteResponse.quote.amountOut))

      // dry: true should NOT return depositAddress, deadline, or timeWhenInactive
      // These being absent (not null) is critical — the deadline guard relies on this
      expect(quoteResponse.quote.depositAddress).toBeUndefined()
      expect(quoteResponse.quote.deadline).toBeUndefined()
      expect(quoteResponse.quote.timeWhenInactive).toBeUndefined()
    })
  })

  describe('Chain coverage', () => {
    it('token list includes expected chains', async () => {
      const tokens = await client.getTokens()
      const chains = new Set(tokens.map(t => t.blockchain))

      const expectedChains = ['eth', 'sol', 'btc', 'ton', 'tron', 'near', 'arb', 'base', 'op']
      for (const chain of expectedChains) {
        expect(chains).toContain(chain)
      }
    })

    it('resolves SOL native with correct decimals', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('sol', 'native')

      expect(entry.isNative).toBe(true)
      expect(entry.symbol).toBe('SOL')
      expect(entry.decimals).toBe(9)
    })

    it('resolves TON native', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('ton', 'native')

      expect(entry.isNative).toBe(true)
      expect(entry.symbol).toBe('TON')
    })

    it('resolves wNEAR on NEAR (no native NEAR — uses wrapped)', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)
      const entry = await registry.resolve('near', 'wrap.near')

      expect(entry.isNative).toBe(false)
      expect(entry.symbol).toBe('wNEAR')
      expect(entry.decimals).toBe(24)
    })
  })

  describe('API error cases', () => {
    it('rejects quote when amount is too small', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)
      const origin = await registry.resolve('eth', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      await expect(client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '1', // 1 wei — essentially zero value
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + 600000).toISOString()
      })).rejects.toThrow('OneClickClient')
    })

    it('rejects quote with expired request deadline', async () => {
      _clearRegistriesForTesting()
      const registry = getRegistry(BASE_URL, client)
      const origin = await registry.resolve('eth', 'native')
      const dest = await registry.resolve('eth', '0xdAC17F958D2ee523a2206206994597C13D831ec7')

      await expect(client.getQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: dest.assetId,
        amount: '100000000000000000',
        depositType: 'ORIGIN_CHAIN',
        recipient: TEST_EVM_ADDRESS,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: TEST_EVM_ADDRESS,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() - 60000).toISOString() // 1 minute ago
      })).rejects.toThrow('OneClickClient')
    })
  })
})

describe('OneClickPay Integration', () => {
  // Minimal mock account — only getAddress() needed for dry quotes
  const mockAccount = {
    getAddress: async () => TEST_EVM_ADDRESS
  }

  let pay

  beforeAll(() => {
    _clearRegistriesForTesting()
    const protocol = new OneClickProtocol(mockAccount, {
      sourceChain: 'eth',
      jwt: JWT,
      baseUrl: BASE_URL
    })
    pay = new OneClickPay(protocol, {
      slippageBps: 200,
      quoteWaitingTimeMs: 3000,
      acceptedSymbols: 'all'
    })
  })

  describe('quotePay against live API', () => {
    it('quotes ETH → $50 USDT on ETH (same-chain payment)', async () => {
      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 50,
        recipientAddress: TEST_EVM_ADDRESS,
        recipientChain: 'eth'
      })

      expect(quote.costBaseUnits).toBeGreaterThan(0n)
      expect(quote.costSymbol).toBe('ETH')
      expect(quote.costFormatted).toContain('ETH')
      expect(quote.amount).toBe(50)
      expect(quote.recipientChain).toBe('eth')
      expect(quote.slippageBps).toBe(200)

      console.log('  Pay $50 USDT on ETH: cost =', quote.costFormatted)
    })

    it('quotes ETH → $100 USDT on TON (cross-chain payment)', async () => {
      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 100,
        recipientAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
        recipientChain: 'ton'
      })

      expect(quote.costBaseUnits).toBeGreaterThan(0n)
      expect(quote.costSymbol).toBe('ETH')
      expect(quote.amount).toBe(100)
      expect(quote.recipientChain).toBe('ton')

      console.log('  Pay $100 USDT on TON: cost =', quote.costFormatted)
    })

    it('quotes ETH → $1000 USDT on SOL (large cross-chain payment)', async () => {
      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: 1000,
        recipientAddress: 'So11111111111111111111111111111111111111112',
        recipientChain: 'sol'
      })

      expect(quote.costBaseUnits).toBeGreaterThan(0n)
      expect(quote.amount).toBe(1000)

      console.log('  Pay $1000 USDT on SOL: cost =', quote.costFormatted)
    })

    it('quotes with string amount preserving precision', async () => {
      const quote = await pay.quotePay({
        tokenIn: 'native',
        amount: '50.50',
        recipientAddress: TEST_EVM_ADDRESS,
        recipientChain: 'eth'
      })

      expect(quote.costBaseUnits).toBeGreaterThan(0n)
      expect(quote.amount).toBe('50.50')

      console.log('  Pay $50.50 USDT on ETH: cost =', quote.costFormatted)
    })
  })

  describe('getSupportedPaymentChains', () => {
    it('returns chains where USDT is available', async () => {
      const chains = await pay.getSupportedPaymentChains()

      expect(Array.isArray(chains)).toBe(true)
      expect(chains.length).toBeGreaterThan(0)

      // Known USDT chains
      expect(chains).toContain('eth')
      expect(chains).toContain('tron')
      expect(chains).toContain('sol')
      expect(chains).toContain('ton')

      // ARB has USDT0 (discovered from live API), so it IS a valid payment chain
      expect(chains).toContain('arb')

      console.log('  Supported payment chains:', chains.join(', '))
    })
  })

  describe('USDT contract address verification', () => {
    it('resolves canonical USDT on Ethereum', async () => {
      const options = await pay.getUSDTOptions('eth')

      expect(options.length).toBeGreaterThan(0)
      const usdt = options.find(t => t.symbol === 'USDT')
      expect(usdt).toBeDefined()
      expect(usdt.contractAddress.toLowerCase()).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7')
      expect(usdt.decimals).toBe(6)
    })

    it('resolves canonical USDT on Tron', async () => {
      const options = await pay.getUSDTOptions('tron')

      expect(options.length).toBeGreaterThan(0)
      const usdt = options.find(t => t.symbol === 'USDT')
      expect(usdt).toBeDefined()
      expect(usdt.contractAddress).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    })

    it('resolves USDT on Solana', async () => {
      const options = await pay.getUSDTOptions('sol')

      expect(options.length).toBeGreaterThan(0)
      const usdt = options.find(t => t.symbol === 'USDT')
      expect(usdt).toBeDefined()
      expect(usdt.decimals).toBe(6)
    })

    it('resolves USDT0 on Arbitrum (USDT0 variant)', async () => {
      const options = await pay.getUSDTOptions('arb')
      expect(options.length).toBeGreaterThan(0)
      expect(options[0].symbol).toBe('USDT0')
      console.log('  ARB USDT variant:', options[0].symbol, options[0].contractAddress)
    })

    it('returns empty for chains without any USDT variant', async () => {
      const options = await pay.getUSDTOptions('near') // NEAR has wNEAR but symbol is not USDT/USDT0... let me check
      // Actually NEAR has USDT with symbol 'USDT' — need a chain that truly has none
      // Use a chain that doesn't exist in the token list
      const options2 = await pay.getUSDTOptions('doesnotexist')
      expect(options2).toHaveLength(0)
    })
  })
})
