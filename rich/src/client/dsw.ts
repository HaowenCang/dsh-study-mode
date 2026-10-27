/**
 * DSH 0.2.1-rc.3 design tokens used by the cards (UI-01).
 *
 * The page defines `--dsw-alias-*` colour aliases (light and dark) and
 * `--dsw-radius-*`; the fallbacks keep a card readable outside DSH (tests,
 * exported markup). Figure content keeps literal colours: it is also written
 * to files that an <img> shows without page variables.
 */
import type { CSSProperties } from 'react'

export const DSW = {
  text: 'var(--dsw-alias-label-primary, #1b1f24)',
  muted: 'var(--dsw-alias-label-secondary, #5b6472)',
  faint: 'var(--dsw-alias-label-tertiary, #8a929e)',
  border: 'var(--dsw-alias-border-l2, #d9dee7)',
  layer: 'var(--dsw-alias-bg-layer-1, #f6f7f9)',
  base: 'var(--dsw-alias-bg-base, #ffffff)',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04))',
  success: 'var(--dsw-alias-state-success-primary, #1a7f37)',
  error: 'var(--dsw-alias-state-error-primary, #c62828)',
  radius: 'var(--dsw-radius-lg, 12px)',
  radiusSmall: 'var(--dsw-radius-sm, 6px)',
} as const

/** Outer card: hairline border on the base layer, as DSH draws its own blocks. */
export const cardStyle: CSSProperties = {
  border: `0.5px solid ${DSW.border}`,
  borderRadius: DSW.radius,
  padding: '12px 14px',
  margin: '6px 0',
  background: DSW.base,
  color: DSW.text,
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.55,
  maxWidth: '100%',
  overflow: 'hidden',
}

/** Small outlined button matching the DSH toolbar buttons. */
export const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  padding: '3px 10px',
  border: `0.5px solid ${DSW.border}`,
  borderRadius: DSW.radiusSmall,
  background: DSW.base,
  color: DSW.text,
  cursor: 'pointer',
}

/** Quiet secondary line (captions, status). */
export const noteStyle: CSSProperties = { color: DSW.muted, fontSize: 12, margin: 0 }
