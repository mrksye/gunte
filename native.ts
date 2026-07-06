import { createGunteCore, type DropzoneHandle, type DropzoneOptions, type GunteConfig } from './core'

/**
 * gunte — native (vanilla DOM) adapter.
 *
 * A friendly, framework-free wrapper over the core for plain HTML/JS: `grab(el, ...)` and
 * `drop(el, ...)` bound to one engine, plus ghost sugar (a factory, an HTML string, or a clone of
 * the source). Needs no dependencies at all.
 */
export type NativeGhost = (() => HTMLElement) | string | 'clone'

export type NativeGrabOptions = {
  payload?: unknown
  kind: string
  /** Ghost: a factory, an HTML string, or 'clone' to clone the dragged element. Default 'clone'. */
  ghost?: NativeGhost
  disabled?: () => boolean
}

export type Gunte = {
  grab(el: HTMLElement, opts: NativeGrabOptions): () => void
  drop(el: HTMLElement, opts: DropzoneOptions): DropzoneHandle
  dragging(): boolean
  onChange(fn: () => void): () => void
  destroy(): void
}

/** Create a DOM-native gunte instance (no framework). */
export function gunte(config?: GunteConfig): Gunte {
  const core = createGunteCore(config)
  return {
    grab(el, opts) {
      return core.draggable(el, {
        payload: () => opts.payload,
        kind: opts.kind,
        disabled: opts.disabled,
        ghost: () => makeGhost(el, opts.ghost),
      })
    },
    drop: (el, opts) => core.dropzone(el, opts),
    dragging: () => core.dragging(),
    onChange: (fn) => core.onChange(fn),
    destroy: () => core.destroy(),
  }
}

/** Build a ghost element from the requested strategy. */
function makeGhost(source: HTMLElement, ghost: NativeGhost = 'clone'): HTMLElement {
  if (typeof ghost === 'function') return ghost()
  if (ghost === 'clone') {
    const clone = source.cloneNode(true) as HTMLElement
    const rect = source.getBoundingClientRect()
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    clone.style.opacity = '0.85'
    return clone
  }
  const wrap = document.createElement('div')
  wrap.innerHTML = ghost
  return wrap
}
