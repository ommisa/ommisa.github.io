<script setup lang="ts">
/**
 * AiBubble — the OIML SMART AI assistant in the shared chrome
 * (TODO.ai-platform/01). ONE component, mounted either by SiteHeader
 * (mode="chrome": the header icon row at lg+, a floating button below)
 * or standalone by a property with its own chrome (mode="standalone":
 * the floating button at every breakpoint — the smart platform's mount).
 *
 * The component is HOST-INDEPENDENT by construction: every color rides
 * an --ai-* custom property that prefers the shell token when the host
 * carries tokens.css and falls back to the house value when it does not
 * (the platform has its own palette). All layout is plain CSS in the
 * unscoped block below — no host Tailwind utilities are required to
 * exist (a host build never scans this package's sources unless it
 * @sources them, and non-shell hosts must not need to).
 *
 * The API contract is discovered from the rag repo's worker_public
 * (docs/API.md there; the client is src/ai/client.ts):
 *   POST {apiBase}/api/ask            — SSE citations/token/done (or JSON)
 *   GET/POST/PATCH/DELETE {apiBase}/api/conversations[...] — members
 *   GET  {apiBase}/auth/me            — the session check
 *   GET  {apiBase}/auth/login?mode=bubble&origin=… — the sign-in bridge
 * Anonymous callers get the public/anonymous tier, honestly marked;
 * their history stays on the device (localStorage), never synced.
 *
 * TODO.ai-platform/02 (the `contextChips` prop, default off until the
 * wave's eval legs are green): the opt-in context chips above the
 * composer — This page / This entity (only when the page publishes one)
 * / A document… / None (the default; the panel opens here). The pages
 * publish their context through src/ai/context.ts (the attribute mirror
 * + the window event — the documented seam). The declaration rides the
 * ask; the service's context_applied echo renders as the honest context
 * line on EVERY answer, so the line never invents a grounding.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  appendMessage,
  ask,
  clearStoredSession,
  createConversation,
  deleteConversation,
  fetchMe,
  getConversation,
  listConversations,
  loadLocalConversations,
  loadStoredSession,
  openBubbleSignIn,
  saveLocalConversations,
  storeSession,
  type AiCitation,
  type AiLiveRecord,
  type AiMessage,
  type AiQuota,
  type AiSession,
} from '../ai/client'
import {
  AI_CONTEXT_EVENT,
  contextLine,
  readPublishedContext,
  type AiAskContext,
  type AiContextApplied,
  type AiPageContext,
} from '../ai/context'
import { dispatchAiDraft, draftFieldLines, type AiDraft } from '../ai/drafts'
import { renderMarkdownLite } from '../ai/markdown'
// The AI service origin is injected: the apiBase prop is REQUIRED — the
// package ships no service origins (SiteHeader resolves it from the
// consumer's ServicesRegistry when the mount relies on the registry).

interface Props {
  /** The AI service origin — required; the package ships no default. */
  apiBase: string
  /** chrome = mounted inside SiteHeader's icon row (icon at lg+, FAB
   *  below); standalone = the floating button at every breakpoint. */
  mode?: 'chrome' | 'standalone'
  /** BCP-47 two-letter hint for the answer language (the corpus carries 10). */
  lang?: string
  /** The FAB's bottom offset (CSS length) — a host with its own
   *  bottom-right affordance (the platform's Reference pill) lifts the
   *  launcher clear of it. */
  fabBottom?: string
  /** TODO.ai-platform/02: the opt-in context chips + the honest context
   *  line. Off by default until the wave's eval legs are green — a
   *  property opts in via its mount flag. */
  contextChips?: boolean
  /** TODO.ai-platform/03: the "my account" chip — the member's OWN live
   *  platform data, read by the AI service AS the user through the RFC
   *  8693 session delegation (the cones bind exactly; the context line
   *  says when the live data was read). Members only, flag-gated, off by
   *  default. */
  accountChip?: boolean
  /** TODO.ai-platform/04: the draft acts — the service PREPARES an act
   *  (the application prefill is the pilot), the panel renders the draft
   *  card, and the user's click hands it to the host's real form through
   *  the DOM seam (src/ai/drafts.ts). The panel never writes; the commit
   *  is the user's own click in the form. Flag-gated, off by default. */
  draftActs?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  mode: 'standalone',
  fabBottom: '1rem',
  contextChips: false,
  accountChip: false,
  draftActs: false,
})

const open = ref(false)
// The panel is a non-modal CARD on desktop, but a full-screen SHEET on
// small viewports (body scroll locked, page covered) — there it must be
// announced modal and Tab must not escape behind it.
const isSheet = ref(false)
let sheetMq: MediaQueryList | null = null
const syncSheet = () => { isSheet.value = !!sheetMq?.matches }
const panelEl = ref<HTMLElement | null>(null)

function onPanelKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !isSheet.value || !panelEl.value) return
  // :not([disabled]) — focus() on a disabled control is a silent no-op,
  // which would strand focus on the wrap source (the empty-draft Send)
  const focusables = panelEl.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = !!active && panelEl.value.contains(active)
  if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus() }
}
// Teleport-in-island hydration: the SSR render and the client's first
// render must agree (the teleport anchor is lossy through Astro's SSR),
// so the body-teleported subtree exists only after mount.
const hydrated = ref(false)
const view = ref<'chat' | 'sessions'>('chat')
const session = ref<AiSession | null>(null)
const accountName = ref<string | null>(null)
const signingIn = ref(false)

interface Conversation {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}
const conversations = ref<Conversation[]>([])
const activeId = ref<string | null>(null)
const messages = ref<AiMessage[]>([])
const streaming = ref(false)
const pendingText = ref('')
const pendingCitations = ref<AiCitation[]>([])
const errorText = ref<string | null>(null)
const quota = ref<AiQuota | null>(null)
const followUps = ref<string[]>([])
const statusLine = ref('')
/** conversation_id for the service's cross-turn entity memory — the
 *  server id for members, a stable random local id for anonymous. */
const memoryId = ref<string | null>(null)

