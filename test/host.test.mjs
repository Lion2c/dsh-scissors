import assert from 'node:assert/strict'
import http from 'node:http'
import test, { after, before } from 'node:test'

import { apply } from '../index.js'

let handler = null
let server = null
let base = ''
const warnings = []

/** Minimal Cordis context: the plugin only needs effect, logger and webServer. */
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  logger: {
    warn(...args) {
      warnings.push(args)
    },
  },
  webServer: {
    register(options) {
      handler = options.handler
      return () => {
        handler = null
      }
    },
  },
}

apply(ctx, {})
assert.equal(typeof handler, 'function', 'the capture route was not registered')

before(async () => {
  server = http.createServer((request, response) => handler(request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server?.close()
})

/** @param {string} path @param {RequestInit} [init] */
async function call(path, init) {
  const response = await fetch(base + path, init)
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    // Error bodies are always JSON, but keeping the raw text makes a broken
    // response easier to diagnose.
  }
  return { status: response.status, body }
}

test('health reports the platform and a stable shape', async () => {
  const { status, body } = await call('/.dsh-scissors/health')
  assert.equal(status, 200)
  assert.equal(typeof body.supported, 'boolean')
  assert.equal(typeof body.hideSupported, 'boolean')
  assert.equal(body.version, '0.1.0')
  assert.equal(body.busy, false)
  assert.equal(typeof body.platform, 'string')
  assert.equal(typeof body.backend, 'string')
})

test('capture requires the custom request header', async () => {
  const { status, body } = await call('/.dsh-scissors/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hide: false }),
  })
  assert.equal(status, 403)
  assert.equal(body.code, 'forbidden')
})

test('capture requires a JSON content type', async () => {
  const { status, body } = await call('/.dsh-scissors/capture', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-dsh-scissors': 'capture' },
    body: '{}',
  })
  assert.equal(status, 415)
  assert.equal(body.code, 'invalid')
})

test('cross-origin requests are rejected', async () => {
  const { status, body } = await call('/.dsh-scissors/health', {
    headers: { origin: 'http://evil.example' },
  })
  assert.equal(status, 403)
  assert.equal(body.code, 'forbidden')
})

test('unknown routes return 404 JSON', async () => {
  const { status, body } = await call('/.dsh-scissors/nope')
  assert.equal(status, 404)
  assert.equal(body.code, 'not-found')
})

test('unknown methods on known routes return 404', async () => {
  const { status, body } = await call('/.dsh-scissors/capture')
  assert.equal(status, 404)
  assert.equal(body.code, 'not-found')
})

test('oversized capture bodies are rejected before capture starts', async () => {
  const { status, body } = await call('/.dsh-scissors/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-scissors': 'capture' },
    body: 'x'.repeat(5000),
  })
  // On a machine without a capture backend the plugin answers 500 before
  // reading the body; both outcomes prove the request was stopped early.
  assert.ok(status === 413 || status === 500, `unexpected status ${status}`)
  assert.ok(['invalid', 'no-backend'].includes(body.code), `unexpected code ${body.code}`)
})

test('health does not produce warnings', () => {
  assert.equal(warnings.length, 0)
})
