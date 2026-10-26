/**
 * Client-side diagram geometry: the pure mapping lives in Shared (so the Host
 * Mermaid layout checks exactly what is drawn); tone styling stays here.
 */
import type { DiagramNode } from '../../../shared/index'
import type { RendererTheme } from '../types'

export * from '../../../shared/diagram-geometry'

/** Resolved visual style of one node tone. */
export interface DiagramToneStyle {
  readonly fill: string
  readonly stroke: string
  readonly text: string
  readonly opacity: number
}

/** Resolve a tone against the renderer theme; unknown tones behave as `default`. */
export function toneStyle(tone: DiagramNode['tone'], theme: RendererTheme): DiagramToneStyle {
  switch (tone) {
    case 'accent':
      return { fill: theme.accent, stroke: theme.accent, text: '#ffffff', opacity: 1 }
    case 'muted':
      return { fill: theme.surface, stroke: theme.border, text: theme.muted, opacity: 0.72 }
    case 'default':
    case undefined:
      return { fill: theme.surface, stroke: theme.border, text: theme.text, opacity: 1 }
    default:
      return { fill: theme.surface, stroke: theme.border, text: theme.text, opacity: 1 }
  }
}