// ── the context chips (TODO.ai-platform/02) ──
// Opt-in, never ambient: the selection defaults to 'none' (the panel
// opens here) and rides ONE message at a time — sticky for convenience,
// changeable mid-session, never a session-level lock-in. The page
// publishes what it is + what it carries through src/ai/context.ts; a
// page publishing nothing offers This page (named from the document
// title) + A document… + None. No entity in view → no entity chip.
const published = ref<AiPageContext | null>(null)
const chip = ref<'none' | 'page' | 'entity' | 'document' | 'account'>('none')
const docPick = ref('')
const pickerOpen = ref(false)
const pickerDraft = ref('')
/** the context_applied echo for the answer currently streaming */
const pendingApplied = ref<AiContextApplied | undefined>(undefined)
/** the live records for the answer currently streaming (TODO.ai-platform/03) */
const pendingRecords = ref<AiLiveRecord[] | undefined>(undefined)
/** the prepared act for the answer currently streaming (TODO.ai-platform/04) */
const pendingDraftAct = ref<AiDraft | undefined>(undefined)
/** per-message draft hand-off state: the card's own honest status */
const draftHandoff = ref<Record<string, 'sending' | 'opened' | 'refused'>>({})

/** Hand the draft to the host's real form (TODO.ai-platform/04): the DOM
 *  seam carries it (never a write API); the card reports the host's ack
 *  honestly. The panel itself never holds a credential — the commit is
 *  the user's own click inside the form. */
async function openDraftInForm(messageId: string, draft: AiDraft) {
  if (draftHandoff.value[messageId] === 'sending') return
  draftHandoff.value = { ...draftHandoff.value, [messageId]: 'sending' }
  statusLine.value = 'Handing the draft to the form.'
  const ack = await dispatchAiDraft(draft)
  if (ack.accepted) {
    draftHandoff.value = { ...draftHandoff.value, [messageId]: 'opened' }
    statusLine.value = 'The draft is open in the form — review it and confirm there.'
    // the form has it now: the panel steps out of the way
    if (open.value) togglePanel()
  } else {
    draftHandoff.value = { ...draftHandoff.value, [messageId]: 'refused' }
    statusLine.value = 'This page could not open the draft.'
  }
}

/** The card's honest footer per state (the refusal names the way out). */
function draftHandoffNote(state?: 'sending' | 'opened' | 'refused'): string {
  if (state === 'sending') return 'Handing the draft to the form…'
  if (state === 'opened') return 'Opened in the form — review every field; only your own confirmation submits.'
  if (state === 'refused') return 'This page could not open the draft — open the platform’s application wizard and ask again from there.'
  return ''
}

const entityRef = computed(() => published.value?.entity ?? null)
const pageLabel = computed(
  () =>
    published.value?.page?.trim() ||
    (typeof document !== 'undefined' ? document.title.replace(/\s*[|–—-]\s*OIML.*$/, '').trim() : '') ||
    'this page',
)
const pageChipLabel = computed(() => `This page — ${pageLabel.value}`)
const entityChipLabel = computed(() => (entityRef.value ? `This ${entityRef.value.kind} — ${entityRef.value.label}` : ''))

watch(entityRef, (e) => {
  // the chips degrade honestly: the entity left the view → the selection
  // can't dangle on an entity that isn't there
  if (!e && chip.value === 'entity') chip.value = 'none'
})

function onContextEvent(e: Event) {
  published.value = ((e as CustomEvent).detail ?? null) as AiPageContext | null
}

function selectChip(next: 'none' | 'page' | 'entity' | 'document' | 'account') {
  if (next === 'document') {
    if (chip.value === 'document') {
      chip.value = 'none' // tap again drops the pick
      return
    }
    pickerDraft.value = docPick.value
    pickerOpen.value = true
    return
  }
  pickerOpen.value = false
  chip.value = chip.value === next ? 'none' : next // tap includes, tap drops
}

function pickDocument() {
  const v = pickerDraft.value.trim()
  if (!v) return
  docPick.value = v.slice(0, 80)
  pickerOpen.value = false
  chip.value = 'document'
}

/** The declaration for the NEXT message — built at send time so what
 *  rides is what the page publishes at that moment. */
function currentAskContext(): AiAskContext | undefined {
  if (!props.contextChips) return undefined
  // the account chip (TODO.ai-platform/03): the member's own live data —
  // the honest label rides the declaration; the service reads exactly
  // what the user can see, and the echo says when it did
  if (chip.value === 'account') return { kind: 'account', label: 'my account' }
  if (chip.value === 'page') return { kind: 'page', label: pageLabel.value, route: window.location.pathname }
  if (chip.value === 'entity' && entityRef.value) {
    const e = entityRef.value
    return {
      kind: 'entity',
      label: `this ${e.kind} ${e.label}`,
      route: window.location.pathname,
      ...(e.doc ? { doc: e.doc } : {}),
      ...(e.edition ? { edition: e.edition } : {}),
    }
  }
  if (chip.value === 'document' && docPick.value.trim()) {
    return { kind: 'document', label: docPick.value.trim(), doc: docPick.value.trim() }
  }
  return undefined
}

/** The honest context line for an answer: the service's echo when it
 *  came, the explicit not-applied marker when a declaration went to a
 *  service that predates contexts, else none. Never silent, never a
 *  guess. (Answers recorded before the chips carry no echo — none is
 *  TRUE for them: no declaration existed.) */
function lineFor(m: AiMessage): string {
  if (m.contextApplied) return contextLine(m.contextApplied)
  if (m.contextUnapplied) return 'context: not applied — the AI service does not support contexts yet'
  return contextLine(null)
}

const draft = ref('')
const composer = ref<HTMLTextAreaElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const launcherIcon = ref<HTMLButtonElement | null>(null)
const launcherFab = ref<HTMLButtonElement | null>(null)
let abort: AbortController | null = null

const isMember = computed(() => !!session.value)

watch(isMember, (m) => {
  // the account chip is member-only: a sign-out mid-selection drops it
  // honestly (never a dangling declaration the service would refuse)
  if (!m && chip.value === 'account') chip.value = 'none'
})
const activeTitle = computed(() => conversations.value.find((c) => c.id === activeId.value)?.title ?? '')
const quotaLine = computed(() => {
  if (!quota.value || isMember.value) return ''
  const left = Math.max(0, quota.value.limit - quota.value.used)
  return left <= 5 ? `${left} anonymous questions left today` : ''
})

