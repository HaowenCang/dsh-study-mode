/**
 * Container width measurement for the responsive SVG charts.
 *
 * The hook is SSR-safe: no DOM or ResizeObserver access happens during render,
 * so `renderToStaticMarkup` tests always see the deterministic fallback width.
 * The observer is disconnected when the component unmounts.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { CHART_DEFAULT_WIDTH, CHART_MIN_WIDTH } from './scale'

/** Result of {@link useContainerWidth}. */
export interface ContainerWidth {
  readonly ref: RefObject<HTMLDivElement>
  readonly width: number
}

/** Observe the width of a wrapper element and keep an integer pixel width. */
export function useContainerWidth(fallback: number = CHART_DEFAULT_WIDTH): ContainerWidth {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number>(fallback)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const apply = (next: number): void => {
      if (!Number.isFinite(next) || next <= 0) return
      const rounded = Math.max(CHART_MIN_WIDTH, Math.round(next))
      setWidth(current => (current === rounded ? current : rounded))
    }
    // Measure once synchronously so the first paint already fits the container.
    apply(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry === undefined) return
      apply(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  return { ref, width }
}
