/**
 * Tool-layer failure bridge: converts the `ctx.github` result union into a
 * typed throw the tool registry normalizes into an `isError` outcome while
 * retaining the stable machine-routable code.
 * @module @deepseek-ai/dsh-tool-github/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { GithubErrorCode, GithubResult } from '@deepseek-ai/dsh-github'

/**
 * Typed GitHub tool failure. Extends {@link HarnessError} so the registry,
 * replay, and cards retain the service's failure class.
 */
export class GithubToolError extends HarnessError {
  override readonly code: GithubErrorCode

  constructor(message: string, code: GithubErrorCode, detail?: string) {
    super(detail === undefined ? message : `${message}\n${detail}`, code)
    this.code = code
  }
}

/**
 * Unwrap one service result: return the value on success, throw
 * {@link GithubToolError} with the service's code and diagnostic tail on
 * rejection.
 * @param result - one `ctx.github` operation outcome.
 * @returns the success value.
 */
export function unwrapGithubResult<T>(result: GithubResult<T>): T {
  if (result.ok) return result.value
  const detail = result.error.detail
  throw new GithubToolError(result.error.message, result.error.code, detail === undefined ? undefined : detail)
}