function renderMd(text: string): string {
  return renderMarkdownLite(text)
}

function citationLabel(c: AiCitation): string {
  const doc = c.docidentifier ?? c.doc_id ?? 'Source'
  return c.edition ? `${doc} (${c.edition})` : doc
}

/** A citation renders as a link only for http(s) URLs — the same policy
 *  markdown.ts imposes on model-emitted links. Anything else (a
 *  compromised service echoing javascript:) renders as plain text. */
function citationUrl(c: AiCitation): string | undefined {
  return typeof c.url === 'string' && /^https?:\/\//i.test(c.url) ? c.url : undefined
}

function citationStatus(c: AiCitation): string | null {
  if (c.status === 'in-force' || c.status === 'joint') return null
  if (c.superseded_by) return `Superseded by ${c.superseded_by}`
  if (c.status && c.status !== 'unknown') return c.status
  return null
}

// ── persistence ──

function persistLocal() {
  if (isMember.value) return
  const locals = loadLocalConversations()
  const rest = locals.filter((c) => c.id !== activeId.value)
  if (activeId.value) {
    const meta = conversations.value.find((c) => c.id === activeId.value)
    rest.unshift({
      id: activeId.value,
      title: meta?.title ?? 'Untitled conversation',
      updatedAt: Date.now(),
      messages: messages.value,
    })
  }
  saveLocalConversations(rest)
}

async function refreshConversations() {
  if (session.value) {
    const list = await listConversations(props.apiBase, session.value.token)
    if (list === null) return // unreachable — keep the current view
    conversations.value = list
  } else {
    conversations.value = loadLocalConversations().map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }))
  }
}

// ── session ──

async function adoptSession(next: AiSession | null) {
  session.value = next
  accountName.value = next?.name ?? null
  if (next) {
    storeSession(props.apiBase, next)
    const me = await fetchMe(props.apiBase, next.token)
    if (me?.authenticated) accountName.value = me.name ?? me.email
    if (me && !me.authenticated) {
      // the stored token failed server-side — drop it honestly
      session.value = null
      accountName.value = null
      clearStoredSession()
    }
  }
  await refreshConversations()
}

async function signIn() {
  if (signingIn.value) return
  signingIn.value = true
  try {
    const next = await openBubbleSignIn(props.apiBase)
    if (next) await adoptSession(next)
  } finally {
    signingIn.value = false
  }
}

async function signOut() {
  // The token is stateless (no server-side revocation); signing out is
  // discarding it here. The ai.oimlsmart.org cookie session is the
  // service's own property — untouched.
  clearStoredSession()
  session.value = null
  accountName.value = null
  newConversation()
  await refreshConversations()
}

// ── conversations ──

function newConversation() {
  activeId.value = null
  memoryId.value = null
  messages.value = []
  followUps.value = []
  errorText.value = null
  view.value = 'chat'
  nextTick(() => composer.value?.focus())
}

async function resumeConversation(id: string) {
  errorText.value = null
  if (session.value) {
    const conv = await getConversation(props.apiBase, session.value.token, id)
    if (!conv) {
      errorText.value = 'That conversation could not be loaded.'
      return
    }
    activeId.value = id
    memoryId.value = id
    messages.value = conv.messages
  } else {
    const local = loadLocalConversations().find((c) => c.id === id)
    if (!local) {
      errorText.value = 'That conversation could not be loaded.'
      return
    }
    activeId.value = local.id
    memoryId.value = local.id
    messages.value = local.messages
  }
  followUps.value = []
  view.value = 'chat'
  nextTick(() => scrollToEnd())
}

async function removeConversation(id: string) {
  if (session.value) {
    await deleteConversation(props.apiBase, session.value.token, id)
  } else {
    saveLocalConversations(loadLocalConversations().filter((c) => c.id !== id))
  }
  if (activeId.value === id) newConversation()
  await refreshConversations()
}

// ── asking ──

