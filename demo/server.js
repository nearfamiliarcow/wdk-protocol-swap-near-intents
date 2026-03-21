import { createServer } from 'http'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

// WDK wallets
import { WalletAccountBtc } from '@tetherto/wdk-wallet-btc'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

// Our 1Click protocol + pay helper
import OneClickProtocol from '../src/one-click-protocol.js'
import OneClickPay from '../src/one-click-pay.js'

// --- Logging ---

function log (tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}]`, ...args)
}

function logRequest (path, body) {
  log('REQ', path, JSON.stringify(body, bigIntReplacer))
}

function logResponse (path, result) {
  const str = JSON.stringify(result, bigIntReplacer)
  // Truncate very long responses (token lists)
  const display = str.length > 500 ? str.slice(0, 500) + `... (${str.length} chars)` : str
  log('RES', path, display)
}

function logError (path, err) {
  log('ERR', path, err.message)
  if (err.stack) {
    const lines = err.stack.split('\n').slice(1, 4).map(l => l.trim()).join(' <- ')
    log('ERR', 'stack:', lines)
  }
}

// --- Helpers ---

function bigIntReplacer (key, value) {
  return typeof value === 'bigint' ? value.toString() : value
}

function toBaseUnits (amount, decimals) {
  const str = String(amount)
  const [intPart, fracPart = ''] = str.split('.')
  const padded = fracPart.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(intPart) * (10n ** BigInt(decimals)) + BigInt(padded)
}

const SEED = process.env.WALLET_SEED
const JWT = process.env.ONECLICK_JWT

if (!SEED) throw new Error('WALLET_SEED not set in .env')
if (!JWT) throw new Error('ONECLICK_JWT not set in .env')

// --- Wallet setup ---

log('INIT', 'Initializing wallets...')

// BTC wallet
const btcAccount = new WalletAccountBtc(SEED, "0'/0/0", {
  host: 'api.ordimint.com',
  port: 50001
})

const btcProtocol = new OneClickProtocol(btcAccount, {
  sourceChain: 'btc',
  jwt: JWT,
  quoteWaitingTimeMs: 3000
})

const btcPay = new OneClickPay(btcProtocol, {
  slippageBps: 200,
  quoteWaitingTimeMs: 3000,
  acceptedSymbols: 'all'
})

// ETH wallet
const ethAccount = new WalletAccountEvm(SEED, "0'/0/0", {
  provider: 'https://eth.merkle.io'
})

const ethProtocol = new OneClickProtocol(ethAccount, {
  sourceChain: 'eth',
  jwt: JWT,
  quoteWaitingTimeMs: 3000
})

const ethPay = new OneClickPay(ethProtocol, {
  slippageBps: 200,
  quoteWaitingTimeMs: 3000,
  acceptedSymbols: 'all'
})

const wallets = {
  btc: {
    account: btcAccount,
    protocol: btcProtocol,
    pay: btcPay,
    symbol: 'BTC',
    decimals: 8,
    chain: 'btc'
  },
  eth: {
    account: ethAccount,
    protocol: ethProtocol,
    pay: ethPay,
    symbol: 'ETH',
    decimals: 18,
    chain: 'eth'
  }
}

log('INIT', 'BTC address:', await btcAccount.getAddress())
log('INIT', 'ETH address:', await ethAccount.getAddress())

// --- API routes ---

function getWallet (body) {
  const source = body.source || 'btc'
  const w = wallets[source]
  if (!w) throw new Error(`Unknown source wallet: ${source}`)
  return w
}

async function handleAPI (path, body) {
  if (path === '/api/wallets') {
    const results = []
    for (const [key, w] of Object.entries(wallets)) {
      const address = await w.account.getAddress()
      let balance = 0n
      try {
        balance = await w.account.getBalance()
        log('WALLET', `${key} balance: ${balance} (${(Number(balance) / (10 ** w.decimals)).toFixed(8)} ${w.symbol})`)
      } catch (err) {
        log('WALLET', `${key} balance error: ${err.message}`)
      }
      results.push({
        key,
        address,
        balance: balance.toString(),
        balanceFormatted: (Number(balance) / (10 ** w.decimals)).toFixed(key === 'btc' ? 8 : 6),
        chain: w.chain,
        symbol: w.symbol
      })
    }
    return { wallets: results }
  }

  if (path === '/api/supported-chains') {
    const w = getWallet(body)
    log('CHAINS', `fetching for source: ${body.source}`)
    const chains = await w.pay.getSupportedPaymentChains()
    log('CHAINS', `${chains.length} chains:`, chains.join(', '))
    return { chains }
  }

  if (path === '/api/quote') {
    const w = getWallet(body)
    const params = {
      tokenIn: body.tokenIn || 'native',
      amount: body.amount,
      recipientAddress: body.recipientAddress,
      recipientChain: body.recipientChain
    }
    log('PAY-QUOTE', `${w.symbol} -> $${body.amount} USDT on ${body.recipientChain}`)
    log('PAY-QUOTE', 'params:', JSON.stringify(params))
    const quote = await w.pay.quotePay(params)
    log('PAY-QUOTE', 'result:', JSON.stringify(quote, bigIntReplacer))
    return quote
  }

  if (path === '/api/pay') {
    const w = getWallet(body)
    const params = {
      tokenIn: body.tokenIn || 'native',
      amount: body.amount,
      recipientAddress: body.recipientAddress,
      recipientChain: body.recipientChain
    }
    log('PAY-EXEC', `EXECUTING: ${w.symbol} -> $${body.amount} USDT on ${body.recipientChain}`)
    log('PAY-EXEC', 'params:', JSON.stringify(params))
    const result = await w.pay.pay(params)
    log('PAY-EXEC', 'hash:', result.hash)
    log('PAY-EXEC', 'depositAddress:', result.depositAddress)
    log('PAY-EXEC', 'amountPaid:', result.amountPaid.toString(), w.symbol)
    log('PAY-EXEC', 'amountReceived:', result.amountReceived, 'USDT')
    log('PAY-EXEC', 'correlationId:', result.correlationId)
    log('PAY-EXEC', 'full quoteResponse:', JSON.stringify(result.quoteResponse, bigIntReplacer))
    return {
      hash: result.hash,
      depositAddress: result.depositAddress,
      amountPaid: result.amountPaid.toString(),
      amountReceived: result.amountReceived,
      recipientChain: result.recipientChain,
      recipientAddress: result.recipientAddress,
      correlationId: result.correlationId
    }
  }

  if (path === '/api/status') {
    const w = getWallet(body)
    log('PAY-STATUS', `polling: ${body.depositAddress}`)
    const status = await w.pay.getPaymentStatus(body.depositAddress)
    log('PAY-STATUS', `status: ${status.status} (terminal: ${status.terminal})`)
    if (status.swapDetails) {
      log('PAY-STATUS', 'swapDetails:', JSON.stringify(status.swapDetails, bigIntReplacer))
    }
    return status
  }

  if (path === '/api/swap-quote') {
    const w = getWallet(body)
    const destWallet = wallets[body.destWallet]
    if (!destWallet) throw new Error(`Unknown destination wallet: ${body.destWallet}`)

    const destAddress = await destWallet.account.getAddress()
    const tokenInSats = toBaseUnits(body.amount, w.decimals)

    log('SWAP-QUOTE', `${body.amount} ${w.symbol} -> ${destWallet.symbol}`)
    log('SWAP-QUOTE', `tokenInSats: ${tokenInSats}, destChain: ${destWallet.chain}, destAddr: ${destAddress}`)

    const quote = await w.protocol.quoteSwap({
      tokenIn: 'native',
      tokenOut: 'native',
      tokenInAmount: tokenInSats,
      destinationChain: destWallet.chain,
      to: destAddress
    })

    log('SWAP-QUOTE', `in: ${quote.tokenInAmount} ${w.symbol}, out: ${quote.tokenOutAmount} ${destWallet.symbol}, time: ${quote.timeEstimate}s`)

    return {
      tokenInAmount: quote.tokenInAmount.toString(),
      tokenOutAmount: quote.tokenOutAmount.toString(),
      tokenInFormatted: (Number(quote.tokenInAmount) / (10 ** w.decimals)).toFixed(w.decimals > 8 ? 6 : 8) + ' ' + w.symbol,
      tokenOutFormatted: (Number(quote.tokenOutAmount) / (10 ** destWallet.decimals)).toFixed(destWallet.decimals > 8 ? 6 : 8) + ' ' + destWallet.symbol,
      timeEstimate: quote.timeEstimate
    }
  }

  if (path === '/api/swap-execute') {
    const w = getWallet(body)
    const destWallet = wallets[body.destWallet]
    if (!destWallet) throw new Error(`Unknown destination wallet: ${body.destWallet}`)

    const destAddress = await destWallet.account.getAddress()
    const tokenInSats = toBaseUnits(body.amount, w.decimals)

    log('SWAP-EXEC', `EXECUTING: ${body.amount} ${w.symbol} -> ${destWallet.symbol}`)
    log('SWAP-EXEC', `tokenInSats: ${tokenInSats}, destChain: ${destWallet.chain}, destAddr: ${destAddress}`)

    const result = await w.protocol.swap({
      tokenIn: 'native',
      tokenOut: 'native',
      tokenInAmount: tokenInSats,
      destinationChain: destWallet.chain,
      to: destAddress
    })

    log('SWAP-EXEC', 'hash:', result.hash)
    log('SWAP-EXEC', 'depositAddress:', result.depositAddress)
    log('SWAP-EXEC', 'tokenInAmount:', result.tokenInAmount.toString(), w.symbol)
    log('SWAP-EXEC', 'tokenOutAmount:', result.tokenOutAmount.toString(), destWallet.symbol)
    log('SWAP-EXEC', 'correlationId:', result.correlationId)
    log('SWAP-EXEC', 'quoteSignature:', result.quoteSignature)
    log('SWAP-EXEC', 'full quoteResponse:', JSON.stringify(result.quoteResponse, bigIntReplacer))

    return {
      hash: result.hash,
      depositAddress: result.depositAddress,
      tokenInAmount: result.tokenInAmount.toString(),
      tokenOutAmount: result.tokenOutAmount.toString(),
      correlationId: result.correlationId
    }
  }

  if (path === '/api/swap-status') {
    const w = getWallet(body)
    log('SWAP-STATUS', `polling: ${body.depositAddress}`)
    const status = await w.protocol.getSwapStatus(body.depositAddress)
    log('SWAP-STATUS', `status: ${status.status} (terminal: ${status.terminal})`)
    if (status.swapDetails) {
      log('SWAP-STATUS', 'swapDetails:', JSON.stringify(status.swapDetails, bigIntReplacer))
    }
    return status
  }

  throw new Error(`Unknown API path: ${path}`)
}

// --- HTTP server ---

const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8')

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
    return
  }

  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = body ? JSON.parse(body) : {}

    logRequest(req.url, parsed)

    try {
      const result = await handleAPI(req.url, parsed)
      logResponse(req.url, result)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result, bigIntReplacer))
    } catch (err) {
      logError(req.url, err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    }
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const PORT = 3000
server.listen(PORT, () => {
  log('INIT', `Demo running at http://localhost:${PORT}`)
  log('INIT', `JWT: ${JWT.slice(0, 20)}...${JWT.slice(-10)}`)
  log('INIT', 'Wallets:')
  for (const [key, w] of Object.entries(wallets)) {
    log('INIT', `  ${key}: ${w.symbol} on ${w.chain}`)
  }
})
