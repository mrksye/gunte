/**
 * goonteh core — a framework-agnostic pointer drag-and-drop engine.
 *
 * Pure TypeScript + DOM, no framework. It tracks a drag from pointer-down (past a small
 * threshold) through pointer-up, hit-tests registered drop zones with `elementFromPoint`,
 * manages an optional ghost element that follows the pointer, and drives the body cursor.
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
  let px = 0
  let py = 0
  let overId: number | undefined
  const zones = new Map<number, { el: HTMLElement } & DropzoneOptions>()
  let nextId = 1
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())

  /**
   * Walk up from the element under the pointer to the innermost registered zone that ACCEPTS the
   * active drag. Accept-aware so nested zones with different `kind`s coexist (a child zone that
   * rejects the payload is skipped in favour of an accepting ancestor).
   */
  const zoneAt = (x: number, y: number): { id: number; zone: DropzoneOptions } | undefined => {
    if (!active) return undefined
    let node = document.elementFromPoint(x, y) as Element | null
    while (node) {
      for (const [id, z] of zones) {
        if (z.el === node && z.accepts(active.kind, active.payload)) return { id, zone: z }
      }
      node = node.parentElement
    }
    return undefined
  }

  const positionGhost = () => {
    if (!active?.ghost) return
    active.ghost.style.left = `${px}px`
    active.ghost.style.top = `${py}px`
  }

  const onMove = (e: PointerEvent) => {
    if (!active) return
    e.preventDefault()
    px = e.clientX
    py = e.clientY
    positionGhost()
    overId = zoneAt(px, py)?.id
    notify()
  }
  const onUp = (e: PointerEvent) => {
    if (active) {
      const hit = zoneAt(e.clientX, e.clientY)
      if (hit) hit.zone.onDrop(active.payload, active.kind, { x: e.clientX, y: e.clientY })
    }
    end()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end()
  }

  const listen = () => {
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', end)
    window.addEventListener('keydown', onKey)
  }
  const unlisten = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('keydown', onKey)
  }

  function end() {
    if (!active) return
    const a = active
    active = undefined
    overId = undefined
    unlisten()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (a.ghost) a.ghost.remove()
    a.unlift?.()
    a.onEnd?.()
    notify()
  }

  const begin = (el: HTMLElement, opts: DraggableOptions, x: number, y: number) => {
    px = x
    py = y
    overId = undefined
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
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    listen()
    notify()
  }

  return {
    draggable(el, opts) {
      el.setAttribute('data-goonteh-grab', '')
      const down = (e: PointerEvent) => {
        if (opts.disabled?.()) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const target = e.target as Element | null
        if (target && target.closest('[data-goonteh-grab]') !== el) return // nested grabs: innermost wins
        const sx = e.clientX
        const sy = e.clientY
        let armed = true
        const move = (ev: PointerEvent) => {
          if (!armed) return
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return
          disarm()
          begin(el, opts, ev.clientX, ev.clientY)
        }
        const disarm = () => {
          armed = false
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', disarm)
        }
        window.addEventListener('pointermove', move, { passive: false })
        window.addEventListener('pointerup', disarm)
      }
      el.addEventListener('pointerdown', down)
      return () => {
        el.removeEventListener('pointerdown', down)
        el.removeAttribute('data-goonteh-grab')
      }
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
      end()
      subs.clear()
      zones.clear()
    },
  }
}