function scrollToEnd() {
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send(text: string) {
  const query = text.trim()
  if (!query || streaming.value) return
  draft.value = ''
  errorText.value = null
  followUps.value = []

  // ensure the conversation exists (member: server-side; anon: local)
  if (!activeId.value) {
    const title = query.slice(0, 60)
    if (session.value) {
      const id = await createConversation(props.apiBase, session.value.token, title)
      if (!id) {
        errorText.value = 'The conversation could not be created — the question was not sent.'
        return
      }
      activeId.value = id
      memoryId.value = id
    } else {
      activeId.value = `local-${crypto.randomUUID()}`
      memoryId.value = activeId.value
    }
    conversations.value = [
      { id: activeId.value, title, updatedAt: Date.now(), messageCount: 0 },
      ...conversations.value,
    ]
  }
  const convId = activeId.value

  const userMsg: AiMessage = { id: crypto.randomUUID(), role: 'user', content: query, at: Date.now() }
  messages.value = [...messages.value, userMsg]
  if (session.value) void appendMessage(props.apiBase, session.value.token, convId, { role: 'user', content: query })
  else persistLocal()

  streaming.value = true
  pendingText.value = ''
  pendingCitations.value = []
  pendingApplied.value = undefined
  pendingRecords.value = undefined
  pendingDraftAct.value = undefined
  statusLine.value = 'The assistant is answering.'
  abort = new AbortController()
  nextTick(() => scrollToEnd())

  const history = messages.value
    .slice(-11, -1)
    .map((m) => ({ role: m.role, content: m.content }))
  // the declared context rides THIS message only — the chip selection is
  // re-read every send (per-message, changeable mid-session, never locked)
  const declared = currentAskContext()

  try {
    const result = await ask(
      props.apiBase,
      session.value?.token ?? null,
      { query, history, conversation_id: memoryId.value ?? undefined, lang: props.lang, context: declared },
      {
        onCitations: (c, q, applied, records) => {
          pendingCitations.value = c
          if (q) quota.value = q
          if (applied) pendingApplied.value = applied
          if (records) pendingRecords.value = records
          nextTick(() => scrollToEnd())
        },
        onDraft: (d) => {
          pendingDraftAct.value = d
          nextTick(() => scrollToEnd())
        },
        onToken: (tok) => {
          pendingText.value += tok
          nextTick(() => scrollToEnd())
        },
        onDone: (info) => {
          followUps.value = info.followUps ?? []
          const applied = info.contextApplied ?? pendingApplied.value
          const answer: AiMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: pendingText.value,
            citations: pendingCitations.value,
            // the live records the account answer grounded in (TODO.
            // ai-platform/03) — the link cards; ephemeral by design (a
            // point-in-time read: the resumed session keeps the honest
            // context line from the persisted echo, not the cards)
            records: pendingRecords.value ?? null,
            // the prepared act (TODO.ai-platform/04) — the draft card;
            // ephemeral like the records: the conversation record keeps
            // the words, never a stale draft (the real form owns it once
            // the user opens it there)
            draft: pendingDraftAct.value ?? null,
            model: info.model,
            followUps: info.followUps,
            contextApplied: applied ?? null,
            contextUnapplied: !!declared && !applied,
            at: Date.now(),
          }
          messages.value = [...messages.value, answer]
          if (session.value) {
            void appendMessage(props.apiBase, session.value.token, convId, {
              role: 'assistant',
              content: answer.content,
              citations: answer.citations,
              model: answer.model,
              contextApplied: answer.contextApplied,
            })
          } else {
            persistLocal()
          }
          pendingText.value = ''
          pendingCitations.value = []
          pendingRecords.value = undefined
          pendingDraftAct.value = undefined
          statusLine.value = 'Answer complete.'
          void refreshConversations()
        },
      },
      abort.signal,
    )
    if (!result.ok) {
      if (result.authExpired) {
        await adoptSession(null)
        errorText.value = 'The assistant session expired — sign in again to continue as a member.'
      } else {
        errorText.value = result.message
      }
      if (result.quotaExceeded) quota.value = { used: 1, limit: 1 }
      // the user message stays — the conversation record is honest about
      // what was asked; the failed answer simply never lands
      pendingText.value = ''
      pendingCitations.value = []
      pendingApplied.value = undefined
      pendingRecords.value = undefined
      pendingDraftAct.value = undefined
      statusLine.value = ''
    }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      statusLine.value = 'Answer stopped.'
      pendingText.value = ''
      pendingCitations.value = []
      pendingApplied.value = undefined
      pendingDraftAct.value = undefined
    } else {
      errorText.value = 'The assistant is unreachable — check the connection and retry.'
    }
  } finally {
    streaming.value = false
    abort = null
  }
}

function stop() {
  abort?.abort()
}

// ── panel chrome ──

function togglePanel() {
  open.value = !open.value
  if (open.value) {
    if (isSheet.value) document.body.style.overflow = 'hidden'
    // re-read the published context at open: the attribute mirror is the
    // truth for a panel that hydrated before the page published
    published.value = readPublishedContext()
    // Esc lives on window, not the panel: mid-conversation focus can sit
    // on transient controls that re-render (send/stop swap), which would
    // strand a panel-scoped keydown.
    window.addEventListener('keydown', onGlobalKeydown)
    nextTick(() => (view.value === 'chat' ? composer.value?.focus() : undefined))
  } else {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onGlobalKeydown)
    abort?.abort()
    nextTick(() => (props.mode === 'chrome' && window.innerWidth >= 1024 ? launcherIcon.value : launcherFab.value)?.focus())
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') togglePanel()
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send(draft.value)
  }
}

onMounted(async () => {
  hydrated.value = true
  sheetMq = window.matchMedia('(max-width: 639px)')
  syncSheet()
  sheetMq.addEventListener('change', syncSheet)
  // the page-context seam (TODO.ai-platform/02): the attribute mirror is
  // the current truth; the event carries live updates (route/entity
  // changes while the panel is mounted)
  published.value = readPublishedContext()
  window.addEventListener(AI_CONTEXT_EVENT, onContextEvent)
  const stored = loadStoredSession(props.apiBase)
  if (stored) await adoptSession(stored)
  else await refreshConversations()
})
onBeforeUnmount(() => {
  abort?.abort()
  document.body.style.overflow = ''
  sheetMq?.removeEventListener('change', syncSheet)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener(AI_CONTEXT_EVENT, onContextEvent)
})
</script>

