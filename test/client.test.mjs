import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const React = require('react')

let definition = null
const appended = []

function element(tagName) {
  return {
    tagName,
    dataset: {},
    style: {},
    children: [],
    textContent: '',
    setAttribute() {},
    appendChild(child) {
      this.children.push(child)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    contains() {
      return false
    },
    focus() {},
    getBoundingClientRect() {
      return { left: 10, top: 10, right: 38, bottom: 38, width: 28, height: 28 }
    },
  }
}

globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  requestAnimationFrame(fn) {
    fn()
  },
  setTimeout,
  clearTimeout,
}

globalThis.document = {
  head: {
    appendChild(value) {
      appended.push(value)
    },
  },
  body: {
    appendChild() {},
  },
  createElement: element,
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null
  },
}

globalThis.File = class File {}
globalThis.AbortController = class AbortController {
  constructor() {
    this.signal = {}
  }
  abort() {}
}
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ supported: true, hideSupported: true }),
})

await import('../client.js')

test('the bundle registers itself with the expected id', () => {
  assert.ok(definition !== null, 'client bundle was not registered')
  assert.equal(definition.id, 'dsh-scissors')
  assert.equal(typeof definition.factory, 'function')
})

const plugin = definition.factory((id) => (id === 'react' ? React : require(id)))

test('the plugin injects the required services', () => {
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

let registration = null
let localeRegistration = null
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: {
    register(namespace, dictionary) {
      localeRegistration = { namespace, locales: Object.keys(dictionary) }
    },
    bind(namespace) {
      return (key) => `${namespace}:${key}`
    },
  },
  inject(names, callback) {
    if (names.includes('conversation')) {
      callback({
        get() {
          return {
            createDrafts() {
              return []
            },
            releaseDraftAttachments() {},
          }
        },
      })
    }
  },
  slots: {
    inject(name, callback) {
      if (name !== 'conversation.input.left') throw new Error(`unexpected slot: ${name}`)
      callback()
    },
    register(options, factory) {
      registration = { options, factory }
    },
  },
}

test('apply registers the locale and the composer-left slot', () => {
  plugin.apply(ctx)
  assert.deepEqual(localeRegistration, { namespace: 'dsh-scissors', locales: ['en', 'zh'] })
  assert.ok(registration !== null, 'slot was not registered')
  assert.equal(registration.options.name, 'conversation.input.left')
  assert.equal(registration.options.id, 'dsh-scissors')
  assert.equal(registration.options.order, 100)
})

test('the slot renders an accessible scissors button', () => {
  const tree = registration.factory({
    sessionId: 'ses_test',
    inputActions: { addAttachments: () => true },
  })
  const html = renderToStaticMarkup(tree)
  assert.match(html, /class="dsh-scissors-button"/)
  assert.match(html, /aria-label="dsh-scissors:button.label"/)
  assert.match(html, /aria-haspopup="menu"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /<circle/)
  assert.match(html, /<path/)
  assert.ok(html.length > 500)
})

test('a style element was installed', () => {
  assert.equal(appended.length, 1)
  assert.match(appended[0].textContent, /\.dsh-scissors-button/)
  assert.match(appended[0].textContent, /\.dsh-scissors-menu/)
})
