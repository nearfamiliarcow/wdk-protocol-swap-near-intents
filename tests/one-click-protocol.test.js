/* eslint-disable no-unused-vars */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const MOCK_TOKENS = [
  { assetId: 'nep141:eth.omft.near', blockchain: 'eth', contractAddress: null, decimals: 18, symbol: 'ETH' },
  { assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', blockchain: 'eth', contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, symbol: 'USDT' },
  { assetId: 'nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near', blockchain: 'arb', contractAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, symbol: 'USDT' },
  { assetId: 'nep141:btc.omft.near', blockchain: 'btc', contractAddress: null, decimals: 8, symbol: 'BTC' }
]

function futureDeadline () {
  return new Date(Date.now() + 600000).toISOString()
}

function makeQuoteResponse (overrides = {}) {
  return {
    correlationId: 'corr-123',
    timestamp: new Date().toISOString(),
    signature: 'sig-abc',
    quoteRequest: {},
    quote: {
      depositAddress: '0xdeposit',
      depositMemo: undefined,
      amountIn: '1000000',
      amountOut: '999000',
      minAmountIn: '990000',
      maxAmountIn: '1010000',
      minAmountOut: '989000',
      deadline: futureDeadline(),
      timeWhenInactive: futureDeadline(),
      refundFee: '1000',
      timeEstimate: 30,
      ...overrides
    }
  }
}

function createMockAccount (writable = true) {
  const account = {
    getAddress: jest.fn().mockResolvedValue('0xmyaddress')
  }
  if (writable) {
    account.transfer = jest.fn().mockResolvedValue({ hash: '0xtxhash', fee: 5000n })
    account.sendTransaction = jest.fn().mockResolvedValue({ hash: '0xtxhash', fee: 5000n })
    account.quoteTransfer = jest.fn().mockResolvedValue({ fee: 5000n })
    account.quoteSendTransaction = jest.fn().mockResolvedValue({ fee: 5000n })
  }
  return account
}

const mockClientGetTokens = jest.fn().mockResolvedValue(MOCK_TOKENS)
const mockClientGetQuote = jest.fn().mockResolvedValue(makeQuoteResponse())
const mockClientSubmitDepositTx = jest.fn().mockResolvedValue({})
const mockClientGetExecutionStatus = jest.fn().mockResolvedValue({
  status: 'PROCESSING',
  correlationId: 'corr-456',
  updatedAt: new Date().toISOString(),
  swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] }
})

jest.unstable_mockModule('../src/one-click-client.js', () => ({
  default: class MockOneClickClient {
    constructor () {
      this.getTokens = mockClientGetTokens
      this.getQuote = mockClientGetQuote
      this.submitDepositTx = mockClientSubmitDepositTx
      this.getExecutionStatus = mockClientGetExecutionStatus
    }
  }
}))

const { default: OneClickProtocol } = await import('../src/one-click-protocol.js')
const { _clearRegistriesForTesting } = await import('../src/asset-registry.js')

beforeEach(() => {
  _clearRegistriesForTesting()
  mockClientGetTokens.mockClear().mockResolvedValue(MOCK_TOKENS)
  mockClientGetQuote.mockClear().mockResolvedValue(makeQuoteResponse())
  mockClientSubmitDepositTx.mockClear().mockResolvedValue({})
  mockClientGetExecutionStatus.mockClear().mockResolvedValue({
    status: 'PROCESSING',
    correlationId: 'corr-456',
    updatedAt: new Date().toISOString(),
    swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] }
  })
})

const BASE_CONFIG = {
  sourceChain: 'eth',
  jwt: 'test-jwt',
  slippageBps: 100
}

