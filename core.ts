/**
 * goonteh core — a framework-agnostic pointer drag-and-drop engine.
 *
 * Pure TypeScript + DOM, no framework. For a single primary pointer it tracks a drag from
 * pointer-down (past a small threshold) through pointer-up, hit-tests registered drop zones by
 * geometry (rect containment + DOM nesting, not paint order), manages an optional ghost element
 * that follows the pointer, and drives the body cursor. Secondary touches are ignored, pointer
 * capture keeps events flowing off-element, and teardown restores the body's prior inline styles.
 * Framework adapters (see `./solid`) wrap this; you can also use it directly with vanilla JS.
 *
 * The name respells 軍手 (gunte), Japanese for "work gloves": native HTML5 DnD slips (no
 * touch, and a stuck no-drop cursor on some platforms) — put a glove on to actually grip.
 */

export type Point = { x: number; y: number }
export type Accepts = (kind: string, payload: unknown) => boolean
export type OnDrop = (payload: unknown, kind: string, point: Point) => void

export type DraggableOptions = {
  /** Read at drag start; the value handed to the drop target. */
  payload: () => unknown
  /** Tag drop zones filter on. */
  kind: string
  /** Builds the drag preview element, once, at drag start. Mounted/positioned/removed by core. */
  ghost?: () => HTMLElement
  /** When it returns true, pointer-down does not start a drag. */
  disabled?: () => boolean
  /** How the source element behaves while it is being dragged. Restored when the drag ends.
   *  - `'hole'`: hidden in place (visibility:hidden) — the box keeps its space, so a blank hole is
   *    left and siblings do NOT reflow. The item looks genuinely picked up. Recommended default.
   *  - `'collapse'`: removed from layout (display:none) — siblings close the gap ("normal" reflow).
   *  Omit to leave the source fully visible in place (a copy-style drag, e.g. a palette/tray). */
  lift?: 'hole' | 'collapse'
  /** Called after the drag ends (dropped or cancelled); use it to dispose a rendered ghost. */
  onEnd?: () => void
}

export type DropzoneOptions = {
  accepts: Accepts
  onDrop: OnDrop
}

export type DropzoneHandle = {
  /** True while a compatible drag hovers over this zone. */
  isOver: () => boolean
  destroy: () => void
}

export type GoontehConfig = {
  /** Pixels the pointer must travel before a drag starts. Default 5. */
  threshold?: number
  /** Body cursor while dragging. Default 'grabbing'. */
  cursor?: string
  /** Ghost translate offset in percent of its own size. Default { x: -40, y: -60 }. */
  ghostOffset?: { x: number; y: number }
}

export type GoontehCore = {
  draggable(el: HTMLElement, opts: DraggableOptions): () => void
  dropzone(el: HTMLElement, opts: DropzoneOptions): DropzoneHandle
  dragging: () => boolean
  /** The active drag's descriptor (kind + payload) while dragging, else undefined. */
  active: () => { kind: string; payload: unknown } | undefined
  /** The live pointer position while dragging, else undefined. Lets zones compute sub-position (e.g. a
   *  card's centre vs edge) to show reorder-vs-combine affordances during hover. */
  point: () => Point | undefined
  /** Subscribe to state changes (drag start/move/zone change/end). Returns an unsubscribe. */
  onChange(fn: () => void): () => void
  destroy(): void
}

type Active = { payload: unknown; kind: string; ghost: HTMLElement | undefined; unlift?: () => void; onEnd?: () => void }

/** The style override each lift mode applies to the source while it is dragged (data, not branches). */
const LIFT_STYLE: Record<NonNullable<DraggableOptions['lift']>, { prop: 'visibility' | 'display'; value: string }> = {
  hole: { prop: 'visibility', value: 'hidden' },
  collapse: { prop: 'display', value: 'none' },
}

/** Apply a lift to the source, returning a thunk that restores the prior style (or undefined = no lift). */
const applyLift = (el: HTMLElement, mode: DraggableOptions['lift']): (() => void) | undefined => {
  if (!mode) return undefined
  const { prop, value } = LIFT_STYLE[mode]
  const prev = el.style[prop]
  el.style[prop] = value
  return () => {
    el.style[prop] = prev
  }
}

