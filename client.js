/**
 * Browser half of dsh-scissors.
 *
 * A 28px scissors button joins the composer tool row through
 * `conversation.input.left` (immediately to the right of the shipped +).
 * Pressing it opens a body-level popover with exactly two choices:
 *
 *   Capture                         - select a region right away
 *   Capture (hide main window)      - hide the app window first, then select;
 *                                     the window is restored by the host on
 *                                     success, cancel, error and timeout
 *
 * The returned PNG is registered as an ordinary draft image attachment through
 * `conversation.createDrafts` + `inputActions.addAttachments`, so it behaves
 * exactly like an image pasted by the user.
 *
 * The popover and toast are created outside React and appended to
 * `document.body`: the docked composer contains fixed overlays through a
 * transformed ancestor, so an in-tree menu would be clipped. Only React is
 * required by the module loader.
 */
window.__ModuleLoader__.load({
  id: 'dsh-scissors',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-scissors'
    const PREFIX = '/.dsh-scissors'
    const CAPTURE_URL = `${PREFIX}/capture`
    const HEALTH_URL = `${PREFIX}/health`
    /** The native selector stays open until the user acts; cap it anyway. */
    const REQUEST_TIMEOUT_MS = 200_000

    const DICT = {
      en: {
        'button.label': 'Scissors screenshot',
        'button.title': 'Capture a screen region',
        'menu.label': 'Screenshot options',
        'action.capture': 'Capture',
        'action.capture.hide': 'Capture (hide main window)',
        'hint.capture': 'Select a region on screen',
        'hint.capture.hide': 'Hide the main window first, restore it after',
        'hint.hideUnsupported': 'Not available on this platform',
        'toast.capture': 'Select a region…',
        'toast.cancelled': 'Capture cancelled',
        'toast.inserted': 'Screenshot added to the input',
        'toast.busy': 'The input is busy; the screenshot was discarded',
        'toast.inject': 'Could not add the screenshot to the input',
        'error.empty': 'No image was captured.',
        'error.unsupported': 'Screen capture is not supported on this platform.',
        'error.no-backend': 'No screen capture backend is available.',
        'error.busy': 'A screen capture is already in progress.',
        'error.timeout': 'The screen capture timed out. Try again.',
        'error.permission': 'Screen Recording permission is required.',
        'error.hide-permission': 'Permission to hide the window is required.',
        'error.hide-unsupported': 'Hiding the main window is not supported here.',
        'error.hide-denied': 'The main window cannot be hidden right now.',
        'error.too-large': 'The captured image is too large.',
        'error.forbidden': 'The capture request was rejected.',
        'error.invalid': 'The capture request was invalid.',
        'error.failed': 'Screen capture failed.',
        'error.not-found': 'The capture service was not found.',
      },
      zh: {
        'button.label': '剪刀截图',
        'button.title': '截图并放入输入框',
        'menu.label': '截图方式',
        'action.capture': '截图',
        'action.capture.hide': '截图（隐藏主窗口）',
        'hint.capture': '直接框选屏幕区域',
        'hint.capture.hide': '先隐藏主窗口，截完自动恢复',
        'hint.hideUnsupported': '当前平台不支持隐藏窗口',
        'toast.capture': '正在框选截图…',
        'toast.cancelled': '已取消截图',
        'toast.inserted': '截图已放入输入框',
        'toast.busy': '输入框正忙，本次截图已丢弃',
        'toast.inject': '无法把截图放入输入框',
        'error.empty': '没有获得截图。',
        'error.unsupported': '当前平台不支持截图。',
        'error.no-backend': '没有可用的截图后端。',
        'error.busy': '已经有一个截图正在进行。',
        'error.timeout': '截图超时，请重试。',
        'error.permission': '需要「屏幕录制」权限。',
        'error.hide-permission': '需要隐藏窗口的自动化权限。',
        'error.hide-unsupported': '当前会话不支持隐藏主窗口。',
        'error.hide-denied': '现在无法隐藏主窗口。',
        'error.too-large': '截图文件过大。',
        'error.forbidden': '截图请求被拒绝。',
        'error.invalid': '截图请求无效。',
        'error.failed': '截图失败。',
        'error.not-found': '找不到截图服务。',
      },
    }

    const CSS = `
.dsh-scissors-button {
  corner-shape: round;
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: background-color 120ms ease, opacity 120ms ease;
}
@media (hover: hover) {
  .dsh-scissors-button:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-solid);
  }
}
.dsh-scissors-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-scissors-button:disabled { cursor: default; opacity: 0.45; }
.dsh-scissors-button[data-busy="true"] { cursor: progress; opacity: 0.7; }
.dsh-scissors-button[data-busy="true"] svg { animation: dsh-scissors-pulse 900ms ease-in-out infinite alternate; }
@keyframes dsh-scissors-pulse { from { opacity: 0.45; } to { opacity: 1; } }

/* DSH renders the permission/plan cluster between the + button and this slot.
   Move that cluster after the scissors so the button really sits next to +.
   Scoped to the row that contains our button; data-slot names are stable. */
div:has(> [data-slot="conversation.input.left"] > .dsh-scissors-button)
  > [data-slot="conversation.input.left"] > .dsh-scissors-button { order: 1; }
div:has(> [data-slot="conversation.input.left"] > .dsh-scissors-button)
  > div:has(> [data-slot="conversation.input.permission"]) { order: 2; }

.dsh-scissors-menu {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  min-width: 208px;
  max-width: min(288px, calc(100vw - 16px));
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.35));
  border-radius: var(--dsw-radius-panel, 12px);
  background: var(--dsw-alias-bg-overlay, #26262a);
  box-shadow: var(--dsw-elevation-panel, 0 12px 32px rgba(0, 0, 0, 0.32));
  color: var(--dsw-alias-label-primary, #f2f2f2);
  font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 1.4;
  transform-origin: bottom left;
  animation: dsh-scissors-pop 140ms ease-out;
}
.dsh-scissors-menu[data-placement="bottom"] { transform-origin: top left; }
@keyframes dsh-scissors-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.dsh-scissors-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.3));
}
.dsh-scissors-item {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dsh-scissors-item:focus { outline: none; }
@media (hover: hover) {
  .dsh-scissors-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-scissors-item:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-scissors-item:disabled { opacity: 0.45; cursor: default; }
.dsh-scissors-item-icon {
  display: inline-flex;
  flex: none;
  margin-top: 1px;
  color: var(--dsw-alias-label-secondary, #b9b9c0);
}
.dsh-scissors-item-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-scissors-item-label { font-weight: 500; }
.dsh-scissors-item-hint {
  color: var(--dsw-alias-label-secondary, #a8a8b0);
  font-size: 11.5px;
  line-height: 16px;
}

.dsh-scissors-toast {
  position: fixed;
  z-index: 2147483000;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  box-sizing: border-box;
  max-width: min(480px, calc(100vw - 48px));
  padding: 9px 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.35));
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay, #26262a);
  color: var(--dsw-alias-label-primary, #f2f2f2);
  box-shadow: var(--dsw-elevation-panel, 0 12px 32px rgba(0, 0, 0, 0.28));
  font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 12.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  pointer-events: none;
  animation: dsh-scissors-toast-in 160ms ease-out;
}
.dsh-scissors-toast[data-kind="error"] { border-color: var(--dsw-alias-state-error-primary, #e5484d); }
.dsh-scissors-toast[data-kind="success"] { border-color: var(--dsw-alias-state-business-primary, #4d9fff); }
@keyframes dsh-scissors-toast-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
`

    const REGION_ICON =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M2.5 5V3.2c0-.39.31-.7.7-.7H5M11 2.5h1.8c.39 0 .7.31.7.7V5M13.5 11v1.8c0 .39-.31.7-.7.7H11M5 13.5H3.2a.7.7 0 0 1-.7-.7V11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '<circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.2"/>' +
      '</svg>'

    const HIDE_ICON =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
      '<rect x="2.5" y="3.5" width="11" height="8" rx="1.3" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M5.7 13.5h4.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M3 2.5l10 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '</svg>'

    function ScissorsIcon() {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { cx: 3.75, cy: 12.25, r: 1.75, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 3.75, cy: 3.75, r: 1.75, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M5.1 11.05 13 3.15M5.1 4.95 13 12.85',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function errorText(error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    /** Keep the window choice anchored; only one menu exists at a time. */
    let openMenuAnchor = null
    let menuCleanup = null
    let openMenuChange = null

    function isMenuOpenFor(anchor) {
      return openMenuAnchor === anchor && menuCleanup !== null
    }

    /** Close the body-level popover, optionally returning focus to its button. */
    function closeMenu(restoreFocus = true) {
      if (menuCleanup === null) return
      const cleanup = menuCleanup
      const change = openMenuChange
      menuCleanup = null
      openMenuAnchor = null
      openMenuChange = null
      cleanup(restoreFocus)
      if (change) change(false)
    }

    /**
     * Open the two-action capture popover above the button.
     * @param {{
     *   anchor: HTMLButtonElement,
     *   t: (key: string) => string,
     *   hideSupported: boolean,
     *   onPick: (key: 'capture' | 'hide') => void,
     *   onOpenChange?: (open: boolean) => void,
     * }} options
     */
    function openMenu(options) {
      closeMenu(false)
      const { anchor, t, hideSupported, onPick, onOpenChange } = options
      const doc = document
      const menu = doc.createElement('div')
      menu.className = 'dsh-scissors-menu'
      menu.dataset.dshPlugin = NS
      menu.setAttribute('role', 'menu')
      menu.setAttribute('aria-label', t('menu.label'))
      menu.tabIndex = -1
      menu.style.visibility = 'hidden'

      const entries = [
        {
          key: 'capture',
          icon: REGION_ICON,
          label: t('action.capture'),
          hint: t('hint.capture'),
          disabled: false,
        },
        {
          key: 'hide',
          icon: HIDE_ICON,
          label: t('action.capture.hide'),
          hint: hideSupported ? t('hint.capture.hide') : t('hint.hideUnsupported'),
          disabled: !hideSupported,
        },
      ]

      const buttons = []
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (index > 0) {
          const separator = doc.createElement('div')
          separator.className = 'dsh-scissors-sep'
          separator.setAttribute('role', 'separator')
          menu.appendChild(separator)
        }

        const item = doc.createElement('button')
        item.type = 'button'
        item.className = 'dsh-scissors-item'
        item.setAttribute('role', 'menuitem')
        item.tabIndex = -1
        if (entry.disabled) {
          item.disabled = true
          item.setAttribute('aria-disabled', 'true')
        }

        const icon = doc.createElement('span')
        icon.className = 'dsh-scissors-item-icon'
        icon.innerHTML = entry.icon

        const text = doc.createElement('span')
        text.className = 'dsh-scissors-item-text'
        const label = doc.createElement('span')
        label.className = 'dsh-scissors-item-label'
        label.textContent = entry.label
        const hint = doc.createElement('span')
        hint.className = 'dsh-scissors-item-hint'
        hint.textContent = entry.hint
        text.appendChild(label)
        text.appendChild(hint)

        item.appendChild(icon)
        item.appendChild(text)
        item.addEventListener('click', () => {
          if (entry.disabled) return
          closeMenu(false)
          onPick(entry.key)
        })

        buttons.push(item)
        menu.appendChild(item)
      }

      doc.body.appendChild(menu)

      // Measure once, then place above the button (below when there is no
      // room) and clamp to the viewport.
      const rect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const margin = 8
      let left = rect.left
      if (left + menuRect.width > window.innerWidth - margin) {
        left = window.innerWidth - menuRect.width - margin
      }
      if (left < margin) left = margin

      let top = rect.top - menuRect.height - margin
      let placement = 'top'
      if (top < margin) {
        top = rect.bottom + margin
        placement = 'bottom'
      }
      if (top + menuRect.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - menuRect.height - margin)
      }

      menu.style.left = `${Math.round(left)}px`
      menu.style.top = `${Math.round(top)}px`
      menu.dataset.placement = placement
      menu.style.visibility = 'visible'

      const enabled = buttons.filter((button) => !button.disabled)
      const focusItem = (index) => {
        const target = enabled[index]
        if (target) target.focus({ preventScroll: true })
      }

      const onKeyDown = (event) => {
        if (!menu.isConnected) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeMenu(true)
          return
        }
        if (event.key === 'Tab') {
          closeMenu(true)
          return
        }
        if (
          event.key !== 'ArrowDown' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'Home' &&
          event.key !== 'End'
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        if (enabled.length === 0) return
        const current = enabled.indexOf(doc.activeElement)
        let next
        if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = enabled.length - 1
        else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % enabled.length
        else next = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length
        focusItem(next)
      }

      const onPointerDown = (event) => {
        if (menu.contains(event.target) || anchor.contains(event.target)) return
        closeMenu(true)
      }

      const onDismiss = () => closeMenu(true)

      doc.addEventListener('keydown', onKeyDown, true)
      doc.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('resize', onDismiss)
      window.addEventListener('scroll', onDismiss, true)
      window.addEventListener('blur', onDismiss)

      menuCleanup = (restoreFocus) => {
        doc.removeEventListener('keydown', onKeyDown, true)
        doc.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('resize', onDismiss)
        window.removeEventListener('scroll', onDismiss, true)
        window.removeEventListener('blur', onDismiss)
        menu.remove()
        if (restoreFocus) anchor.focus({ preventScroll: true })
      }
      openMenuAnchor = anchor
      openMenuChange = onOpenChange ?? null
      if (onOpenChange) onOpenChange(true)

      // Focus the menu, then the first action, so arrow keys and Enter work
      // immediately even when another overlay had the focus a moment ago.
      menu.focus({ preventScroll: true })
      focusItem(0)
    }

    let toastState = null

    /** @param {string} text @param {'info' | 'error' | 'success'} kind @param {number} duration */
    function showToast(text, kind, duration) {
      if (typeof document === 'undefined') return
      let toast = toastState
      if (toast === null || !toast.element.isConnected) {
        const element = document.createElement('div')
        element.className = 'dsh-scissors-toast'
        element.dataset.dshPlugin = NS
        element.setAttribute('role', 'status')
        element.setAttribute('aria-live', 'polite')
        document.body.appendChild(element)
        toast = { element, timer: 0 }
        toastState = toast
      }
      toast.element.dataset.kind = kind ?? 'info'
      toast.element.textContent = text
      if (toast.timer) window.clearTimeout(toast.timer)
      toast.timer = duration > 0 ? window.setTimeout(hideToast, duration) : 0
    }

    function hideToast() {
      if (toastState === null) return
      const { element, timer } = toastState
      toastState = null
      if (timer) window.clearTimeout(timer)
      element.remove()
    }

    /** Walk up to the composer card and put the caret back in its editor. */
    function focusComposer(node) {
      let current = node
      while (current && current !== document.body) {
        const editor =
          current.querySelector && current.querySelector('[contenteditable="true"]')
        if (editor && typeof editor.focus === 'function') {
          editor.focus({ preventScroll: true })
          return
        }
        current = current.parentElement
      }
    }

    /** @param {Record<string, unknown>} payload @param {(key: string) => string} t */
    function messageFor(payload, t) {
      const code = payload && typeof payload.code === 'string' ? payload.code : ''
      const known = new Set([
        'unsupported',
        'no-backend',
        'busy',
        'timeout',
        'permission',
        'hide-permission',
        'hide-unsupported',
        'hide-denied',
        'too-large',
        'forbidden',
        'invalid',
        'failed',
        'not-found',
      ])
      if (known.has(code)) return t(`error.${code}`)
      if (payload && typeof payload.error === 'string' && payload.error !== '') {
        return payload.error
      }
      return t('error.failed')
    }

    function ScissorsButton(props) {
      const { sessionId, inputActions, conversation, t } = props
      const [busy, setBusy] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const [health, setHealth] = useState({
        state: 'probing',
        supported: true,
        hideSupported: true,
      })
      const busyRef = useRef(false)
      const buttonRef = useRef(null)

      useEffect(() => {
        let alive = true
        fetch(HEALTH_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (!alive || body === null) return
            setHealth({
              state: 'ready',
              supported: body.supported !== false,
              hideSupported: body.hideSupported !== false,
            })
          })
          .catch(() => {
            if (!alive) return
            // A probe failure is not proof the backend is missing; let the
            // explicit capture attempt report the real error.
            setHealth({ state: 'unknown', supported: true, hideSupported: true })
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => () => closeMenu(false), [])

      const capture = useCallback(
        async (hide) => {
          if (busyRef.current) return
          busyRef.current = true
          setBusy(true)
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          const timer = controller
            ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
            : 0
          showToast(t('toast.capture'), 'info', 0)
          try {
            const response = await fetch(CAPTURE_URL, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-dsh-scissors': 'capture',
              },
              body: JSON.stringify({ hide: hide === true }),
              cache: 'no-store',
              signal: controller ? controller.signal : undefined,
            })

            let payload = {}
            try {
              payload = await response.json()
            } catch {
              // A non-JSON body still carries an HTTP status worth reporting.
            }
            if (!response.ok) {
              const error = new Error(messageFor(payload, t))
              error.detail = payload && payload.detail
              throw error
            }
            if (payload.cancelled === true) {
              showToast(t('toast.cancelled'), 'info', 1800)
              return
            }
            if (typeof payload.image !== 'string' || payload.image === '') {
              throw new Error(t('error.empty'))
            }

            const mime = typeof payload.mime === 'string' ? payload.mime : 'image/png'
            const blob = await (
              await fetch(`data:${mime};base64,${payload.image}`, { cache: 'no-store' })
            ).blob()
            if (!blob || blob.size === 0) throw new Error(t('error.empty'))

            const name =
              typeof payload.name === 'string' && payload.name !== ''
                ? payload.name
                : 'dsh-scissors.png'
            const file = new File([blob], name, { type: mime })

            const drafts = conversation.createDrafts(sessionId, [file], true)
            const ids = (drafts || []).map((draft) => draft.id)
            if (ids.length === 0) throw new Error(t('toast.inject'))

            const added = inputActions.addAttachments(ids)
            if (added !== true) {
              try {
                conversation.releaseDraftAttachments(drafts)
              } catch {
                // The drafts die with the service fiber anyway.
              }
              showToast(t('toast.busy'), 'error', 5000)
              return
            }

            showToast(t('toast.inserted'), 'success', 2000)
            focusComposer(buttonRef.current)
          } catch (error) {
            if (error && error.name === 'AbortError') {
              showToast(t('error.timeout'), 'error', 5000)
            } else {
              if (error && error.detail) console.warn('[dsh-scissors]', error.detail)
              showToast(errorText(error), 'error', 6000)
            }
          } finally {
            if (timer) window.clearTimeout(timer)
            busyRef.current = false
            setBusy(false)
          }
        },
        [conversation, inputActions, sessionId, t],
      )

      const onButtonClick = useCallback(() => {
        if (busyRef.current || health.supported === false) return
        const anchor = buttonRef.current
        if (!anchor) return
        if (isMenuOpenFor(anchor)) {
          closeMenu(true)
          return
        }
        openMenu({
          anchor,
          t,
          hideSupported: health.hideSupported !== false,
          onPick: (key) => {
            void capture(key === 'hide')
          },
          onOpenChange: setMenuOpen,
        })
      }, [capture, health.hideSupported, health.supported, t])

      const disabled = busy || health.supported === false
      const title = disabled && !busy ? t('error.unsupported') : t('button.title')

      return h(
        'button',
        {
          ref: buttonRef,
          type: 'button',
          className: 'dsh-scissors-button',
          'data-busy': busy ? 'true' : 'false',
          'aria-label': t('button.label'),
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen ? 'true' : 'false',
          title,
          disabled,
          onClick: onButtonClick,
        },
        h(ScissorsIcon),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = NS
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            closeMenu(false)
            hideToast()
            style.remove()
          }
        }, 'dsh-scissors: styles')

        ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-scissors: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.inject(['conversation'], (scope) => {
          const conversation = scope.get('conversation')
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              { name: 'conversation.input.left', id: 'dsh-scissors', order: 100 },
              (props) => h(ScissorsButton, { ...props, t, conversation }),
            ),
          )
        })
      },
    }
  },
})
