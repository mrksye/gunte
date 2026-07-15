# goonteh — Examples 🧤

Copy-paste recipes. Each is self-contained; adapt the styling to your app. For the full API see the [README](./README.md).

- [SolidJS: grab, drop, ghost](#solidjs-grab-drop-ghost)
- [Drag handle (only the handle drags)](#drag-handle-only-the-handle-drags)
- [Opt-out zones — `data-goonteh-nodrag` (resize handles)](#opt-out-zones--data-goonteh-nodrag-resize-handles)
- [Reorder **and** combine](#reorder-and-combine)
- [Reading the live drag](#reading-the-live-drag)
- [Typed payloads — decode at the boundary](#typed-payloads--decode-at-the-boundary)
- [Native (vanilla DOM)](#native-vanilla-dom)

---

## SolidJS: grab, drop, ghost

Wrap the tree once in a provider, then any `Grab` can drop into any accepting `Drop`.

```tsx
import { GoontehProvider, Grab, Drop } from 'goonteh/solid'

function Board() {
  return (
    <GoontehProvider>
      <Grab kind="card" payload={{ id: 'a1' }} ghost={() => <span class="chip">Card A1</span>}>
        <div class="card">Card A1</div>
      </Grab>

      <Drop
        accepts={(kind) => kind === 'card'}
        onDrop={(payload, kind, point) => console.log('dropped', payload, 'at', point)}
        activeClass="ring-2 ring-sky-400"
        class="lane"
      >
        drop here
      </Drop>
    </GoontehProvider>
  )
}
```

`ghost` is a snapshot taken at grab time and follows the pointer (it's `pointer-events: none`, so it never blocks hit-testing). `point` in `onDrop` is the drop position in client coordinates `{ x, y }`.

---

## Drag handle (only the handle drags)

Make the **handle itself** the `Grab`. The rest of the card is free for text selection, buttons, etc.

```tsx
<div class="card">
  <Grab kind="card" payload={{ id }} ghost={() => <span class="chip">{title}</span>}>
    <span class="handle" title="drag">⠿</span>
  </Grab>
  <div class="body">…selectable content, buttons…</div>
</div>
```

Nested `Grab`s resolve **innermost-wins**: a handle-grab inside a card-grab starts only the handle.

---

## Opt-out zones — `data-goonteh-nodrag` (resize handles)

The inverse of a drag handle: keep the **whole card** draggable, but carve out sub-regions that should act on their own. A pointerdown inside any element carrying `data-goonteh-nodrag` never starts a drag — perfect for resize handles, inline buttons, or sliders that live inside a draggable.

```tsx
<Grab kind="clip" payload={{ id }} ghost={() => <span class="chip">{title}</span>}>
  <div class="clip">
    {title}
    {/* Grabbing the body moves the clip; grabbing an edge resizes it. */}
    <span
      data-goonteh-nodrag
      class="resize-handle left"
      onPointerDown={(e) => startResize('l', e)}
    />
    <span
      data-goonteh-nodrag
      class="resize-handle right"
      onPointerDown={(e) => startResize('r', e)}
    />
  </div>
</Grab>
```

```ts
// A plain pointer-capture resize — goonteh stays out of its way thanks to data-goonteh-nodrag.
function startResize(edge: 'l' | 'r', e: PointerEvent) {
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  const startX = e.clientX
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => setWidthFromDelta(edge, ev.clientX - startX)
  const up = () => {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
```

Works in every adapter (and the raw core) — the check lives in the engine's pointerdown, so any framework benefits just by putting the attribute on the element.

---

## Reorder **and** combine

Show a different affordance depending on where within a target the pointer is (Android-launcher style: near an edge = reorder, over the middle = combine). Drive it from the live pointer.

```tsx
import { useGoonteh } from 'goonteh/solid'

function Slot(props: { id: string }) {
  const { active, point } = useGoonteh()
  const mode = () => {
    const p = point()
    if (!p || active()?.kind !== 'card') return 'idle'
    const r = slotEl.getBoundingClientRect()
    const frac = (p.y - r.top) / r.height
    return frac < 0.25 || frac > 0.75 ? 'reorder' : 'combine'
  }
  return (
    <Drop accepts={(k) => k === 'card'} onDrop={(payload) => apply(mode(), payload)}>
      <div ref={slotEl} classList={{ reorder: mode() === 'reorder', combine: mode() === 'combine' }}>
        {props.id}
      </div>
    </Drop>
  )
}
```

---

## Reading the live drag

`useGoonteh()` exposes reactive accessors for what's being dragged and where — use them for guides, snap lines, or cursor hints.

```tsx
const { dragging, active, point } = useGoonteh()

// e.g. a drop guide that follows the pointer while a 'card' is in the air
<Show when={dragging() && active()?.kind === 'card'}>
  <div class="guide" style={{ left: `${point()?.x ?? 0}px` }} />
</Show>
```

---

## Typed payloads — decode at the boundary

Payloads cross an untyped boundary. Don't assert (`payload as Card`) — **decode** and handle the "not my shape" case. With Effect `Schema`:

```ts
import { Schema } from '@effect/schema'
import { Option } from 'effect'

const Card = Schema.Struct({ id: Schema.String })

onDrop={(payload) => {
  const card = Schema.decodeUnknownOption(Card)(payload)
  if (Option.isNone(card)) return // not our shape — ignore
  place(card.value)
}}
```

Any validator works (zod, valibot, hand-written guard); the point is to decide explicitly at the drop.

---

## Native (vanilla DOM)

No framework — `goonteh/native` gives ghost-from-clone sugar over the core.

```ts
import { goonteh } from 'goonteh/native'

const g = goonteh()
g.grab(cardEl, { kind: 'card', payload: { id: cardEl.dataset.id } })
g.drop(laneEl, {
  accepts: (kind) => kind === 'card',
  onDrop: (payload, kind, point) => console.log(payload, point),
})
```

Opt-out zones still work: add `data-goonteh-nodrag` to any sub-element (e.g. a `<button>` inside the card) and its pointerdown won't start a drag.
