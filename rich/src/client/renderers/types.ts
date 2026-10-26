/** Renderer contract shared by the four RichContentV1 views. */
import type { ReactElement } from 'react'
import type { RichContentV1 } from '../../shared/index'

/** Palette names resolved from DSH theme CSS variables by the card shell. */
export interface RendererTheme {
  readonly text: string
  readonly muted: string
  readonly border: string
  readonly surface: string
  readonly accent: string
  readonly series: readonly string[]
}

/** Props every content renderer receives. */
export interface RichRendererProps<T extends RichContentV1 = RichContentV1> {
  readonly content: T
  readonly theme: RendererTheme
}

/** One renderer component signature. */
export type RichRenderer<T extends RichContentV1 = RichContentV1> = (props: RichRendererProps<T>) => ReactElement
