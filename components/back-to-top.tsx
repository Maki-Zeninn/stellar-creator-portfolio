'use client'

import * as React from 'react'
import { ArrowUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** Scroll distance, in pixels, before the button appears. */
const DEFAULT_SHOW_AFTER_PX = 400

export interface BackToTopProps {
  /** Scroll offset at which the button fades in. */
  showAfterPx?: number
  className?: string
}

/**
 * Floating "back to top" button for long pages (#1234).
 *
 * Pages like the leaderboard and bounty listing run long enough that returning
 * to the top means a lot of scrolling. This appears once the reader is far
 * enough down to want it, and stays out of the way until then.
 *
 * Built on the existing `Button` primitive rather than a new one, and mounted
 * from the shared layout so every long page gets it without opting in.
 */
export function BackToTop({
  showAfterPx = DEFAULT_SHOW_AFTER_PX,
  className,
}: BackToTopProps) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const update = () => setVisible(window.scrollY > showAfterPx)

    // Read once on mount: the browser restores scroll position on a back
    // navigation, so the page can already be scrolled before the first event.
    update()

    // `passive` keeps this off the scrolling critical path.
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [showAfterPx])

  const scrollToTop = React.useCallback(() => {
    // Honour a reduced-motion preference — a long smooth scroll is exactly the
    // kind of movement that setting exists to suppress.
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [])

  if (!visible) return null

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      onClick={scrollToTop}
      aria-label="Back to top"
      data-testid="back-to-top"
      className={cn(
        'fixed bottom-6 right-6 z-40 h-11 w-11 rounded-full shadow-lg',
        'border border-border/60 backdrop-blur transition-opacity',
        className,
      )}
    >
      <ArrowUp size={18} aria-hidden="true" />
    </Button>
  )
}
