'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Previous / Next pagination controls.
 *
 * The same block of markup was copy-pasted across the disputes queue, the
 * earnings dashboard, creator reputation and review analytics — four
 * near-identical copies that had already drifted into two dialects: one
 * deriving its disabled state from `page`/`totalPages`, the other from
 * server-provided `hasPrev`/`hasNext` flags, with and without chevrons.
 *
 * This is the single place to change them. `hasPrev`/`hasNext` override the
 * derived bounds so callers with server-side paging keep their existing
 * behaviour rather than being forced onto page arithmetic they do not have.
 *
 * Note this is deliberately separate from `components/ui/pagination.tsx`,
 * which is the shadcn numbered-page-link primitive. None of the four call
 * sites used it, and none of them wants a full page-number list.
 */
export interface PaginationControlsProps {
  /** Current page, 1-based. */
  page: number
  /** Total number of pages. */
  totalPages: number
  /** Called with the page to move to. */
  onPageChange: (page: number) => void
  /**
   * Summary text shown alongside the buttons. Defaults to "Page X of Y".
   * Pass `null` to render only the buttons.
   */
  label?: React.ReactNode
  /** Disables both buttons, e.g. while a page is loading. */
  disabled?: boolean
  /** Overrides the derived `page > 1` bound for server-driven paging. */
  hasPrev?: boolean
  /** Overrides the derived `page < totalPages` bound for server-driven paging. */
  hasNext?: boolean
  /** Chevron icons either side of the labels. */
  showIcons?: boolean
  /**
   * `between` puts the label and buttons at opposite ends; `center` groups
   * them together in the middle.
   */
  align?: 'between' | 'center'
  className?: string
}

export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  label,
  disabled = false,
  hasPrev,
  hasNext,
  showIcons = false,
  align = 'between',
  className,
}: PaginationControlsProps) {
  // Server-driven callers know things page arithmetic cannot, such as a total
  // that changed between requests, so their flags win when provided.
  const canGoPrev = (hasPrev ?? page > 1) && !disabled
  const canGoNext = (hasNext ?? page < totalPages) && !disabled

  const summary =
    label === undefined ? (
      <>
        Page {page} of {totalPages}
      </>
    ) : (
      label
    )

  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination-controls"
      className={cn(
        'flex items-center gap-2',
        align === 'between' ? 'justify-between' : 'justify-center',
        className,
      )}
    >
      {summary !== null && (
        <div className="text-sm text-muted-foreground">{summary}</div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoPrev}
          onClick={() => onPageChange(page - 1)}
          aria-label="Go to previous page"
        >
          {showIcons && <ChevronLeft size={16} aria-hidden="true" />}
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Go to next page"
        >
          Next
          {showIcons && <ChevronRight size={16} aria-hidden="true" />}
        </Button>
      </div>
    </nav>
  )
}