<template>
  <span class="ai-bubble-root" :class="`ai-bubble--${props.mode}`">
    <!-- The launcher: the header icon row at lg+ in chrome mode; the
         floating button below lg (chrome) or always (standalone). -->
    <button
      v-if="props.mode === 'chrome'"
      ref="launcherIcon"
      type="button"
      class="ai-launcher ai-launcher--icon"
      :aria-expanded="open"
      aria-controls="ai-bubble-panel"
      aria-label="Open the OIML SMART AI assistant"
      @click="togglePanel"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
      </svg>
    </button>
    <!-- The launcher: the header icon row at lg+ in chrome mode; the
         floating button below lg (chrome) or always (standalone). The
         FAB + panel TELEPORT to body: in chrome mode the island mounts
         inside the header's `hidden lg:flex` nav, which would suppress
         both below the breakpoint (a fixed element inside display:none
         never renders). -->
    <Teleport to="body" v-if="hydrated">
      <button
        ref="launcherFab"
        type="button"
        class="ai-bubble-root ai-launcher ai-launcher--fab"
        :class="`ai-bubble--${props.mode}`"
        :style="{ bottom: props.fabBottom }"
        :aria-expanded="open"
        aria-controls="ai-bubble-panel"
        aria-label="Open the OIML SMART AI assistant"
        @click="togglePanel"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
        </svg>
        <span class="ai-fab-label">AI</span>
      </button>

      <!-- The panel: a card on desktop, a full sheet on small screens. -->
      <div
        v-if="open"
        id="ai-bubble-panel"
        ref="panelEl"
        class="ai-bubble-root ai-panel"
        :class="`ai-bubble--${props.mode}`"
        role="dialog"
        :aria-modal="isSheet"
        aria-label="OIML SMART AI assistant"
        @keydown="onPanelKeydown"
      >
      <header class="ai-panel-head">
        <div class="ai-panel-title">
          <span class="ai-panel-name">OIML SMART AI</span>
          <span class="ai-panel-tier">{{ isMember ? `Signed in${accountName ? ` as ${accountName}` : ''}` : 'Anonymous — public corpus' }}</span>
        </div>
        <div class="ai-panel-actions">
          <button
            type="button"
            class="ai-iconbtn"
            :aria-pressed="view === 'sessions'"
            aria-label="Conversations"
            title="Conversations"
            @click="view = view === 'sessions' ? 'chat' : 'sessions'"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <button type="button" class="ai-iconbtn" aria-label="Close the assistant" @click="togglePanel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      <!-- The sessions view: the list + new + the account posture. -->
      <section v-if="view === 'sessions'" class="ai-sessions" aria-label="Conversations">
        <div class="ai-account">
          <template v-if="isMember">
            <p class="ai-account-line">Signed in{{ accountName ? ` as ${accountName}` : '' }} — conversations sync to your OIML SMART account.</p>
            <button type="button" class="ai-btn ai-btn--ghost" @click="signOut">Sign out of the assistant</button>
          </template>
          <template v-else>
            <p class="ai-account-line">Anonymous — answers come from the public OIML corpus; conversations stay on this device.</p>
            <button type="button" class="ai-btn ai-btn--primary" :disabled="signingIn" @click="signIn">
              {{ signingIn ? 'Opening sign-in…' : 'Sign in to sync conversations' }}
            </button>
          </template>
        </div>
        <button type="button" class="ai-btn ai-btn--ghost ai-newconv" @click="newConversation">New conversation</button>
        <p v-if="!conversations.length" class="ai-empty">No conversations yet.</p>
        <ul v-else class="ai-convlist">
          <li v-for="c in conversations" :key="c.id" class="ai-convrow">
            <button type="button" class="ai-convopen" @click="resumeConversation(c.id)">
              <span class="ai-convtitle">{{ c.title }}</span>
              <span class="ai-convmeta">{{ c.messageCount }} message{{ c.messageCount === 1 ? '' : 's' }}</span>
            </button>
            <button type="button" class="ai-iconbtn ai-convdel" :aria-label="`Delete conversation ${c.title}`" @click="removeConversation(c.id)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </svg>
            </button>
          </li>
        </ul>
      </section>

      <!-- The chat view. -->
      <section v-else class="ai-chat" aria-label="Conversation">
        <p class="ai-sr" aria-live="polite">{{ statusLine }}</p>
        <div ref="listEl" class="ai-messages">
          <div v-if="!messages.length && !streaming" class="ai-greeting">
            <p>Ask about OIML publications — recommendations, documents, vocabulary. Every answer cites its sources or says it does not know.</p>
            <p v-if="!isMember" class="ai-greeting-note">You are anonymous: the public corpus answers; the conversation stays on this device.</p>
          </div>
          <template v-for="m in messages" :key="m.id">
            <div v-if="m.role === 'user'" class="ai-msg ai-msg--user">{{ m.content }}</div>
            <div v-else class="ai-msg ai-msg--assistant">
              <!-- eslint-disable-next-line vue/no-v-html — the renderer is escape-first (src/ai/markdown.ts) -->
              <div class="ai-md" v-html="renderMd(m.content)"></div>
              <!-- the honest context line (TODO.ai-platform/02): every
                   answer says what it was grounded in — the service's
                   echo, never the panel's wish -->
              <p v-if="props.contextChips" class="ai-context-line">{{ lineFor(m) }}</p>
              <!-- the live-record cards (TODO.ai-platform/03): the claims
                   link to the records they came from — the platform's own
                   pages, opening where the member's browser would -->
              <ul v-if="m.records?.length" class="ai-recs">
                <li v-for="r in m.records" :key="`${r.store}:${r.id}`" class="ai-rec">
                  <a :href="r.url" target="_blank" rel="noopener noreferrer" class="ai-rec-link">
                    <span class="ai-rec-label">{{ r.label }}</span>
                    <span v-if="r.status" class="ai-rec-status">{{ r.status }}</span>
                    <span v-if="r.detail" class="ai-rec-detail">{{ r.detail }}</span>
                  </a>
                </li>
              </ul>
              <!-- the draft card (TODO.ai-platform/04): the service
                   PREPARED the act — the card opens it in the host's real
                   form through the DOM seam; the commit is the user's own
                   click there. Ephemeral: never persisted with the
                   conversation (a resumed session keeps the words, not a
                   stale draft). -->
              <div v-if="props.draftActs && m.draft" class="ai-draft" :data-draft-act="m.draft.act">
                <p class="ai-draft-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                  </svg>
                  Draft prepared by the AI assistant — {{ m.draft.title }}
                </p>
                <ul class="ai-draft-fields">
                  <li v-for="(line, i) in draftFieldLines(m.draft)" :key="i">{{ line }}</li>
                </ul>
                <ul v-if="m.draft.dropped?.length" class="ai-draft-dropped">
                  <li v-for="(d, i) in m.draft.dropped" :key="i">Left out — {{ d.field }} (“{{ d.value }}”): {{ d.reason }}.</li>
                </ul>
                <p class="ai-draft-honest">
                  Prepared from your words only. It opens in the real form with every field editable —
                  nothing is submitted until you review and confirm it there yourself.
                </p>
                <div class="ai-draft-actions">
                  <button
                    type="button"
                    class="ai-draft-open"
                    :disabled="draftHandoff[m.id] === 'sending' || draftHandoff[m.id] === 'opened'"
                    @click="openDraftInForm(m.id, m.draft!)"
                  >{{ draftHandoff[m.id] === 'opened' ? 'Opened in the form' : 'Open in the form' }}</button>
                  <span v-if="draftHandoffNote(draftHandoff[m.id])" class="ai-draft-note" role="status">{{ draftHandoffNote(draftHandoff[m.id]) }}</span>
                </div>
              </div>
              <ul v-if="m.citations?.length" class="ai-cites">
                <li v-for="(c, i) in m.citations.slice(0, 5)" :key="i" class="ai-cite">
                  <a v-if="citationUrl(c)" :href="citationUrl(c)" target="_blank" rel="noopener noreferrer" class="ai-cite-link">
                    <span class="ai-cite-doc">{{ citationLabel(c) }}</span>
                    <span v-if="c.clause_title" class="ai-cite-clause">{{ c.clause_title }}</span>
                  </a>
                  <div v-else class="ai-cite-link">
                    <span class="ai-cite-doc">{{ citationLabel(c) }}</span>
                    <span v-if="c.clause_title" class="ai-cite-clause">{{ c.clause_title }}</span>
                  </div>
                  <span v-if="citationStatus(c)" class="ai-cite-status">{{ citationStatus(c) }}</span>
                </li>
                <li v-if="m.citations.length > 5" class="ai-cite-more">+ {{ m.citations.length - 5 }} more sources</li>
              </ul>
              <div v-if="m.followUps?.length" class="ai-followups">
                <button v-for="(f, i) in m.followUps" :key="i" type="button" class="ai-chip" @click="send(f)">{{ f }}</button>
              </div>
            </div>
          </template>
          <div v-if="streaming" class="ai-msg ai-msg--assistant">
            <div v-if="pendingText" class="ai-md" v-html="renderMd(pendingText)"></div>
            <div v-else class="ai-thinking" aria-hidden="true"><span></span><span></span><span></span></div>
            <p v-if="props.contextChips && pendingApplied" class="ai-context-line">{{ contextLine(pendingApplied) }}</p>
            <ul v-if="pendingRecords?.length" class="ai-recs">
              <li v-for="r in pendingRecords" :key="`${r.store}:${r.id}`" class="ai-rec">
                <a :href="r.url" target="_blank" rel="noopener noreferrer" class="ai-rec-link">
                  <span class="ai-rec-label">{{ r.label }}</span>
                  <span v-if="r.status" class="ai-rec-status">{{ r.status }}</span>
                </a>
              </li>
            </ul>
            <div v-if="props.draftActs && pendingDraftAct" class="ai-draft" :data-draft-act="pendingDraftAct.act">
              <p class="ai-draft-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                </svg>
                Draft prepared by the AI assistant — {{ pendingDraftAct.title }}
              </p>
              <ul class="ai-draft-fields">
                <li v-for="(line, i) in draftFieldLines(pendingDraftAct)" :key="i">{{ line }}</li>
              </ul>
              <p class="ai-draft-honest">It will open in the real form with every field editable — nothing is submitted until you confirm it there yourself.</p>
            </div>
          </div>
          <p v-if="errorText" class="ai-error" role="alert">{{ errorText }}</p>
        </div>

        <div class="ai-composer">
          <p v-if="quotaLine" class="ai-quota">{{ quotaLine }}</p>
          <!-- the context chips (TODO.ai-platform/02): what is AVAILABLE,
               never pre-selected — tap includes, tap drops, changeable per
               message. The entity chip exists only when the page carries
               an entity. None is the default and always offered. -->
          <div v-if="props.contextChips" class="ai-ctx" role="group" aria-label="Answer context — what the answer grounds in">
            <div v-if="pickerOpen" class="ai-docpick">
              <label class="ai-docpick-label" for="ai-docpick-input">Ground the answer in a document</label>
              <div class="ai-docpick-row">
                <input
                  id="ai-docpick-input"
                  v-model="pickerDraft"
                  class="ai-docpick-input"
                  type="text"
                  placeholder="OIML R 60-1 or urn:oiml:pub:r:60-1:2021"
                  maxlength="80"
                  @keydown.enter.prevent="pickDocument"
                  @keydown.esc.prevent.stop="pickerOpen = false"
                />
                <button type="button" class="ai-btn ai-btn--primary ai-docpick-go" :disabled="!pickerDraft.trim()" @click="pickDocument">Pick</button>
              </div>
              <p class="ai-docpick-hint">The answer scopes to that publication; a document the corpus doesn't carry degrades honestly to the general corpus (the context line says so).</p>
            </div>
            <div class="ai-ctxrow">
              <button type="button" class="ai-chip ai-ctxchip" :class="{ 'ai-chip--on': chip === 'page' }" :aria-pressed="chip === 'page'" @click="selectChip('page')">{{ pageChipLabel }}</button>
              <button v-if="entityRef" type="button" class="ai-chip ai-ctxchip" :class="{ 'ai-chip--on': chip === 'entity' }" :aria-pressed="chip === 'entity'" @click="selectChip('entity')">{{ entityChipLabel }}</button>
              <button type="button" class="ai-chip ai-ctxchip" :class="{ 'ai-chip--on': chip === 'document' }" :aria-pressed="chip === 'document'" @click="selectChip('document')">{{ chip === 'document' && docPick ? `A document — ${docPick}` : 'A document…' }}</button>
              <!-- the "my account" chip (TODO.ai-platform/03): the member's
                   OWN live data, honestly labeled — never offered to the
                   anonymous visitor, never wider than the member's own cone -->
              <button v-if="props.accountChip && isMember" type="button" class="ai-chip ai-ctxchip" :class="{ 'ai-chip--on': chip === 'account' }" :aria-pressed="chip === 'account'" @click="selectChip('account')">My account — reads what you can see</button>
              <button type="button" class="ai-chip ai-ctxchip" :class="{ 'ai-chip--on': chip === 'none' }" :aria-pressed="chip === 'none'" @click="selectChip('none')">None</button>
            </div>
          </div>
          <div class="ai-inputrow">
            <textarea
              ref="composer"
              v-model="draft"
              rows="2"
              class="ai-input"
              placeholder="Ask about OIML publications…"
              aria-label="Your question"
              maxlength="8000"
              @keydown="onComposerKeydown"
            ></textarea>
            <button v-if="streaming" type="button" class="ai-btn ai-btn--ghost ai-send" @click="stop">Stop</button>
            <button v-else type="button" class="ai-btn ai-btn--primary ai-send" :disabled="!draft.trim()" @click="send(draft)">Send</button>
          </div>
        </div>
      </section>
      </div>
    </Teleport>
  </span>
