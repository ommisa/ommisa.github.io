/**
 * The draft acts (TODO.ai-platform/04) — the act-with-confirmation wave's
 * panel half. The AI service PREPARES an act (the application prefill is
 * the pilot); the panel renders the draft card; the user's click hands
 * the draft to the HOST's real form — the commit is the user's own click
 * there, through the platform's own write path. The AI never holds a
 * write credential and neither does the panel: the draft rides the DOM
 * event seam to the host, never a write API.
 *
 * The seam, one tiny surface (the mirror of src/ai/context.ts):
 *
 *   - The panel dispatches `oimlsmart:ai-draft` with the draft payload
 *     when the user taps "Open in the form".
 *   - A host that understands drafts (the SMART platform's ai-drafts
 *     module) validates the payload, stores it for the form, answers
 *     with `oimlsmart:ai-draft-ack` ({ accepted: true }) and navigates.
 *     A refusal answers { accepted: false, reason } and the panel says
 *     so honestly; a host that never answers (a property without the
 *     draft seam) times out to the same honest note.
 *
 * The wire shape is the rag repo's contract (docs/API.md §2.1.3 there);
 * the types below are the panel-side mirror.
 */

/** The pilot act's fields — the application prefill. Every field is a
 *  value the USER stated in the conversation (the service's
 *  traceability guard dropped everything else); the instrument model's
 *  derivations never ride the draft (the real form derives them on
 *  open). */
export interface AiDraftFields {
  /** the Recommendation, as the publication URN (urn:oiml:pub:r:60:2021) */
  standard_doc: string
  standard_label?: string
  family_designation?: string
  group_label?: string
  model_designation?: string
  description?: string
  samples?: { serial: string; condition?: string }[]
  scheme?: 'A' | 'B'
}

export interface AiDraftDrop {
  field: string
  value: string
  reason: string
}

export interface AiDraft {
  kind: 'draft'
  act: 'application_prefill'
  version: 1
  title: string
  prepared_at: string
  /** ALWAYS true — the draft is an input to the real form, never a
   *  channel; the user's own click is the only commit. */
  requires_confirmation: true
  fields: AiDraftFields
  dropped?: AiDraftDrop[]
  notes?: string[]
}

export const AI_DRAFT_EVENT = 'oimlsmart:ai-draft'
export const AI_DRAFT_ACK_EVENT = 'oimlsmart:ai-draft-ack'

export interface AiDraftAck {
  accepted: boolean
  reason?: string
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Validate a draft arriving from the service — bounded, shape-checked,
 *  never trusted blindly (the card renders from THIS, and the host
 *  re-validates before the form sees it). Garbage degrades to null. */
export function asDraft(v: unknown): AiDraft | null {
  if (!v || typeof v !== 'object') return null
  const d = v as Record<string, unknown>
  if (d.kind !== 'draft' || d.act !== 'application_prefill' || d.version !== 1) return null
  if (d.requires_confirmation !== true) return null
  const title = str(d.title, 160)
  const preparedAt = str(d.prepared_at, 40)
  const f = d.fields as Record<string, unknown> | undefined
  const standardDoc = str(f?.standard_doc, 80)
  if (!title || !preparedAt || !f || !standardDoc) return null
  const fields: AiDraftFields = { standard_doc: standardDoc }
  const standardLabel = str(f.standard_label, 120)
  if (standardLabel) fields.standard_label = standardLabel
  for (const key of ['family_designation', 'group_label', 'model_designation', 'description'] as const) {
    const val = str(f[key], 300)
    if (val) fields[key] = val
  }
  if (f.scheme === 'A' || f.scheme === 'B') fields.scheme = f.scheme
  if (Array.isArray(f.samples)) {
    const samples = f.samples
      .slice(0, 12)
      .map((s) => {
        const serial = str((s as Record<string, unknown>)?.serial, 80)
        if (!serial) return null
        const condition = str((s as Record<string, unknown>)?.condition, 20)
        return condition ? { serial, condition } : { serial }
      })
      .filter((s): s is { serial: string; condition?: string } => s !== null)
    if (samples.length) fields.samples = samples
  }
  const dropped = Array.isArray(d.dropped)
    ? d.dropped
        .slice(0, 12)
        .map((x) => {
          const field = str((x as Record<string, unknown>)?.field, 60)
          const value = str((x as Record<string, unknown>)?.value, 120)
          const reason = str((x as Record<string, unknown>)?.reason, 120)
          return field && value && reason ? { field, value, reason } : null
        })
        .filter((x): x is AiDraftDrop => x !== null)
    : undefined
  const notes = Array.isArray(d.notes)
    ? d.notes.map((n) => str(n, 300)).filter((n): n is string => !!n).slice(0, 6)
    : undefined
  return {
    kind: 'draft',
    act: 'application_prefill',
    version: 1,
    title,
    prepared_at: preparedAt,
    requires_confirmation: true,
    fields,
    ...(dropped?.length ? { dropped } : {}),
    ...(notes?.length ? { notes } : {}),
  }
}

/** A one-line field summary for the card (the honest "what the draft
 *  carries"). Skips absent fields. */
export function draftFieldLines(draft: AiDraft): string[] {
  const f = draft.fields
  const lines: string[] = [`the Recommendation: ${f.standard_label ?? f.standard_doc}`]
  if (f.family_designation) lines.push(`the instrument family: ${f.family_designation}`)
  if (f.group_label) lines.push(`the instrument group: ${f.group_label}`)
  if (f.model_designation) lines.push(`the model designation: ${f.model_designation}`)
  if (f.description) lines.push(`the description: ${f.description}`)
  if (f.scheme) lines.push(`scheme ${f.scheme}`)
  if (f.samples?.length) lines.push(`${f.samples.length} sample${f.samples.length === 1 ? '' : 's'}: ${f.samples.map((s) => s.serial).join(', ')}`)
  return lines
}

/**
 * Hand the draft to the host's real form: dispatch the event, wait for
 * the host's ack (bounded). Resolves the ack; a host without the draft
 * seam answers nothing and the caller gets the timeout refusal — the
 * card says so honestly rather than pretending a hand-off.
 */
export function dispatchAiDraft(draft: AiDraft, timeoutMs = 4000): Promise<AiDraftAck> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ accepted: false, reason: 'no-window' })
      return
    }
    let settled = false
    const finish = (ack: AiDraftAck) => {
      if (settled) return
      settled = true
      window.removeEventListener(AI_DRAFT_ACK_EVENT, onAck)
      clearTimeout(timer)
      resolve(ack)
    }
    const onAck = (e: Event) => {
      const detail = (e as CustomEvent).detail
      finish({ accepted: detail?.accepted === true, ...(typeof detail?.reason === 'string' ? { reason: detail.reason.slice(0, 200) } : {}) })
    }
    const timer = setTimeout(() => finish({ accepted: false, reason: 'no-host' }), timeoutMs)
    window.addEventListener(AI_DRAFT_ACK_EVENT, onAck)
    window.dispatchEvent(new CustomEvent(AI_DRAFT_EVENT, { detail: draft }))
  })
}
