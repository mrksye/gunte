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
type Zone = { rect: Rect | undefined; accepts: (kind: string, payload: unknown) => boolean; onDrop: (payload: unknown, kind: string, point: { x: number; y: number }) => void }
type Active = { payload: unknown; kind: string; ghost: ReactNode }

type Ctx = {
  register: (z: Zone) => number
  unregister: (id: number) => void
  begin: (a: Active, x: number, y: number) => void
  move: (x: number, y: number) => void
  end: () => void
  overId: number | undefined
  active: Active | undefined
}

const GoontehContext = createContext<Ctx | null>(null)
const THRESHOLD = 5

/** Root provider. Create it once, above every `<Grab>`/`<Drop>`; it also renders the ghost overlay. */
export function GoontehProvider({ children }: { children: ReactNode }) {
  const zones = useRef(new Map<number, Zone>())
  const nextId = useRef(1)
  const pos = useRef(new Animated.ValueXY()).current
  const point = useRef({ x: 0, y: 0 })
  const activeRef = useRef<Active | undefined>(undefined)
  const [active, setActive] = useState<Active | undefined>(undefined)
  const [overId, setOverId] = useState<number | undefined>(undefined)

  const hit = (x: number, y: number): { id: number; zone: Zone } | undefined => {
    for (const [id, zone] of zones.current) {
      const r = zone.rect
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { id, zone }
    }
    return undefined
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
      setOverId(undefined)
    },
    move: (x, y) => {
      point.current = { x, y }
      pos.setValue({ x, y })
      const a = activeRef.current
      const h = hit(x, y)
      setOverId(h && a && h.zone.accepts(a.kind, a.payload) ? h.id : undefined)
    },
    end: () => {
      const a = activeRef.current
      if (a) {
        const h = hit(point.current.x, point.current.y)
        if (h && h.zone.accepts(a.kind, a.payload)) h.zone.onDrop(a.payload, a.kind, { x: point.current.x, y: point.current.y })
      }
      activeRef.current = undefined
      setActive(undefined)
      setOverId(undefined)
    },
    overId,
    active,
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

export type ActiveDrag = { kind: string; payload: unknown } | undefined

/** Live drag state. (This engine does not surface a reactive `point`; use a Drop's `activeStyle`.) */
export function useGoonteh(): { dragging: boolean; active: ActiveDrag } {
  const { active } = useCtx()
  return { dragging: !!active, active: active ? { kind: active.kind, payload: active.payload } : undefined }
}

/** The style a lifted source takes while dragged: a blank hole (kept space) or collapsed away. */
const liftStyle = (lift: 'hole' | 'collapse' | undefined, dragging: boolean): ViewStyle | undefined =>
  dragging && lift ? (lift === 'collapse' ? { display: 'none' } : { opacity: 0 }) : undefined

/** A draggable source. A drag begins after the touch moves past a small threshold. */
export function Grab({
  payload,
  kind,
  ghost,
  disabled,
  lift,
  style,
  children,
}: {
  payload: unknown
  kind: string
  ghost: () => ReactNode
  disabled?: boolean
  /** 'hole' (blank gap via opacity, keeps space) or 'collapse' (removed from layout). */
  lift?: 'hole' | 'collapse'
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const ctx = useCtx()
  const latest = useRef({ payload, ghost, disabled })
  latest.current = { payload, ghost, disabled }
  const started = useRef(false)
  const [dragging, setDragging] = useState(false)

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
            setDragging(true)
            ctx.begin({ payload: latest.current.payload, kind, ghost: latest.current.ghost() }, g.moveX, g.moveY)
          } else {
            ctx.move(g.moveX, g.moveY)
          }
        },
        onPanResponderRelease: () => {
          if (started.current) ctx.end()
          started.current = false
          setDragging(false)
        },
        onPanResponderTerminate: () => {
          if (started.current) ctx.end()
          started.current = false
          setDragging(false)
        },
      }),
    [ctx, kind],
  )

  return (
    <View style={[style, liftStyle(lift, dragging)]} {...responder.panHandlers}>
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
  const zone = useRef<Zone>({ rect: undefined, accepts, onDrop })
  zone.current.accepts = accepts
  zone.current.onDrop = onDrop
  const id = useRef<number | undefined>(undefined)

  useEffect(() => {
    id.current = ctx.register(zone.current)
    return () => {
      if (id.current !== undefined) ctx.unregister(id.current)
    }
  }, [ctx])

  const measure = () => {
    viewRef.current?.measureInWindow((x, y, w, h) => {
      zone.current.rect = { x, y, w, h }
    })
  }
  const over = id.current !== undefined && ctx.overId === id.current

  return (
    <View ref={viewRef} onLayout={measure} style={[style, over ? activeStyle : null]}>
      {children}
    </View>
  )
}