/** Create an engine instance. One per drag context (e.g. one per app). */
export function createGoontehCore(config: GoontehConfig = {}): GoontehCore {
  const threshold = config.threshold ?? 5
  const cursor = config.cursor ?? 'grabbing'
  const offset = config.ghostOffset ?? { x: -40, y: -60 }

  let active: Active | undefined
  let activePointerId: number | undefined
  let captureEl: HTMLElement | undefined
  let prevCursor = ''
  let prevUserSelect = ''
  let armedCleanup: (() => void) | undefined
  let px = 0
  let py = 0
  let overId: number | undefined
  const zones = new Map<number, { el: HTMLElement } & DropzoneOptions>()
  const draggableCleanups = new Set<() => void>()
  let nextId = 1
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())

  const rectHit = (el: HTMLElement, x: number, y: number): boolean => {
    const r = el.getBoundingClientRect()
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom
  }

  /**
   * The innermost registered zone that ACCEPTS the active drag and whose rect contains the pointer.
   * Resolved by geometry + DOM nesting rather than paint order (elementFromPoint), so a zone stays
   * reachable even when a decorative overlay or a sibling is painted on top of it, and accept-aware so
   * a rejecting child yields to an accepting ancestor.
   */
  const zoneAt = (x: number, y: number): { id: number; zone: DropzoneOptions } | undefined => {
    if (!active) return undefined
    const hits: { id: number; zone: { el: HTMLElement } & DropzoneOptions }[] = []
    for (const [id, z] of zones) if (z.accepts(active.kind, active.payload) && rectHit(z.el, x, y)) hits.push({ id, zone: z })
    return hits.find((h) => !hits.some((o) => o !== h && h.zone.el.contains(o.zone.el))) ?? hits[hits.length - 1]
  }

  const positionGhost = () => {
    if (!active?.ghost) return
    active.ghost.style.left = `${px}px`
    active.ghost.style.top = `${py}px`
  }

  const onMove = (e: PointerEvent) => {
    if (!active || e.pointerId !== activePointerId) return // only the finger that started this drag
    e.preventDefault()
    px = e.clientX
    py = e.clientY
    positionGhost()
    overId = zoneAt(px, py)?.id
    notify()
  }
  const onUp = (e: PointerEvent) => {
    if (!active || e.pointerId !== activePointerId) return
    const hit = zoneAt(e.clientX, e.clientY)
    // Always tear down, even if the drop callback throws — no leaked ghost / listeners / cursor / lift.
    try {
      if (hit) hit.zone.onDrop(active.payload, active.kind, { x: e.clientX, y: e.clientY })
    } finally {
      end()
    }
  }
  const onCancel = (e: PointerEvent) => {
    if (active && e.pointerId === activePointerId) end()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end()
  }

  const listen = () => {
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }
  const unlisten = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
  }

  function end() {
    if (!active) return
    const a = active
    const id = activePointerId
    const capEl = captureEl
    active = undefined
    activePointerId = undefined
    captureEl = undefined
    overId = undefined
    unlisten()
    if (capEl && id !== undefined) {
      try {
        capEl.releasePointerCapture(id)
      } catch {
        // already auto-released on pointerup/cancel, or the source was detached — fine
      }
    }
    // Restore the body's prior inline styles rather than blanking them (don't clobber the app's).
    document.body.style.cursor = prevCursor
    document.body.style.userSelect = prevUserSelect
    if (a.ghost) a.ghost.remove()
    a.unlift?.()
    a.onEnd?.()
    notify()
  }

  const begin = (el: HTMLElement, opts: DraggableOptions, pointerId: number, x: number, y: number) => {
    px = x
    py = y
    overId = undefined
    activePointerId = pointerId
    const ghost = opts.ghost?.()
    active = { payload: opts.payload(), kind: opts.kind, ghost, unlift: applyLift(el, opts.lift), onEnd: opts.onEnd }
    if (ghost) {
      ghost.style.position = 'fixed'
      ghost.style.pointerEvents = 'none'
      ghost.style.zIndex = '9999'
      ghost.style.transform = `translate(${offset.x}%, ${offset.y}%)`
      positionGhost()
      document.body.appendChild(ghost)
    }
    prevCursor = document.body.style.cursor
    prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    // Capture keeps pointer events flowing even if the finger leaves the element / viewport / an iframe.
    try {
      el.setPointerCapture(pointerId)
      captureEl = el
    } catch {
      captureEl = undefined
    }
    listen()
    notify()
  }

  return {
    draggable(el, opts) {
      el.setAttribute('data-goonteh-grab', '')
      const prevTouchAction = el.style.touchAction
      el.style.touchAction = 'none' // so a touch drag isn't stolen by the browser's scroll/pan
      const down = (e: PointerEvent) => {
        if (opts.disabled?.()) return
        if (!e.isPrimary) return // ignore secondary touches of a multi-touch gesture
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (active) return // a drag is already in flight
        const target = e.target as Element | null
        if (target && target.closest('[data-goonteh-nodrag]')) return // opt-out zones (e.g. resize handles) never start a drag
        if (target && target.closest('[data-goonteh-grab]') !== el) return // nested grabs: innermost wins
        const id = e.pointerId
        const sx = e.clientX
        const sy = e.clientY
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== id) return // only the finger that pressed down here
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return
          disarm()
          begin(el, opts, id, ev.clientX, ev.clientY)
        }
        const stop = (ev: PointerEvent) => {
          if (ev.pointerId === id) disarm() // released or cancelled before crossing the threshold
        }
        const disarm = () => {
          armedCleanup = undefined
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
        }
        armedCleanup = disarm
        window.addEventListener('pointermove', move, { passive: false })
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
      }
      el.addEventListener('pointerdown', down)
      const cleanup = () => {
        el.removeEventListener('pointerdown', down)
        el.removeAttribute('data-goonteh-grab')
        el.style.touchAction = prevTouchAction
        draggableCleanups.delete(cleanup)
      }
      draggableCleanups.add(cleanup)
      return cleanup
    },
    dropzone(el, opts) {
      const id = nextId++
      zones.set(id, { el, accepts: opts.accepts, onDrop: opts.onDrop })
      return {
        isOver: () => overId === id,
        destroy: () => {
          zones.delete(id)
        },
      }
    },
    dragging: () => active !== undefined,
    active: () => (active ? { kind: active.kind, payload: active.payload } : undefined),
    point: () => (active ? { x: px, y: py } : undefined),
    onChange: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    destroy: () => {
      armedCleanup?.() // a drag that was arming but not yet begun
      end()
      ;[...draggableCleanups].forEach((c) => c()) // remove every registered pointerdown listener
      subs.clear()
      zones.clear()
    },
  }
}
