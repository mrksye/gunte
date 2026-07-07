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

export type Accepts = (kind: string, payload: unknown) => boolean
export type OnDrop = (payload: unknown, kind: string) => void

export type DraggableOptions = {
  /** Read at drag start; the value handed to the drop target. */
  payload: () => unknown
  /** Tag drop zones filter on. */
  kind: string
  /** Builds the drag preview element, once, at drag start. Mounted/positioned/removed by core. */
  ghost?: () => HTMLElement
  /** When it returns true, pointer-down does not start a drag. */
  disabled?: () => boolean
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
  /** Subscribe to state changes (drag start/move/zone change/end). Returns an unsubscribe. */
  onChange(fn: () => void): () => void
  destroy(): void
}

type Active = { payload: unknown; kind: string; ghost: HTMLElement | null; onEnd?: () => void }

/** Create an engine instance. One per drag context (e.g. one per app). */
export function createGoontehCore(config: GoontehConfig = {}): GoontehCore {
  const threshold = config.threshold ?? 5
  const cursor = config.cursor ?? 'grabbing'
  const offset = config.ghostOffset ?? { x: -40, y: -60 }

  let active: Active | null = null
  let px = 0
  let py = 0
  let overId: number | null = null
  const zones = new Map<number, { el: HTMLElement } & DropzoneOptions>()
  let nextId = 1
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())

  /** Walk up from the element under the pointer to the first registered zone. */
  const zoneAt = (x: number, y: number): { id: number; zone: DropzoneOptions } | null => {
    let node = document.elementFromPoint(x, y) as Element | null
    while (node) {
      for (const [id, z] of zones) if (z.el === node) return { id, zone: z }
      node = node.parentElement
    }
    return null
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
    const hit = zoneAt(px, py)
    overId = hit && hit.zone.accepts(active.kind, active.payload) ? hit.id : null
    notify()
  }
  const onUp = (e: PointerEvent) => {
    if (active) {
      const hit = zoneAt(e.clientX, e.clientY)
      if (hit && hit.zone.accepts(active.kind, active.payload)) hit.zone.onDrop(active.payload, active.kind)
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
    active = null
    overId = null
    unlisten()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (a.ghost) a.ghost.remove()
    a.onEnd?.()
    notify()
  }

  const begin = (opts: DraggableOptions, x: number, y: number) => {
    px = x
    py = y
    overId = null
    const ghost = opts.ghost?.() ?? null
    active = { payload: opts.payload(), kind: opts.kind, ghost, onEnd: opts.onEnd }
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
      const down = (e: PointerEvent) => {
        if (opts.disabled?.()) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const sx = e.clientX
        const sy = e.clientY
        let armed = true
        const move = (ev: PointerEvent) => {
          if (!armed) return
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return
          disarm()
          begin(opts, ev.clientX, ev.clientY)
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
      return () => el.removeEventListener('pointerdown', down)
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
    dragging: () => active !== null,
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