</template>

<style>
/* Unscoped on purpose (the README's theme contract bans :global in
   scoped Vue styles): every rule is namespaced under .ai-bubble-root /
   .ai-panel, and the colors ride --ai-* variables that prefer the shell
   tokens (tokens.css hosts) and fall back to the house values (hosts
   with their own palette — the smart platform). html.dark flips the
   fallbacks; token hosts flip via their own .dark token overrides. */
.ai-bubble-root {
  --ai-bg: var(--color-paper-soft, #ffffff);
  --ai-bg-raised: var(--color-paper-raised, #f5ede0);
  --ai-ink: var(--color-ink, #0a1628);
  --ai-ink-soft: var(--color-ink-soft, #3a4a63);
  --ai-ink-muted: var(--color-ink-muted, #6b7a92);
  --ai-rule: var(--color-rule, #ddd2bd);
  --ai-accent: var(--color-accent, #004996);
  --ai-accent-ink: var(--color-paper-soft, #ffffff);
  --ai-accent-soft: var(--color-accent-soft, rgba(0, 73, 150, 0.08));
}
html.dark .ai-bubble-root {
  --ai-bg: var(--color-paper-soft, #13233d);
  --ai-bg-raised: var(--color-paper-raised, #18294a);
  --ai-ink: var(--color-ink, #f5efe4);
  --ai-ink-soft: var(--color-ink-soft, #c2cad8);
  --ai-ink-muted: var(--color-ink-muted, #8d9bb4);
  --ai-rule: var(--color-rule, #1f3357);
  --ai-accent: var(--color-accent, #89b4ef);
  --ai-accent-ink: #001230;
  --ai-accent-soft: var(--color-accent-soft, rgba(137, 180, 239, 0.12));
}

/* ── launchers ── */
.ai-launcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid var(--ai-rule);
  background: transparent;
  color: var(--ai-ink);
  cursor: pointer;
  transition: border-color 0.15s ease;
  touch-action: manipulation;
}
.ai-launcher:hover { border-color: var(--ai-accent); }
.ai-launcher--icon { display: none; }
@media (min-width: 1024px) {
  .ai-bubble--chrome .ai-launcher--icon { display: flex; }
  /* the FAB teleports to body carrying both classes on one element */
  .ai-launcher--fab.ai-bubble--chrome { display: none; }
}
.ai-launcher--fab {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 310;
  padding: 0 0.875rem;
  border-radius: 999px;
  background: var(--ai-accent);
  color: var(--ai-accent-ink);
  border: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-weight: 600;
  font-size: 0.8125rem;
}
.ai-launcher--fab:hover { filter: brightness(1.08); }

/* ── panel ── */
.ai-panel {
  position: fixed;
  z-index: 320;
  right: 1rem;
  bottom: 1rem;
  width: min(26rem, calc(100vw - 2rem));
  height: min(40rem, calc(100vh - 2rem));
  display: flex;
  flex-direction: column;
  background: var(--ai-bg);
  color: var(--ai-ink);
  border: 1px solid var(--ai-rule);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.5;
}
@media (max-width: 639px) {
  .ai-panel {
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
    border: none;
  }
}

.ai-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ai-rule);
  background: var(--ai-bg-raised);
  flex-shrink: 0;
}
.ai-panel-title { display: flex; flex-direction: column; min-width: 0; }
.ai-panel-name { font-weight: 600; font-size: 0.9375rem; }
.ai-panel-tier { font-size: 0.6875rem; color: var(--ai-ink-muted); }
.ai-panel-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }

.ai-iconbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ai-ink-soft);
  cursor: pointer;
}
.ai-iconbtn:hover { color: var(--ai-accent); background: var(--ai-accent-soft); }

.ai-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 1rem;
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  border: 1px solid transparent;
  touch-action: manipulation;
}
.ai-btn--primary { background: var(--ai-accent); color: var(--ai-accent-ink); }
.ai-btn--primary:disabled { opacity: 0.45; cursor: default; }
.ai-btn--ghost { background: transparent; color: var(--ai-ink); border-color: var(--ai-rule); }
.ai-btn--ghost:hover { border-color: var(--ai-accent); }

/* ── sessions view ── */
.ai-sessions { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; }
.ai-account {
  border: 1px solid var(--ai-rule);
  border-radius: 10px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  background: var(--ai-bg-raised);
}
.ai-account-line { margin: 0; font-size: 0.8125rem; color: var(--ai-ink-soft); }
.ai-newconv { align-self: stretch; }
.ai-empty { color: var(--ai-ink-muted); text-align: center; padding: 1rem 0; }
.ai-convlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.ai-convrow { display: flex; align-items: stretch; border-bottom: 1px solid var(--ai-rule); }
.ai-convrow:last-child { border-bottom: none; }
.ai-convopen {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.625rem 0.25rem;
  min-height: 44px;
  background: none;
  border: none;
  color: var(--ai-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ai-convopen:hover .ai-convtitle { color: var(--ai-accent); }
.ai-convtitle { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-convmeta { font-size: 0.6875rem; color: var(--ai-ink-muted); }

/* ── chat view ── */
.ai-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ai-messages { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.625rem; }
.ai-greeting { color: var(--ai-ink-soft); font-size: 0.875rem; }
.ai-greeting-note { color: var(--ai-ink-muted); font-size: 0.75rem; margin-top: 0.5rem; }
.ai-msg { max-width: 92%; padding: 0.5rem 0.75rem; border-radius: 10px; overflow-wrap: break-word; }
.ai-msg--user { align-self: flex-end; background: var(--ai-accent); color: var(--ai-accent-ink); white-space: pre-wrap; }
.ai-msg--assistant { align-self: flex-start; background: var(--ai-bg-raised); border: 1px solid var(--ai-rule); }
.ai-md p { margin: 0 0 0.5rem; }
.ai-md p:last-child { margin-bottom: 0; }
.ai-md ul, .ai-md ol { margin: 0 0 0.5rem; padding-left: 1.25rem; }
.ai-md ul { list-style: disc; }
.ai-md ol { list-style: decimal; }
.ai-md code { font-family: ui-monospace, monospace; font-size: 0.8125em; background: var(--ai-accent-soft); padding: 0.1em 0.3em; border-radius: 3px; }
.ai-md pre { background: var(--ai-accent-soft); border-radius: 6px; padding: 0.625rem; overflow-x: auto; margin: 0 0 0.5rem; }
.ai-md pre code { background: none; padding: 0; }
.ai-md a { color: var(--ai-accent); text-decoration: underline; text-underline-offset: 2px; }
.ai-md .ai-md-heading { font-weight: 600; margin-top: 0.5rem; }

.ai-cites { list-style: none; margin: 0.5rem 0 0; padding: 0.5rem 0 0; border-top: 1px solid var(--ai-rule); display: flex; flex-direction: column; gap: 0.375rem; }
.ai-cite { font-size: 0.75rem; }
.ai-cite-link { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
.ai-cite-doc { font-weight: 600; color: var(--ai-accent); }
.ai-cite-clause { color: var(--ai-ink-muted); }
.ai-cite-status { display: inline-block; margin-top: 0.125rem; padding: 0 0.375rem; border: 1px solid var(--ai-rule); border-radius: 999px; color: var(--ai-ink-muted); font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; }
.ai-cite-more { color: var(--ai-ink-muted); font-size: 0.6875rem; }

.ai-followups { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.5rem; }
.ai-chip {
  min-height: 44px;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--ai-rule);
  background: transparent;
  color: var(--ai-ink-soft);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  text-align: left;
}
.ai-chip:hover { border-color: var(--ai-accent); color: var(--ai-accent); }

/* ── the context chips (TODO.ai-platform/02) ── */
.ai-ctx { margin-bottom: 0.5rem; }
.ai-ctxrow { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.ai-ctxchip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-chip--on { border-color: var(--ai-accent); color: var(--ai-accent); background: var(--ai-accent-soft); font-weight: 600; }
.ai-context-line { margin: 0.375rem 0 0; font-size: 0.6875rem; color: var(--ai-ink-muted); }

/* ── the live-record cards (TODO.ai-platform/03) ── */
.ai-recs { list-style: none; margin: 0.5rem 0 0; padding: 0.5rem 0 0; border-top: 1px dashed var(--ai-rule); display: flex; flex-direction: column; gap: 0.375rem; }
.ai-rec { font-size: 0.75rem; }
.ai-rec-link { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; text-decoration: none; color: inherit; }
.ai-rec-link:hover .ai-rec-label { text-decoration: underline; }
.ai-rec-label { font-weight: 600; color: var(--ai-accent); }
.ai-rec-status { display: inline-block; padding: 0 0.375rem; border: 1px solid var(--ai-rule); border-radius: 999px; color: var(--ai-ink-muted); font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; }
.ai-rec-detail { flex-basis: 100%; color: var(--ai-ink-muted); font-size: 0.6875rem; }
/* the draft card (TODO.ai-platform/04) — the AI-prepared act; the tokens
   ride the same --ai-* fallbacks as the rest of the panel */
.ai-draft { margin: 0.625rem 0 0; padding: 0.625rem 0.75rem; border: 1px solid var(--ai-rule); border-left: 3px solid var(--ai-accent); border-radius: 0.5rem; background: var(--ai-bg-raised); }
.ai-draft-title { display: flex; align-items: center; gap: 0.375rem; margin: 0; font-size: 0.75rem; font-weight: 600; color: var(--ai-accent); }
.ai-draft-fields { list-style: none; margin: 0.375rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.75rem; }
.ai-draft-dropped { list-style: none; margin: 0.375rem 0 0; padding: 0.375rem 0 0; border-top: 1px dashed var(--ai-rule); display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.6875rem; color: var(--ai-ink-muted); }
.ai-draft-honest { margin: 0.5rem 0 0; font-size: 0.6875rem; color: var(--ai-ink-muted); }
.ai-draft-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.5rem; }
.ai-draft-open { min-height: 44px; padding: 0 0.875rem; border: none; border-radius: 0.5rem; background: var(--ai-accent); color: var(--ai-accent-ink); font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.ai-draft-open:disabled { opacity: 0.55; cursor: default; }
.ai-draft-note { font-size: 0.6875rem; color: var(--ai-ink-muted); }
.ai-docpick {
  border: 1px solid var(--ai-rule);
  border-radius: 10px;
  padding: 0.625rem;
  margin-bottom: 0.5rem;
  background: var(--ai-bg-raised);
}
.ai-docpick-label { display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.375rem; }
.ai-docpick-row { display: flex; gap: 0.5rem; }
.ai-docpick-input {
  flex: 1;
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--ai-rule);
  border-radius: 8px;
  background: var(--ai-bg);
  color: var(--ai-ink);
  font: inherit;
  font-size: 0.8125rem;
}
.ai-docpick-hint { margin: 0.375rem 0 0; font-size: 0.6875rem; color: var(--ai-ink-muted); }

.ai-thinking { display: flex; gap: 0.25rem; padding: 0.375rem 0; }
.ai-thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--ai-ink-muted); animation: ai-pulse 1.2s infinite ease-in-out; }
.ai-thinking span:nth-child(2) { animation-delay: 0.2s; }
.ai-thinking span:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-pulse { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ai-thinking span { animation: none; } }

.ai-error {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--ai-rule);
  border-left: 3px solid #b91c1c;
  border-radius: 6px;
  color: var(--ai-ink);
  font-size: 0.8125rem;
}

.ai-composer { border-top: 1px solid var(--ai-rule); padding: 0.625rem 0.75rem; flex-shrink: 0; }
.ai-quota { margin: 0 0 0.375rem; font-size: 0.6875rem; color: var(--ai-ink-muted); }
.ai-inputrow { display: flex; gap: 0.5rem; align-items: flex-end; }
.ai-input {
  flex: 1;
  min-height: 44px;
  max-height: 9rem;
  resize: none;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--ai-rule);
  border-radius: 8px;
  background: var(--ai-bg);
  color: var(--ai-ink);
  font: inherit;
  font-size: 0.875rem;
}
.ai-input:focus-visible { outline: 2px solid var(--ai-accent); outline-offset: 1px; }
.ai-send { flex-shrink: 0; }

.ai-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
