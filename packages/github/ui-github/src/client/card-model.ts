/**
 * Pure derivation of one `gh_pr_*` tool card from its conversation block.
 * The card never calls the Host: everything renders from the frozen block the
 * turn already carries (arguments text, settlement state, and the tool's
 * `presentationMeta` riding `block.meta`).
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** Presentation kinds the `tool-github` package stamps on its results. */
export const GITHUB_CARD_KINDS = [
  'github.pr-list',
  'github.pr-detail',
  'github.thread-list',
  'github.thread-full',
  'github.commit-list',
  'github.context-digest',
  'github.comment-created',
  'github.thread-reply',
  'github.thread-resolution',
  'github.review-submitted',
  'github.merged',
  'github.state-change',
] as const

/** One stamped presentation kind. */
export type GithubCardKind = typeof GITHUB_CARD_KINDS[number]

/** Settlement state of the card's tool call. */
export type GithubCardState = 'running' | 'error' | 'done'

/** Everything one card renders, derived from its block. */
export interface GithubCardModel {
  readonly state: GithubCardState
  readonly kind: GithubCardKind | null
  /** The stamped presentation value; null while running or when unstampable. */
  readonly value: unknown
  /** Business error message when the call settled as an error. */
  readonly errorMessage: string | null
  /** Business error code when the call settled as an error. */
  readonly errorCode: string | null
  /** Pretty-printed tool arguments for the detail disclosure. */
  readonly argumentsText: string | null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function parseKind(input: unknown): GithubCardKind | null {
  if (!isRecord(input)) return null
  const kind = input.kind
  return typeof kind === 'string' && (GITHUB_CARD_KINDS as readonly string[]).includes(kind)
    ? kind as GithubCardKind
    : null
}

function parseArguments(argsRaw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return argsRaw.length > 0 ? argsRaw : null
  }
}

/**
 * Derive one card model from a running or settled block.
 * @param block - the frozen running call or settled result node.
 * @returns the card's complete render input.
 */
export function githubCard(block: ToolCallBlock): GithubCardModel {
  if (!('kind' in block)) {
    return {
      state: 'running',
      kind: null,
      value: null,
      errorMessage: null,
      errorCode: null,
      argumentsText: parseArguments(block.argsRaw),
    }
  }
  const settled = block
  const metaKind = parseKind(settled.meta)
  const metaValue = isRecord(settled.meta) ? settled.meta.value ?? null : null
  if (settled.isError) {
    return {
      state: 'error',
      kind: metaKind,
      value: metaValue,
      errorMessage: settled.error?.name ?? null,
      errorCode: settled.error?.code ?? null,
      argumentsText: settled.call === null ? null : parseArguments(settled.call.argsRaw),
    }
  }
  return {
    state: 'done',
    kind: metaKind,
    value: metaValue,
    errorMessage: null,
    errorCode: null,
    argumentsText: settled.call === null ? null : parseArguments(settled.call.argsRaw),
  }
}

/**
 * Narrow one unknown value to a string field, or null.
 * @param input - the candidate record.
 * @param key - the field name.
 * @returns the string value, or null.
 */
export function stringAt(input: unknown, key: string): string | null {
  if (!isRecord(input)) return null
  const value = input[key]
  return typeof value === 'string' ? value : null
}

/**
 * Narrow one unknown value to a number field, or null.
 * @param input - the candidate record.
 * @param key - the field name.
 * @returns the finite number value, or null.
 */
export function numberAt(input: unknown, key: string): number | null {
  if (!isRecord(input)) return null
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Narrow one unknown value to a boolean field, or null.
 * @param input - the candidate record.
 * @param key - the field name.
 * @returns the boolean value, or null.
 */
export function booleanAt(input: unknown, key: string): boolean | null {
  if (!isRecord(input)) return null
  const value = input[key]
  return typeof value === 'boolean' ? value : null
}

/**
 * Narrow one unknown value to an array field, or an empty list.
 * @param input - the candidate record.
 * @param key - the field name.
 * @returns the array value, or an empty list.
 */
export function arrayAt(input: unknown, key: string): readonly unknown[] {
  if (!isRecord(input)) return []
  const value = input[key]
  return Array.isArray(value) ? value : []
}

/**
 * Format one repository reference as `owner/name`, or null.
 * @param input - the candidate record.
 * @returns the `owner/name` label, or null when either half is not a string.
 */
export function repoLabel(input: unknown): string | null {
  if (!isRecord(input)) return null
  const owner = stringAt(input, 'owner')
  const name = stringAt(input, 'name')
  return owner !== null && name !== null ? `${owner}/${name}` : null
}
