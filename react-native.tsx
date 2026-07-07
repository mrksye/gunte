import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

/**
 * goonteh — React Native adapter (experimental).
 *
 * React Native has no DOM, so this does NOT reuse the web core (`./core`). Instead it ships its
 * own tiny engine: gestures via the built-in `PanResponder` (no extra deps), hit testing against
 * drop zones' measured rects, and a ghost rendered in a full-screen overlay that follows the
 * touch. Coordinates use PanResponder's screen-space `moveX`/`moveY` matched with
 * `measureInWindow`. `react` and `react-native` are optional peer dependencies.
 */
type Rect = { x: number; y: number; w: number; h: number }
type Zone = { rect: Rect | null; accepts: (kind: string, payload: unknown) => boolean; onDrop: (payload: unknown, kind: string, point: { x: number; y: number }) => void }
type Active = { payload: unknown; kind: string; ghost: ReactNode }

type Ctx = {
  register: (z: Zone) => number
  unregister: (id: number) => void
  begin: (a: Active, x: number, y: number) => void
  move: (x: number, y: number) => void
  end: () => void
  overId: number | null
}

const GoontehContext = createContext<Ctx | null>(null)
const THRESHOLD = 5

/** Root provider. Create it once, above every `<Grab>`/`<Drop>`; it also renders the ghost overlay. */
export function GoontehProvider({ children }: { children: ReactNode }) {
  const zones = useRef(new Map<number, Zone>())
  const nextId = useRef(1)
  const pos = useRef(new Animated.ValueXY()).current
  const point = useRef({ x: 0, y: 0 })
  const activeRef = useRef<Active | null>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const hit = (x: number, y: number): { id: number; zone: Zone } | null => {
    for (const [id, zone] of zones.current) {
      const r = zone.rect
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { id, zone }
    }
    return null
  }

  const ctx: Ctx = {
    register: (z) => {
      const id = nextId.current++
      zones.current.set(id, z)
      return id
    },
    unregister: (id) => {
      zones.current.delete(id)
    },
    begin: (a, x, y) => {
      activeRef.current = a
      point.current = { x, y }
      pos.setValue({ x, y })
      setActive(a)
      setOverId(null)
    },
    move: (x, y) => {
      point.current = { x, y }
      pos.setValue({ x, y })
      const a = activeRef.current
      const h = hit(x, y)
      setOverId(h && a && h.zone.accepts(a.kind, a.payload) ? h.id : null)
    },
    end: () => {
      const a = activeRef.current
      if (a) {
        const h = hit(point.current.x, point.current.y)
        if (h && h.zone.accepts(a.kind, a.payload)) h.zone.onDrop(a.payload, a.kind, { x: point.current.x, y: point.current.y })
      }
      activeRef.current = null
      setActive(null)
      setOverId(null)
    },
    overId,
  }

  return (
    <GoontehContext.Provider value={ctx}>
      {children}
      {active ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View style={{ position: 'absolute', transform: pos.getTranslateTransform() }}>{active.ghost}</Animated.View>
        </View>
      ) : null}
    </GoontehContext.Provider>
  )
}

function useCtx(): Ctx {
  const c = useContext(GoontehContext)
  if (!c) throw new Error('goonteh: <GoontehProvider> is required higher in the tree')
  return c
}

/** A draggable source. A drag begins after the touch moves past a small threshold. */
export function Grab({
  payload,
  kind,
  ghost,
  disabled,
  style,
  children,
}: {
  payload: unknown
  kind: string
  ghost: () => ReactNode
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const ctx = useCtx()
  const latest = useRef({ payload, ghost, disabled })
  latest.current = { payload, ghost, disabled }
  const started = useRef(false)

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled,
        onMoveShouldSetPanResponder: (_e, g) =>
          !latest.current.disabled && Math.hypot(g.dx, g.dy) > THRESHOLD,
        onPanResponderGrant: () => {
          started.current = false
        },
        onPanResponderMove: (_e, g) => {
          if (!started.current) {
            if (Math.hypot(g.dx, g.dy) < THRESHOLD) return
            started.current = true
            ctx.begin({ payload: latest.current.payload, kind, ghost: latest.current.ghost() }, g.moveX, g.moveY)
          } else {
            ctx.move(g.moveX, g.moveY)
          }
        },
        onPanResponderRelease: () => {
          if (started.current) ctx.end()
          started.current = false
        },
        onPanResponderTerminate: () => {
          if (started.current) ctx.end()
          started.current = false
        },
      }),
    [ctx, kind],
  )

  return (
    <View style={style} {...responder.panHandlers}>
      {children}
    </View>
  )
}

/** A drop target. `activeStyle` is applied while a compatible drag hovers over it. */
export function Drop({
  accepts,
  onDrop,
  style,
  activeStyle,
  children,
}: {
  accepts: (kind: string, payload: unknown) => boolean
  onDrop: (payload: unknown, kind: string, point: { x: number; y: number }) => void
  style?: StyleProp<ViewStyle>
  activeStyle?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const ctx = useCtx()
  const viewRef = useRef<View>(null)
  const zone = useRef<Zone>({ rect: null, accepts, onDrop })
  zone.current.accepts = accepts
  zone.current.onDrop = onDrop
  const id = useRef<number | null>(null)

  useEffect(() => {
    id.current = ctx.register(zone.current)
    return () => {
      if (id.current !== null) ctx.unregister(id.current)
    }
  }, [ctx])

  const measure = () => {
    viewRef.current?.measureInWindow((x, y, w, h) => {
      zone.current.rect = { x, y, w, h }
    })
  }
  const over = id.current !== null && ctx.overId === id.current

  return (
    <View ref={viewRef} onLayout={measure} style={[style, over ? activeStyle : null]}>
      {children}
    </View>
  )
}
