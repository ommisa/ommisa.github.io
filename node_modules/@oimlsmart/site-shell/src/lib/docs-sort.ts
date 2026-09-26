import type { CollectionEntry } from 'astro:content'

type DocsEntry = CollectionEntry<'docs'>

export function byDocsOrder(a: DocsEntry, b: DocsEntry): number {
  const ao = a.data.order ?? 999
  const bo = b.data.order ?? 999
  if (ao !== bo) return ao - bo
  return a.id.localeCompare(b.id)
}
