import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createGoontehCore, type GoontehConfig, type GoontehCore } from './core'

/**
 * goonteh — React adapter.
 *
 * Thin React bindings over the framework-agnostic core (`./core`): a provider that owns one
 * engine, `<Grab>` for draggable sources, and `<Drop>` for targets. Latest props are read through
 * refs so the stable core closures always see current values. `react` / `react-dom` are optional
 * peer dependencies.
 */
type Ctx = { core: GoontehCore; version: number }
const GoontehContext = createContext<Ctx | null>(null)

/** Root provider. Create it once, above every `<Grab>`/`<Drop>`. */
export function GoontehProvider({ children, config }: { children: ReactNode; config?: GoontehConfig }) {
  const coreRef = useRef<GoontehCore>()
  if (!coreRef.current) coreRef.current = createGoontehCore(config)
  const core = coreRef.current
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const unsub = core.onChange(() => setVersion((v) => v + 1))
    return () => {
      unsub()
      core.destroy()
    }
  }, [core])
  return <GoontehContext.Provider value={{ core, version }}>{children}</GoontehContext.Provider>
}

function useCtx(): Ctx {
  const c = useContext(GoontehContext)
  if (!c) throw new Error('goonteh: <GoontehProvider> is required higher in the tree')
  return c
}

/** A draggable source. `ghost` is rendered into a detached element at grab time via a React root. */
export function Grab({
  payload,
  kind,
  ghost,
  disabled,
  className,
  children,
}: {
  payload: unknown
  kind: string
  ghost: () => ReactNode
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const { core } = useCtx()
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ payload, ghost, disabled })
  latest.current = { payload, ghost, disabled }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let root: Root | null = null
    const cleanup = core.draggable(el, {
      payload: () => latest.current.payload,
      kind,
      disabled: () => !!latest.current.disabled,
      ghost: () => {
        const container = document.createElement('div')
        root = createRoot(container)
        root.render(latest.current.ghost())
        return container
      },
      onEnd: () => {
        root?.unmount()
        root = null
      },
    })
    return () => {
      cleanup()
      root?.unmount()
    }
  }, [core, kind])
  return (
    <div ref={ref} className={className} style={{ touchAction: 'none' }}>
      {children}
    </div>
  )
}

/** A drop target. `activeClass` is applied while a compatible drag hovers over it. */
export function Drop({
  accepts,
  onDrop,
  className,
  activeClass,
  children,
}: {
  accepts: (kind: string, payload: unknown) => boolean
  onDrop: (payload: unknown, kind: string) => void
  className?: string
  activeClass?: string
  children: ReactNode
}) {
  const { core } = useCtx()
  const ref = useRef<HTMLDivElement>(null)
  const handle = useRef<{ isOver: () => boolean } | null>(null)
  const latest = useRef({ accepts, onDrop })
  latest.current = { accepts, onDrop }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = core.dropzone(el, {
      accepts: (k, p) => latest.current.accepts(k, p),
      onDrop: (p, k) => latest.current.onDrop(p, k),
    })
    handle.current = h
    return () => h.destroy()
  }, [core])
  const over = handle.current?.isOver() ?? false
  return (
    <div ref={ref} className={`${className ?? ''} ${over ? (activeClass ?? '') : ''}`}>
      {children}
    </div>
  )
}
