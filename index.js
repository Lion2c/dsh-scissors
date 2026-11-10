/**
 * Host half of dsh-scissors.
 *
 * One same-origin route prefix, `/.dsh-scissors`:
 *
 *   GET  /health   platform / backend probe used by the composer button
 *   POST /capture  runs the native region selector and answers with the PNG
 *                  as base64. Body `{ "hide": true }` hides the main window
 *                  before the capture and restores it afterwards, on every
 *                  exit path (success, cancel, error, timeout).
 *
 * Windows uses a tiny WinForms selector compiled from native/win/selector.cs
 * (or the prebuilt scissors.exe beside it). macOS uses the system
 * `screencapture -i`. Linux tries grim+slurp, gnome-screenshot, spectacle,
 * scrot and maim in that order, and hides the active window through xdotool
 * when the session is X11.
 *
 * @module dsh-scissors
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-scissors'

/** The route is only useful while the web server exists. */
export const inject = ['webServer']

const PREFIX = '/.dsh-scissors'
const VERSION = '0.1.0'

/** One native overlay at a time; the OS selector is effectively modal. */
let active = null

const DEFAULT_TIMEOUT_MS = 180_000
const COMPILE_TIMEOUT_MS = 120_000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_BODY_BYTES = 4 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
/** A hidden window needs a beat before the desktop is frozen. */
const HIDE_SETTLE_MS = 350

const here = dirname(fileURLToPath(import.meta.url))

