/**
 * The page-context contract (TODO.ai-platform/02) — how a host page tells
 * the assistant panel what it IS and what it CARRIES, and how that
 * declaration travels to the AI service.
 *
 * CONTEXT IS OPT-IN, NEVER AMBIENT (the owner's approved decision): the
 * panel opens on "None", the user taps a chip per message, and nothing
 * the user didn't pick ever rides a message.
 *
 * The seam, one tiny surface:
 *
 *   - A page (or the shell, which knows the route) calls
 *     `publishAiContext({ page, entity })` — on mount and whenever the
 *     route or the loaded entity changes — and `publishAiContext(null)`
 *     when it has nothing to say. The helper mirrors the payload onto
 *     `<html data-ai-context="…">` (the current truth, readable by a
 *     late-hydrating panel) AND dispatches the `oimlsmart:ai-context`
 *     window event (live updates to a mounted panel). The attribute is
 *     the contract's persistence; the event is its freshness.
 *   - The panel reads the attribute when it opens and listens for the
 *     event while mounted. A page that publishes nothing simply offers
 *     "This page" (named from the document title) + "A document…" +
 *     "None" — the entity chip appears only when an entity is published
 *     (the chips degrade honestly: no entity in view → no entity chip).
 *
 * The wire shape the panel sends to the service (`POST /api/ask`, the
 * `context` field) and the echo it gets back (`context_applied`) are the
 * rag repo's contract (docs/API.md §2.1.1 there); the types below are the
 * panel-side mirror.
 */

/** The entity a page carries, as the page publishes it. */
export interface AiEntityRef {
  /** 'certificate' | 'application' | 'report' | 'sample' | … (display) */
  kind: string
  /** the platform's entity id (routing, not display) */
  id?: string
  /** the display label — the certificate number, the application ref… */
  label: string
  /** the governing publication, when the model carries the provenance:
   *  the URN (urn:oiml:pub:r:60-1:2021) or the plain docidentifier */
  doc?: string
  edition?: string
}

/** What a page publishes: its plain name, and the entity it carries. */
export interface AiPageContext {
  /** the route's plain name — "the IA console", "the product passport" */
  page?: string
  entity?: AiEntityRef
}

export const AI_CONTEXT_EVENT = 'oimlsmart:ai-context'
export const AI_CONTEXT_ATTR = 'data-ai-context'

function cleanEntity(e: AiEntityRef): AiEntityRef | null {
  const label = typeof e?.label === 'string' ? e.label.trim().slice(0, 120) : ''
  const kind = typeof e?.kind === 'string' ? e.kind.trim().slice(0, 40) : ''
  if (!label || !kind) return null
  const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 200) : undefined
  const doc = typeof e.doc === 'string' && e.doc.trim() ? e.doc.trim().slice(0, 80) : undefined
  const edition = typeof e.edition === 'string' && /^\d{4}$/.test(e.edition.trim()) ? e.edition.trim() : undefined
  return { kind, label, ...(id ? { id } : {}), ...(doc ? { doc } : {}), ...(edition ? { edition } : {}) }
}

function cleanContext(ctx: AiPageContext | null): AiPageContext | null {
  if (!ctx || typeof ctx !== 'object') return null
  const page = typeof ctx.page === 'string' && ctx.page.trim() ? ctx.page.trim().slice(0, 120) : undefined
  const entity = ctx.entity ? cleanEntity(ctx.entity) : null
  if (!page && !entity) return null
  return { ...(page ? { page } : {}), ...(entity ? { entity } : {}) }
}

/** Publish the page's context: the `<html>` attribute mirror + the window
 *  event. Pass null (or call with nothing to say) to clear. Publishers
 *  should re-publish on every route/entity change — the panel never polls. */
export function publishAiContext(ctx: AiPageContext | null): void {
  if (typeof document === 'undefined') return
  const clean = cleanContext(ctx)
  if (clean) document.documentElement.setAttribute(AI_CONTEXT_ATTR, JSON.stringify(clean))
  else document.documentElement.removeAttribute(AI_CONTEXT_ATTR)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_CONTEXT_EVENT, { detail: clean }))
  }
}

/** Read the currently published context (the attribute mirror). */
export function readPublishedContext(): AiPageContext | null {
  if (typeof document === 'undefined') return null
  const raw = document.documentElement.getAttribute(AI_CONTEXT_ATTR)
  if (!raw) return null
  try {
    return cleanContext(JSON.parse(raw))
  } catch {
    return null
  }
}

// ── the ask-side wire shapes (the rag service's contract, mirrored) ──

/** The declaration the panel sends on POST /api/ask. */
export interface AiAskContext {
  kind: 'page' | 'entity' | 'document' | 'account'
  label: string
  route?: string
  doc?: string
  edition?: string
}

/** The account context's live-read echo (TODO.ai-platform/03): when the
 *  live data was read, which stores answered, how many records grounded
 *  the answer. Present only on a successful read. */
export interface AiLiveEcho {
  read_at: string
  stores: string[]
  records: number
}

/** What the service actually applied (the `context_applied` echo). */
export interface AiContextApplied {
  kind: 'page' | 'entity' | 'document' | 'account' | 'none'
  label?: string
  /** the publication the declaration actually scoped retrieval to */
  scoped_to?: string | null
  /** why a doc-carrying declaration did not scope the answer — or, for
   *  the account kind, why the live data was NOT read */
  note?: 'document-not-in-corpus' | 'question-document-wins' | 'sign-in-required' | 'live-window-expired' | 'live-unavailable'
  /** the account kind's live read (when it happened) */
  live?: AiLiveEcho
}

/** The honest context line — rendered on EVERY answer, computed from the
 *  service's echo (never from what the panel wished to send). Absent echo
 *  → none (the service cannot have grounded in a context it wasn't told). */
export function contextLine(a: AiContextApplied | null | undefined): string {
  if (!a || a.kind === 'none') return 'context: none (general corpus)'
  const label = (a.label ?? '').trim()
  let base: string
  if (a.kind === 'page') base = `context: this page${label ? ` — ${label}` : ''}`
  else if (a.kind === 'entity') base = `context: ${label || 'this entity'}`
  else if (a.kind === 'account') {
    // TODO.ai-platform/03 — the live-data line says WHEN the account was
    // read (never silently), or why it was not.
    if (a.live) {
      const at = new Date(a.live.read_at)
      const when = Number.isNaN(at.getTime()) ? '' : `, read ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      base = `context: my account (live${when}) — ${a.live.records} record${a.live.records === 1 ? '' : 's'}`
    } else if (a.note === 'sign-in-required') base = 'context: my account (not read — sign in first)'
    else if (a.note === 'live-window-expired') base = 'context: my account (not read — the live window lapsed; sign in again to refresh)'
    else if (a.note === 'live-unavailable') base = 'context: my account (not read — the live read was unavailable)'
    else base = 'context: my account (not read)'
  } else base = `context: ${label || 'a document'}`
  if (a.note === 'document-not-in-corpus') base += ' (not in the corpus — the general corpus answered)'
  else if (a.note === 'question-document-wins') base += ' (the question named a publication — it scoped the answer)'
  return base
}