describe('OneClickProtocol', () => {
  describe('constructor', () => {
    it('throws if sourceChain is not provided', () => {
      const account = createMockAccount()
      expect(() => new OneClickProtocol(account, { jwt: 'x' }))
        .toThrow('OneClickProtocol: sourceChain is required')
    })

    it('constructs successfully with valid config', () => {
      const account = createMockAccount()
      expect(() => new OneClickProtocol(account, BASE_CONFIG)).not.toThrow()
    })
  })

  describe('quoteSwap', () => {
    it('builds correct quote request with dry: true', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(mockClientGetQuote).toHaveBeenCalledTimes(1)
      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.dry).toBe(true)
      expect(request.swapType).toBe('EXACT_INPUT')
      expect(request.amount).toBe('1000000')
      expect(typeof request.amount).toBe('string')
      expect(request.slippageTolerance).toBe(100)
      expect(request.depositType).toBe('ORIGIN_CHAIN')
      expect(request.recipientType).toBe('DESTINATION_CHAIN')
      expect(request.refundType).toBe('ORIGIN_CHAIN')
      expect(request.originAsset).toBeDefined()
      expect(request.destinationAsset).toBeDefined()
      expect(request.deadline).toBeDefined()
    })

    it('returns fee: 0n with bigint amounts', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const result = await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(result.fee).toBe(0n)
      expect(typeof result.tokenInAmount).toBe('bigint')
      expect(typeof result.tokenOutAmount).toBe('bigint')
      expect(result.tokenInAmount).toBe(1000000n)
      expect(result.tokenOutAmount).toBe(999000n)
    })

    it('maps EXACT_OUTPUT correctly', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOutAmount: 500000n
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.swapType).toBe('EXACT_OUTPUT')
      expect(request.amount).toBe('500000')
    })

    it('uses destinationChain for cross-chain resolution', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        tokenInAmount: 1000000n,
        destinationChain: 'arb'
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.destinationAsset).toBe('nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near')
    })

    it('uses destinationAsset directly when provided', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xwhatever',
        tokenInAmount: 1000000n,
        destinationAsset: 'nep141:custom-asset.near'
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.destinationAsset).toBe('nep141:custom-asset.near')
    })

    it('uses account address as recipient when to is not set', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.recipient).toBe('0xmyaddress')
      expect(request.refundTo).toBe('0xmyaddress')
    })

    it('uses options.to as recipient when provided', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n,
        to: '0xrecipient'
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.recipient).toBe('0xrecipient')
      expect(request.refundTo).toBe('0xmyaddress')
    })
  })

  describe('swap', () => {
    it('throws if account is read-only', async () => {
      const account = createMockAccount(false)
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('requires a non-read-only account')
    })

    it('throws if JWT is not configured', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, { sourceChain: 'eth' })

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('jwt is required for swap()')
    })

    it('throws if neither tokenInAmount nor tokenOutAmount is provided', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
      })).rejects.toThrow('either tokenInAmount or tokenOutAmount must be provided')
    })

    it('throws if depositAddress is missing from quote response', async () => {
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({ depositAddress: undefined }))
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('missing depositAddress')
    })

    it('throws if depositMemo is present (memo guard)', async () => {
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({ depositMemo: 'stellar-memo' }))
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('memo-based deposits are not yet supported')
    })

    it('throws if deadline is missing from quote response', async () => {
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({ deadline: undefined }))
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('missing deadline')
    })

    it('throws if deadline has already passed', async () => {
      const pastDeadline = new Date(Date.now() - 1000).toISOString()
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({ deadline: pastDeadline }))
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('quote expired before deposit')
    })

    it('uses transfer() for token deposits', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(account.transfer).toHaveBeenCalledWith({
        token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        recipient: '0xdeposit',
        amount: 1000000n
      })
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    it('uses sendTransaction() for native asset deposits', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: 'native',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000000000000000n
      })

      // Deposit amount comes from quoteResponse.quote.amountIn, not the user's tokenInAmount
      expect(account.sendTransaction).toHaveBeenCalledWith({
        to: '0xdeposit',
        value: 1000000n
      })
      expect(account.transfer).not.toHaveBeenCalled()
    })

    it('passes depositTxOptions through to sendTransaction for native deposits', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, {
        ...BASE_CONFIG,
        sourceChain: 'btc',
        depositTxOptions: { feeRate: 25, confirmationTarget: 3 }
      })

      // Need BTC tokens in the mock
      mockClientGetTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:btc.omft.near', blockchain: 'btc', contractAddress: null, decimals: 8, symbol: 'BTC' }
      ])
      _clearRegistriesForTesting()

      await protocol.swap({
        tokenIn: 'native',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 100000n,
        destinationChain: 'eth'
      })

      expect(account.sendTransaction).toHaveBeenCalledWith({
        to: '0xdeposit',
        value: 1000000n,
        feeRate: 25,
        confirmationTarget: 3
      })
    })

    it('calls quote → deposit → submit in sequence', async () => {
      const callOrder = []
      mockClientGetQuote.mockImplementation(async () => {
        callOrder.push('quote')
        return makeQuoteResponse()
      })
      mockClientSubmitDepositTx.mockImplementation(async () => {
        callOrder.push('submit')
        return {}
      })

      const account = createMockAccount()
      account.transfer.mockImplementation(async () => {
        callOrder.push('deposit')
        return { hash: '0xtxhash', fee: 5000n }
      })

      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(callOrder).toEqual(['quote', 'deposit', 'submit'])
    })

    it('does not throw if submitDepositTx fails (best-effort)', async () => {
      mockClientSubmitDepositTx.mockRejectedValue(new Error('submit failed'))
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const result = await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(result.hash).toBe('0xtxhash')
    })

    it('throws if swapMaxFee is exceeded (uses >=)', async () => {
      const account = createMockAccount()
      account.quoteTransfer.mockResolvedValue({ fee: 5000n })
      const protocol = new OneClickProtocol(account, { ...BASE_CONFIG, swapMaxFee: 5000n })

      await expect(protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })).rejects.toThrow('exceeded maximum fee')
    })

    it('does not throw if fee is below swapMaxFee', async () => {
      const account = createMockAccount()
      account.quoteTransfer.mockResolvedValue({ fee: 4999n })
      const protocol = new OneClickProtocol(account, { ...BASE_CONFIG, swapMaxFee: 5000n })

      const result = await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(result.hash).toBe('0xtxhash')
    })

    it('returns OneClickSwapResult with all fields', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const result = await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(result.hash).toBe('0xtxhash')
      expect(result.fee).toBe(0n)
      expect(result.tokenInAmount).toBe(1000000n)
      expect(result.tokenOutAmount).toBe(999000n)
      expect(result.depositAddress).toBe('0xdeposit')
      expect(result.depositMemo).toBeUndefined()
      expect(result.correlationId).toBe('corr-123')
      expect(result.quoteSignature).toBe('sig-abc')
      expect(result.quoteResponse).toBeDefined()
      expect(result.quoteResponse.signature).toBe('sig-abc')
    })

    it('sends dry: false in the quote request', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.dry).toBe(false)
    })

    it('includes nearSenderAccount in submit when sourceChain is near', async () => {
      mockClientGetTokens.mockResolvedValue([
        ...MOCK_TOKENS,
        { assetId: 'nep141:wrap.near', blockchain: 'near', contractAddress: null, decimals: 24, symbol: 'NEAR' }
      ])
      _clearRegistriesForTesting()

      const account = createMockAccount()
      account.getAddress.mockResolvedValue('alice.near')
      const protocol = new OneClickProtocol(account, { ...BASE_CONFIG, sourceChain: 'near' })

      await protocol.swap({
        tokenIn: 'native',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n,
        destinationChain: 'eth'
      })

      const submitBody = mockClientSubmitDepositTx.mock.calls[0][0]
      expect(submitBody.nearSenderAccount).toBe('alice.near')
    })

    it('forwards options.to as recipient in quote request', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n,
        to: '0xrecipient-on-dest'
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.recipient).toBe('0xrecipient-on-dest')
      expect(request.refundTo).toBe('0xmyaddress')
    })

    it('includes appFees in quote request when configured', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, {
        ...BASE_CONFIG,
        appFees: [{ recipient: '0xfee', fee: 50 }]
      })

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.appFees).toEqual([{ recipient: '0xfee', fee: 50 }])
    })

    it('deposits amountIn from quote response (not tokenOutAmount) for EXACT_OUTPUT', async () => {
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({ amountIn: '2000000', amountOut: '500000' }))

      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOutAmount: 500000n
      })

      expect(account.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2000000n })
      )
    })

    it('preserves full precision for 18-decimal token amounts', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const largeAmount = 10000000000000000000000n // 10,000 ETH in wei

      await protocol.quoteSwap({
        tokenIn: 'native',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: largeAmount
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.amount).toBe('10000000000000000000000')
      expect(typeof request.amount).toBe('string')
    })

    it('accepts number tokenInAmount and converts correctly', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000
      })

      const request = mockClientGetQuote.mock.calls[0][0]
      expect(request.amount).toBe('1000000')
    })

    it('does not guard against depositAmount < refundFee (known gap)', async () => {
      // amountIn is 500, refundFee is 1000 — user would lose all funds on refund
      mockClientGetQuote.mockResolvedValue(makeQuoteResponse({
        amountIn: '500',
        refundFee: '1000'
      }))

      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      // Documents current behavior: swap completes even when refund would cost more than deposit
      const result = await protocol.swap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 500n
      })
      expect(result.hash).toBeDefined()
    })

    it('quoteSwap works without JWT configured', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, { sourceChain: 'eth' })

      const result = await protocol.quoteSwap({
        tokenIn: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        tokenInAmount: 1000000n
      })

      expect(result.fee).toBe(0n)
      expect(result.tokenInAmount).toBe(1000000n)
    })
  })

  describe('getSwapStatus', () => {
    it.each([
      ['SUCCESS', true],
      ['REFUNDED', true],
      ['FAILED', true],
      ['PENDING_DEPOSIT', false],
      ['KNOWN_DEPOSIT_TX', false],
      ['PROCESSING', false],
      ['INCOMPLETE_DEPOSIT', false]
    ])('marks %s as terminal: %s', async (status, expectedTerminal) => {
      mockClientGetExecutionStatus.mockResolvedValue({
        status,
        correlationId: 'c',
        updatedAt: '2026-01-01T00:00:00Z',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] }
      })
      const protocol = new OneClickProtocol(createMockAccount(), BASE_CONFIG)
      const result = await protocol.getSwapStatus('0xdeposit')
      expect(result.terminal).toBe(expectedTerminal)
    })

    it('returns status with terminal flag', async () => {
      mockClientGetExecutionStatus.mockResolvedValue({
        status: 'SUCCESS',
        correlationId: 'corr-789',
        updatedAt: '2026-01-01T00:00:00Z',
        swapDetails: { originChainTxHashes: [{ hash: '0x1', explorerUrl: 'https://...' }], destinationChainTxHashes: [] }
      })

      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const result = await protocol.getSwapStatus('0xdeposit')

      expect(result.status).toBe('SUCCESS')
      expect(result.terminal).toBe(true)
      expect(result.correlationId).toBe('corr-789')
    })

    it('returns terminal: false for non-terminal statuses', async () => {
      mockClientGetExecutionStatus.mockResolvedValue({
        status: 'PROCESSING',
        correlationId: 'c',
        updatedAt: '2026-01-01T00:00:00Z',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] }
      })

      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const result = await protocol.getSwapStatus('0xdeposit')

      expect(result.terminal).toBe(false)
    })

    it('passes depositMemo to client when provided', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      await protocol.getSwapStatus('0xdeposit', 'memo-val')

      expect(mockClientGetExecutionStatus).toHaveBeenCalledWith('0xdeposit', 'memo-val')
    })
  })

  describe('getSupportedTokens', () => {
    it('returns token list from client', async () => {
      const account = createMockAccount()
      const protocol = new OneClickProtocol(account, BASE_CONFIG)

      const tokens = await protocol.getSupportedTokens()

      expect(tokens).toEqual(MOCK_TOKENS)
    })
  })
})