/** @param {unknown} error */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** @param {number} status @param {string} code @param {string} message @param {string} [detail] */
function httpError(status, code, message, detail) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} value */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Refuse a browser request that did not originate from this same Web origin. */
function assertSameOrigin(req) {
  const origin = req.headers.origin
  if (origin !== undefined) {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      throw httpError(403, 'forbidden', 'Cross-origin request rejected.')
    }
    if (parsed.host !== req.headers.host) {
      throw httpError(403, 'forbidden', 'Cross-origin request rejected.')
    }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw httpError(403, 'forbidden', 'Cross-origin request rejected.')
  }
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw httpError(413, 'invalid', 'Request body is too large.')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'invalid', 'Request body must be JSON.')
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timestampName() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `dsh-scissors-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
  )
}

/** Read the width/height out of a PNG IHDR chunk (no dependency needed). */
function pngSize(buffer) {
  if (buffer.length < 24) return {}
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return {}
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * Run a process and resolve with its outcome; never throws for a non-zero exit.
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, error?: Error }>}
 */
function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0
  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: '', timedOut: false, error })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            try {
              child.kill('SIGKILL')
            } catch {
              // Already gone.
            }
          }, timeoutMs)
        : null

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString()
    })
    child.once('error', (error) => {
      if (timer !== null) clearTimeout(timer)
      resolve({ code: -1, stdout, stderr, timedOut, error })
    })
    child.once('close', (code) => {
      if (timer !== null) clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

/** @param {string} path */
async function readText(path) {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** @param {string} command */
function findOnPath(command) {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? command : null
  }
  const path = process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, command + extension)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // A malformed PATH entry is not fatal.
      }
    }
  }
  return null
}

/** The .NET Framework compiler that ships with Windows. */
function cscPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  for (const architecture of ['Framework64', 'Framework']) {
    const candidate = join(root, 'Microsoft.NET', architecture, 'v4.0.30319', 'csc.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function bundledWindowsSelector() {
  const candidate = join(here, 'native', 'win', 'scissors.exe')
  return existsSync(candidate) ? candidate : null
}

/** @type {Promise<{ path: string, source: string }> | null} */
let compilingSelector = null

/**
 * Return a runnable Windows selector: the prebuilt exe when packaged, else a
 * cached build of selector.cs. Compilation happens once per source revision.
 * @returns {Promise<{ path: string, source: string }>}
 */
function ensureWindowsSelector() {
  const bundled = bundledWindowsSelector()
  if (bundled !== null) return Promise.resolve({ path: bundled, source: 'bundled' })

  if (compilingSelector !== null) return compilingSelector

  compilingSelector = (async () => {
    const sourcePath = join(here, 'native', 'win', 'selector.cs')
    if (!existsSync(sourcePath)) {
      throw httpError(500, 'no-backend', 'The Windows selector source is missing.')
    }
    const compiler = cscPath()
    if (compiler === null) {
      throw httpError(
        500,
        'no-backend',
        'No prebuilt selector and no .NET Framework compiler were found.',
      )
    }

    const source = await fs.readFile(sourcePath)
    const hash = createHash('sha256').update(source).update(VERSION).digest('hex').slice(0, 16)
    const directory = join(tmpdir(), 'dsh-scissors')
    const output = join(directory, `selector-${hash}.exe`)
    if (existsSync(output)) return { path: output, source: 'cache' }

    await fs.mkdir(directory, { recursive: true })
    const result = await runProcess(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/optimize',
        `/out:${output}`,
        '/r:System.Windows.Forms.dll',
        '/r:System.Drawing.dll',
        sourcePath,
      ],
      { timeoutMs: COMPILE_TIMEOUT_MS },
    )
    if (result.code !== 0 || !existsSync(output)) {
      const detail = result.stderr.trim() || result.error?.message || `csc exited with ${result.code}`
      throw httpError(500, 'no-backend', 'The Windows selector could not be compiled.', detail)
    }
    return { path: output, source: 'compiled' }
  })().finally(() => {
    compilingSelector = null
  })

  return compilingSelector
}

/**
 * Restore a window that a killed selector had hidden (recovery path only).
 * @param {string} target
 */
async function restoreWindowsWindow(target) {
  const raw = (await readText(`${target}.hwnd`)).trim()
  const handle = Number.parseInt(raw, 10)
  if (!Number.isFinite(handle) || handle <= 0) return
  try {
    const selector = await ensureWindowsSelector()
    await runProcess(selector.path, ['--restore', String(handle)], { timeoutMs: 10_000 })
  } catch {
    // Best effort: the user can still bring the window back from the taskbar.
  }
}

/** @param {{ hide: boolean, timeoutMs: number }} options */
async function captureWindows({ hide, timeoutMs }) {
  const selector = await ensureWindowsSelector()
  const target = join(
    tmpdir(),
    `dsh-scissors-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.png`,
  )
  const args = [target]
  if (hide) args.push('--hide')

  let result
  let errorFile = ''
  try {
    result = await runProcess(selector.path, args, { timeoutMs })
    if (result.timedOut) {
      await restoreWindowsWindow(target)
      throw httpError(504, 'timeout', 'The screen capture timed out. Try again.')
    }
    if (result.code === 2) return { cancelled: true }

    errorFile = await readText(`${target}.err`)
    if (result.code !== 0) {
      // The selector restores in its own finally; this is the safety net for a
      // hard crash that skipped it and left the sidecar behind.
      await restoreWindowsWindow(target)
      const detail =
        errorFile.trim().split(/\r?\n/)[0] || result.stderr.trim() || `selector exited with ${result.code}`
      throw httpError(500, 'failed', 'The region selector failed.', detail)
    }

    let bytes
    try {
      bytes = await fs.readFile(target)
    } catch {
      return { cancelled: true }
    }
    if (bytes.length === 0) return { cancelled: true }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw httpError(413, 'too-large', 'The captured image is too large.')
    }

    const size = pngSize(bytes)
    return {
      image: bytes.toString('base64'),
      mime: 'image/png',
      name: timestampName(),
      bytes: bytes.length,
      hidden: hide,
      ...size,
    }
  } finally {
    await Promise.all([
      fs.rm(target, { force: true }).catch(() => {}),
      fs.rm(`${target}.err`, { force: true }).catch(() => {}),
      fs.rm(`${target}.hwnd`, { force: true }).catch(() => {}),
    ])
  }
}

/** Apps that must never be hidden even when they are frontmost. */
const MAC_DENY = new Set([
  'Dock',
  'Finder',
  'Window Server',
  'System Events',
  'System Settings',
  'System Preferences',
  'loginwindow',
  'Spotlight',
  'Control Center',
  'NotificationCenter',
])

/** @param {string} value */
function appleQuoted(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** @param {string} stderr */
function macAutomationError(stderr) {
  if (/(-1743|Not authorized|not authorized)/.test(stderr)) {
    return httpError(
      403,
      'hide-permission',
      'Automation permission is required to hide the window.',
      'Allow this app to control "System Events" in System Settings > Privacy & Security > Automation, then retry.',
    )
  }
  return httpError(500, 'failed', 'Could not control System Events.', stderr.trim().slice(0, 300))
}

async function macFrontmostApp() {
  const result = await runProcess(
    'osascript',
    ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
    { timeoutMs: 60_000 },
  )
  const app = result.stdout.trim()
  if (result.code !== 0 || app === '') throw macAutomationError(result.stderr)
  if (MAC_DENY.has(app)) {
    throw httpError(409, 'hide-denied', `Refusing to hide the frontmost system app "${app}".`)
  }
  return app
}

/** @param {string} app @param {boolean} visible @param {boolean} [front] */
async function macSetAppVisible(app, visible, front = false) {
  const quoted = appleQuoted(app)
  const script =
    visible && front
      ? `tell application "System Events"\nset visible of process ${quoted} to true\nset frontmost of process ${quoted} to true\nend tell`
      : `tell application "System Events" to set visible of process ${quoted} to ${visible}`
  const result = await runProcess('osascript', ['-e', script], { timeoutMs: 60_000 })
  if (result.code !== 0) throw macAutomationError(result.stderr)
}

/** @param {{ hide: boolean, timeoutMs: number }} options */
async function captureMac({ hide, timeoutMs }) {
  const tool = existsSync('/usr/sbin/screencapture')
    ? '/usr/sbin/screencapture'
    : findOnPath('screencapture')
  if (tool === null) {
    throw httpError(500, 'no-backend', 'screencapture was not found on this macOS system.')
  }

  const file = join(
    tmpdir(),
    `dsh-scissors-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.png`,
  )

  /** @type {string | null} */
  let hiddenApp = null
  try {
    if (hide) {
      hiddenApp = await macFrontmostApp()
      await macSetAppVisible(hiddenApp, false)
      await delay(HIDE_SETTLE_MS)
    }

    const result = await runProcess(tool, ['-i', '-x', '-o', '-t', 'png', file], { timeoutMs })
    if (result.timedOut) {
      throw httpError(504, 'timeout', 'The screen capture timed out. Try again.')
    }

    let bytes
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size === 0) return { cancelled: true }
      bytes = await fs.readFile(file)
    } catch {
      if (/could not create image|not authorized|Screen Recording|permission/i.test(result.stderr)) {
        throw httpError(
          403,
          'permission',
          'Screen Recording permission is required.',
          'Allow this app in System Settings > Privacy & Security > Screen Recording, then restart it.',
        )
      }
      return { cancelled: true }
    }

    if (bytes.length > MAX_IMAGE_BYTES) {
      throw httpError(413, 'too-large', 'The captured image is too large.')
    }
    return {
      image: bytes.toString('base64'),
      mime: 'image/png',
      name: timestampName(),
      bytes: bytes.length,
      hidden: hide && hiddenApp !== null,
      ...pngSize(bytes),
    }
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
    // Whatever happened - capture, cancel, timeout, or a thrown error - a
    // hidden window always comes back to the front.
    if (hiddenApp !== null) {
      try {
        await macSetAppVisible(hiddenApp, true, true)
      } catch {
        // The app is gone or System Events refused; the user can re-focus it.
      }
    }
  }
}

/** Linux capture backends, in preference order. */
function linuxBackends() {
  const backends = []
  const grim = findOnPath('grim')
  const slurp = findOnPath('slurp')
  if (grim !== null && slurp !== null) {
    backends.push({ id: 'grim', command: grim, slurp })
  }
  const gnome = findOnPath('gnome-screenshot')
  if (gnome !== null) backends.push({ id: 'gnome-screenshot', command: gnome })
  const spectacle = findOnPath('spectacle')
  if (spectacle !== null) backends.push({ id: 'spectacle', command: spectacle })
  const scrot = findOnPath('scrot')
  if (scrot !== null) backends.push({ id: 'scrot', command: scrot })
  const maim = findOnPath('maim')
  if (maim !== null) backends.push({ id: 'maim', command: maim })
  return backends
}

function linuxHideSupported() {
  if (process.env.DISPLAY === undefined) return false
  if (process.env.WAYLAND_DISPLAY !== undefined) return false
  if (process.env.XDG_SESSION_TYPE === 'wayland') return false
  return findOnPath('xdotool') !== null
}

/** @param {number} timeoutMs */
async function captureLinuxBackend(backend, timeoutMs) {
  const file = join(
    tmpdir(),
    `dsh-scissors-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.png`,
  )
  try {
    if (backend.id === 'grim') {
      const region = await runProcess(backend.slurp, [], { timeoutMs })
      if (region.code !== 0 || region.stdout.trim() === '') return { cancelled: true }
      const result = await runProcess(
        backend.command,
        ['-g', region.stdout.trim(), file],
        { timeoutMs },
      )
      if (result.code !== 0) {
        if (result.error) throw httpError(500, 'no-backend', 'grim could not be started.')
        return { cancelled: true }
      }
    } else if (backend.id === 'gnome-screenshot') {
      const result = await runProcess(backend.command, ['-a', '-f', file], { timeoutMs })
      if (result.timedOut) throw httpError(504, 'timeout', 'The screen capture timed out.')
      if (result.code !== 0) return { cancelled: true }
    } else if (backend.id === 'spectacle') {
      const result = await runProcess(backend.command, ['-r', '-b', '-n', '-o', file], {
        timeoutMs,
      })
      if (result.timedOut) throw httpError(504, 'timeout', 'The screen capture timed out.')
      if (result.code !== 0) return { cancelled: true }
    } else if (backend.id === 'scrot') {
      const result = await runProcess(backend.command, ['-s', '-o', file], { timeoutMs })
      if (result.code !== 0) return { cancelled: true }
    } else if (backend.id === 'maim') {
      const result = await runProcess(backend.command, ['-s', file], { timeoutMs })
      if (result.code !== 0) return { cancelled: true }
    } else {
      throw httpError(500, 'no-backend', 'No supported Linux capture backend was found.')
    }

    let bytes
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size === 0) return { cancelled: true }
      bytes = await fs.readFile(file)
    } catch {
      return { cancelled: true }
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw httpError(413, 'too-large', 'The captured image is too large.')
    }
    return {
      image: bytes.toString('base64'),
      mime: 'image/png',
      name: timestampName(),
      bytes: bytes.length,
      backend: backend.id,
      ...pngSize(bytes),
    }
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

/** @param {{ hide: boolean, timeoutMs: number }} options */
async function captureLinux({ hide, timeoutMs }) {
  const backends = linuxBackends()
  if (backends.length === 0) {
    throw httpError(
      500,
      'no-backend',
      'No supported Linux screenshot tool was found.',
      'Install grim + slurp (Wayland/X11), gnome-screenshot, spectacle, scrot, or maim.',
    )
  }
  if (hide && !linuxHideSupported()) {
    throw httpError(
      409,
      'hide-unsupported',
      'Hiding the active window is not available in this session.',
      'The hide option needs an X11 session and xdotool.',
    )
  }

  const xdotool = hide ? findOnPath('xdotool') : null
  let hiddenWindow = ''
  try {
    if (hide && xdotool !== null) {
      const current = await runProcess(xdotool, ['getactivewindow'], { timeoutMs: 10_000 })
      hiddenWindow = current.stdout.trim()
      if (current.code === 0 && /^\d+$/.test(hiddenWindow)) {
        await runProcess(xdotool, ['windowunmap', hiddenWindow], { timeoutMs: 10_000 })
        await delay(HIDE_SETTLE_MS)
      } else {
        hiddenWindow = ''
      }
    }

    const backend = backends[0]
    const result = await captureLinuxBackend(backend, timeoutMs)
    return { ...result, hidden: hide && hiddenWindow !== '' }
  } finally {
    if (xdotool !== null && hiddenWindow !== '') {
      await runProcess(xdotool, ['windowmap', hiddenWindow], { timeoutMs: 10_000 })
      await runProcess(xdotool, ['windowactivate', hiddenWindow], { timeoutMs: 10_000 })
    }
  }
}

/** @type {{ supported: boolean, hideSupported: boolean, platform: string, backend: string, reason?: string } | null} */
let capabilityCache = null

function detectCapabilities() {
  if (process.platform === 'win32') {
    const hasSelector = bundledWindowsSelector() !== null || cscPath() !== null
    return {
      supported: hasSelector,
      hideSupported: hasSelector,
      platform: 'win32',
      backend: 'winforms-selector',
      ...(hasSelector ? {} : { reason: 'No prebuilt selector and no .NET Framework compiler.' }),
    }
  }
  if (process.platform === 'darwin') {
    const hasTool =
      existsSync('/usr/sbin/screencapture') || findOnPath('screencapture') !== null
    return {
      supported: hasTool,
      hideSupported: hasTool,
      platform: 'darwin',
      backend: 'screencapture',
      ...(hasTool ? {} : { reason: 'screencapture was not found.' }),
    }
  }
  if (process.platform === 'linux') {
    const backends = linuxBackends()
    return {
      supported: backends.length > 0,
      hideSupported: backends.length > 0 && linuxHideSupported(),
      platform: 'linux',
      backend: backends[0]?.id ?? 'none',
      ...(backends.length === 0
        ? { reason: 'Install grim + slurp, gnome-screenshot, spectacle, scrot, or maim.' }
        : {}),
    }
  }
  return {
    supported: false,
    hideSupported: false,
    platform: process.platform,
    backend: 'none',
    reason: `Unsupported platform: ${process.platform}`,
  }
}

function capabilities() {
  if (capabilityCache === null) capabilityCache = detectCapabilities()
  return capabilityCache
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx, config = {}) {
  const configured = Number(config?.timeoutMs)
  const timeoutMs =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const route = url.pathname
          try {
            assertSameOrigin(req)

            if (route === `${PREFIX}/health` && req.method === 'GET') {
              return sendJson(res, 200, {
                ...capabilities(),
                version: VERSION,
                busy: active !== null,
              })
            }

            if (route === `${PREFIX}/capture` && req.method === 'POST') {
              if (req.headers['x-dsh-scissors'] !== 'capture') {
                throw httpError(403, 'forbidden', 'Missing the dsh-scissors capture header.')
              }
              const type = String(req.headers['content-type'] ?? '')
              if (!type.toLowerCase().includes('application/json')) {
                throw httpError(415, 'invalid', 'Request body must be JSON.')
              }
              const caps = capabilities()
              if (!caps.supported) {
                throw httpError(500, 'no-backend', caps.reason ?? 'Screen capture is unavailable.')
              }
              if (active !== null) {
                throw httpError(409, 'busy', 'A screen capture is already in progress.')
              }

              const body = await readJson(req)
              const hide = body.hide === true

              active = { platform: process.platform, startedAt: Date.now() }
              let result
              try {
                if (process.platform === 'win32') {
                  result = await captureWindows({ hide, timeoutMs })
                } else if (process.platform === 'darwin') {
                  result = await captureMac({ hide, timeoutMs })
                } else {
                  result = await captureLinux({ hide, timeoutMs })
                }
              } finally {
                active = null
              }
              return sendJson(res, 200, result)
            }

            return sendJson(res, 404, { error: 'Not found.', code: 'not-found' })
          } catch (cause) {
            const status = Number.isInteger(cause?.status) ? cause.status : 500
            const code = typeof cause?.code === 'string' ? cause.code : 'failed'
            if (status >= 500) ctx.logger?.warn?.('[dsh-scissors]', cause)
            return sendJson(res, status, {
              error: errorText(cause),
              code,
              ...(cause?.detail !== undefined ? { detail: cause.detail } : {}),
            })
          }
        },
      }),
    'dsh-scissors: capture routes',
  )
}
