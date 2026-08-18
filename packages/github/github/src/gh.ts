/**
 * The `gh` subprocess runner: fixed argv vectors over the subprocess
 * capability seam, bounded collected output, caller-owned cancellation plus
 * a service-owned deadline, and exit classification into the capability's
 * error vocabulary. No shell layer exists anywhere in this path.
 * @module @deepseek-ai/dsh-github
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { GithubErrorCode } from './types.ts'

/** Retained stderr diagnostic tail cap in bytes. */
const STDERR_MAX_BYTES = 64 * 1024

/** Terminate-escalation grace period for the subprocess seam. */
const GRACE_MS = 5000

/** One classified `gh` execution failure with the diagnostic tail attached. */
export class GhExecutionError extends Error {
  /**
   * @param message - human-readable failure explanation.
   * @param code - stable capability failure class.
   * @param detail - optional `gh` stderr tail for operator inspection.
   * @param options - optional failure cause.
   */
  constructor(
    message: string,
    readonly code: GithubErrorCode,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'GhExecutionError'
  }
}

/** Deployment-fixed runner policy resolved from the service Config. */
export interface GhRunnerPolicy {
  /** Resolved absolute `gh` executable path. */
  readonly ghPath: string
  /** Default deadline for one invocation in milliseconds. */
  readonly timeoutMs: number
  /** In-memory cap for one collected stdout stream in bytes. */
  readonly maxOutputBytes: number
  /** Environment layered onto every child after the seam's ambient scrub. */
  readonly childEnv: Readonly<Record<string, string>>
  /** Working directory for invocations that name no repository checkout. */
  readonly defaultCwd: string
}

/** Per-invocation overrides a service operation may supply. */
export interface GhRunOptions {
  /** Caller cancellation; combined with the deadline signal. */
  readonly signal?: AbortSignal | undefined
  /** Deadline override in milliseconds (enrichment runs). */
  readonly timeoutMs?: number | undefined
  /** Working directory override (repository checkouts). */
  readonly cwd?: string | undefined
  /** Stdout cap override in bytes. */
  readonly maxOutputBytes?: number | undefined
  /** Additional environment layered after the policy environment. */
  readonly env?: Readonly<Record<string, string>> | undefined
}

/** Collected outcome of one completed `gh` invocation. */
export interface GhRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run `gh` invocations as managed process trees. One runner per service
 * instance; the policy is immutable after construction.
 */
export class GhRunner {
  /**
   * @param ctx - plugin context carrying the subprocess service.
   * @param policy - deployment-fixed execution policy.
   */
  constructor(
    private readonly ctx: Context,
    private readonly policy: GhRunnerPolicy,
  ) {}

  /**
   * Resolve the configured `gh` executable in the subprocess execution world.
   * @returns the canonical absolute executable path.
   * @throws GhExecutionError with `gh-missing` when resolution fails.
   */
  async resolveExecutable(): Promise<string> {
    try {
      return await this.ctx.subprocess.resolveExecutable(this.policy.ghPath, { ...this.policy.childEnv })
    } catch (error: unknown) {
      throw new GhExecutionError(
        `gh executable '${this.policy.ghPath}' could not be resolved on this host`,
        'gh-missing',
        undefined,
        { cause: error },
      )
    }
  }

  /**
   * Run one `gh` invocation with fixed arguments and collect both streams.
   * Exit 0 returns normally; every other outcome throws a classified
   * {@link GhExecutionError} carrying the stderr tail.
   * @param args - arguments after the `gh` executable (never shell-interpreted).
   * @param opts - per-invocation cancellation, deadline, cwd, and caps.
   * @returns exit code and complete collected stdout/stderr text.
   */
  async run(args: readonly string[], opts: GhRunOptions = {}): Promise<GhRunResult> {
    const timeoutMs = opts.timeoutMs ?? this.policy.timeoutMs
    const maxOutputBytes = opts.maxOutputBytes ?? this.policy.maxOutputBytes
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal = opts.signal === undefined ? deadline : AbortSignal.any([opts.signal, deadline])
    const argv = [this.policy.ghPath, ...args]
    let handle
    try {
      handle = this.ctx.subprocess.spawn({
        argv,
        cwd: opts.cwd ?? this.policy.defaultCwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: STDERR_MAX_BYTES },
        },
        graceMs: GRACE_MS,
        signal,
        env: { ...this.policy.childEnv, ...opts.env },
      })
    } catch (error: unknown) {
      if (opts.signal?.aborted) {
        throw new GhExecutionError('gh invocation was cancelled before it started', 'aborted')
      }
      throw new GhExecutionError('gh invocation could not start', 'gh-launch-failed', undefined, { cause: error })
    }
    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error: unknown) {
      throw new GhExecutionError('gh invocation failed during launch', 'gh-launch-failed', undefined, { cause: error })
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined || stderr === undefined) {
      throw new GhExecutionError('gh invocation produced no collected output streams', 'gh-failed')
    }
    if (signal.aborted) {
      const reason = opts.signal?.aborted === true
        ? 'gh invocation was cancelled'
        : `gh invocation timed out after ${timeoutMs}ms`
      throw new GhExecutionError(reason, 'aborted', stderr.text)
    }
    if (outcome.signal !== null || outcome.exitCode === null) {
      throw new GhExecutionError(
        `gh invocation was killed by signal ${outcome.signal ?? '(unknown)'}`,
        'gh-failed',
        stderr.text,
      )
    }
    if (stdout.lossy) {
      throw new GhExecutionError(
        `gh output exceeded the ${maxOutputBytes}-byte collection cap`,
        'output-overflow',
        stderr.text,
      )
    }
    if (outcome.exitCode !== 0) {
      throw new GhExecutionError(
        `gh exited with code ${outcome.exitCode}`,
        'gh-failed',
        stderr.text || stdout.text,
      )
    }
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr: stderr.text }
  }

  /**
   * Run one `gh api graphql` call with named variables and parse the JSON
   * envelope. GraphQL-level errors stay in the envelope for the caller's
   * mapper to classify; transport and parse failures throw here.
   * @param query - GraphQL document text.
   * @param variables - named variables; numbers and strings only.
   * @param opts - per-invocation overrides.
   * @returns the parsed response envelope (data and/or errors).
   */
  async graphql(
    query: string,
    variables: Readonly<Record<string, string | number>>,
    opts: GhRunOptions = {},
  ): Promise<unknown> {
    const args = ['api', 'graphql', '-f', `query=${query}`]
    for (const [name, value] of Object.entries(variables)) {
      args.push('-F', `${name}=${String(value)}`)
    }
    const result = await this.run(args, opts)
    try {
      return JSON.parse(result.stdout) as unknown
    } catch (error: unknown) {
      throw new GhExecutionError('gh api graphql returned invalid JSON', 'invalid-response', result.stderr, { cause: error })
    }
  }
}
