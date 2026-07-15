# goonteh 🧤🧤

**Drag and drop for places without a build step.** Four tiny APIs. One pair of gloves.

Pointer-based, works on **touch**, and never shows the **no-drop (🚫) cursor** — and small enough to run where a framework can't: one `<script>` tag, even inside a Google Apps Script `HtmlService` page.

*Pronounced "goon-teh" — the name respells 軍手, Japanese for work gloves.*

goonteh was born on a construction-site scheduling app, where dragging heavy machinery had to work on Linux and touch. Native HTML5 drag-and-drop couldn't: `dragstart` never fires on touch, and on some platforms (Chromium on Linux) the "no-drop" cursor sticks even over a valid target, un-overridable by CSS. Bare hands slip — so put a glove on. goonteh reimplements drag-and-drop on **pointer events** (mouse, touch, and pen alike), with the cursor and drop highlight **fully yours in CSS**.

## A primitive, not a framework

If [dnd-kit](https://dndkit.com) is the general contractor for the whole site — sortable models, collision detection, keyboard sensors, an accessibility layer — goonteh is the **work gloves** you're handed on it: tiny, and the thing you reach for when all you want is *pick it up and put it down*. No sortable model, no collision strategy, no reorder baked in — you keep those; goonteh just does the gripping.

Four words, each keeping its exact technical meaning and each a move you already know from the yard:

- **`GoontehProvider`** — the gloves are handed out (one drag context)
- **`Grab`** — you grip a thing (a drag source)
- **`Lift`** — you pick it up (the source leaves a blank hole, or the gap collapses)
- **`Drop`** — you set it down (a drop target)

## Runs where a framework can't — Google Apps Script, plain HTML, CDN

No build step, no `npm install`, no bundler. The framework-free core also ships as a single self-contained IIFE that puts a `goonteh` global on `window` — one `<script>` and you're gripping:

```html
<script src="https://unpkg.com/goonteh@1.0.0"></script>
<script>
  const gloves = goonteh()
  gloves.grab(document.getElementById('card'), { kind: 'card', payload: { id: 'a1' } })
  gloves.drop(document.getElementById('lane'), {
    accepts: (kind) => kind === 'card',
    onDrop: (payload) => console.log('dropped', payload),
  })
</script>
```

The standout: this runs inside a **Google Apps Script `HtmlService`** page — a sandboxed iframe with no bundler and no `npm install`, where heavier drag-and-drop frameworks can't go. Serve it from `unpkg` / `jsdelivr`, or paste `dist/goonteh.global.js` straight into your HTML. A pair of work gloves fits anywhere.

## Frameworks

```sh
npm i goonteh
```

Thin adapters wrap the same core — install only the framework you use (each is an optional peer dependency); the core itself needs nothing.

| Import | Framework |
| --- | --- |
| `goonteh` / `goonteh/core` | Framework-agnostic engine (vanilla TS + DOM) |
| `goonteh/native` | Vanilla DOM sugar (`grab` / `drop`, ghost-from-clone) |
| `goonteh/solid` | SolidJS — `<GoontehProvider>`, `<Grab>`, `<Drop>`, `useGoonteh` |
| `goonteh/react` | React ≥ 18 |
| `goonteh/vue` | Vue ≥ 3.2 |
| `goonteh/svelte` | Svelte ≥ 4 (`grab` / `drop` actions + a `drag` store) |
| `goonteh/react-native` | React Native (**experimental** — its own PanResponder engine, not covered by the web-core guarantees) |

Solid, for example:

```tsx
import { GoontehProvider, Grab, Drop } from 'goonteh/solid'

<GoontehProvider>
  <Grab payload={{ color: 'red' }} kind="swatch" ghost={() => <div class="ghost">red</div>}>
    <button>red</button>
  </Grab>
  <Drop accepts={(k) => k === 'swatch'} onDrop={(p) => console.log(p)} activeClass="ring">
    drop here
  </Drop>
</GoontehProvider>
```

A drag starts only after the pointer crosses a ~5px threshold, so a plain click still reaches the child.

> 📖 **[EXAMPLES.md](./EXAMPLES.md)** — copy-paste recipes for every adapter (React / Vue / Svelte / native / React Native), reorder-and-combine, drag handles, opt-out zones, and typed payloads.

## Lift, live drag, typed payloads

- **Lift** — `lift="hole"` (hidden in place; the box keeps its space, so no reflow) or `lift="collapse"` (siblings close the gap) on a `Grab` makes the source look genuinely picked up. goonteh never reflows mid-drag; you reorder on **drop**.
- **Read the live drag** — `useGoonteh()` (or the core's `active()` / `point()`) tells you *what* is being dragged and *where* the pointer is, so you can preview reorder-vs-combine yourself.
- **Typed payloads** — `payload` is `unknown` on purpose; goonteh picks no error model. **Decode** at the drop boundary (Effect `Schema`, `neverthrow`, a plain guard) rather than asserting.

## API (core)

`createGoontehCore(config?)` → engine. `config`: `{ threshold?, cursor?, ghostOffset? }`.

- `draggable(el, { payload, kind, ghost?, disabled?, lift?, onEnd? })` → cleanup `() => void`
- `dropzone(el, { accepts, onDrop })` → `{ isOver(), destroy() }`; `onDrop(payload, kind, point)`; the innermost **accepting** zone wins
- `dragging()` · `active()` · `point()` · `onChange(fn)` → unsubscribe · `destroy()`

A pointerdown inside a `data-goonteh-nodrag` element never starts a drag (resize handles, inline buttons); nested grabs resolve **innermost-wins**. The DOM adapters mirror all of this — a `lift` option on the grab and a `useGoonteh` for the live drag.

## Status

The web core is stable and pinned by real-browser (Playwright, Chromium/Linux) tests: pointer-id tracking, cancel, exception-safe teardown, and clean `destroy()`. It ships a prebuilt `dist` (ESM + `.d.ts` + a `<script>` IIFE) alongside TS source for the framework adapters. The React Native adapter is **experimental** and outside the web-core guarantees.

## Contributing · License

Found a bug? Please **open an issue first** — see [CONTRIBUTING.md](./CONTRIBUTING.md). MIT © mrksye.
