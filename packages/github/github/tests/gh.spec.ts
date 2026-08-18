/**
 * Runner unit tests: a stubbed subprocess service drives the edge branches —
 * launch failures, signal kills, missing streams, pre-aborted callers, and
 * JSON parse failures — without any real process.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { GhExecutionError, GhRunner } from '../src/gh.ts'

interface StubPlan {
  resolveThrows?: boolean
  spawnThrows?: boolean
  doneRejects?: boolean
  outcome?: SubprocessOutcome
  stdout?: { text: string; lossy?: boolean }
  stderr?: { text: string; lossy?: boolean }
  noStreams?: boolean
}

function stubContext(plan: StubPlan): Context {
  const handle: SubprocessHandle = {
    pid: 42,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: plan.noStreams
      ? {}
      : {
        stdout: { readFrom: () => ({ text: plan.stdout?.text ?? '', nextOffset: 0, lossy: plan.stdout?.lossy ?? false }) },
        stderr: { readFrom: () => ({ text: plan.stderr?.text ?? '', nextOffset: 0, lossy: plan.stderr?.lossy ?? false }) },
      },
    done: plan.doneRejects
      ? Promise.reject(new Error('spawn infra failure'))
      : Promise.resolve(plan.outcome ?? { exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
  return {
    subprocess: {
      resolveExecutable: () => (plan.resolveThrows ? Promise.reject(new Error('no such file')) : Promise.resolve('/fake/gh')),
      spawn: (_spec: SubprocessSpawnSpec) => {
        if (plan.spawnThrows) throw new Error('spawn rejected')
        return handle
      },
    },
  } as unknown as Context
}

const POLICY = {
  ghPath: '/fake/gh',
  timeoutMs: 60_000,
  maxOutputBytes: 1_048_576,
  childEnv: Object.freeze({}),
  defaultCwd: '/tmp',
}

describe('GhRunner.resolveExecutable', () => {
  it('maps resolution failure to gh-missing', async () => {
    const runner = new GhRunner(stubContext({ resolveThrows: true }), POLICY)
    await expect(runner.resolveExecutable()).rejects.toMatchObject({ code: 'gh-missing' })
  })
})

describe('GhRunner.run', () => {
  it('returns collected output on exit 0', async () => {
    const runner = new GhRunner(stubContext({ stdout: { text: 'ok' }, stderr: { text: '' } }), POLICY)
    const result = await runner.run(['version'])
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' })
  })

  it('classifies spawn creation throws as gh-launch-failed', async () => {
    const runner = new GhRunner(stubContext({ spawnThrows: true }), POLICY)
    await expect(runner.run(['version'])).rejects.toMatchObject({ code: 'gh-launch-failed' })
  })

  it('classifies a pre-aborted caller as aborted when spawn throws', async () => {
    const runner = new GhRunner(stubContext({ spawnThrows: true }), POLICY)
    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(['version'], { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
  })

  it('classifies done rejections as gh-launch-failed', async () => {
    const runner = new GhRunner(stubContext({ doneRejects: true }), POLICY)
    await expect(runner.run(['version'])).rejects.toMatchObject({ code: 'gh-launch-failed' })
  })

  it('classifies signal kills as gh-failed', async () => {
    const runner = new GhRunner(stubContext({ outcome: { exitCode: null, signal: 'SIGTERM' }, stderr: { text: 'killed' } }), POLICY)
    await expect(runner.run(['version'])).rejects.toMatchObject({ code: 'gh-failed' })
  })

  it('rejects missing collected streams', async () => {
    const runner = new GhRunner(stubContext({ noStreams: true }), POLICY)
    await expect(runner.run(['version'])).rejects.toThrow('no collected output streams')
  })

  it('surfaces non-zero exits with the stderr tail', async () => {
    const runner = new GhRunner(stubContext({ outcome: { exitCode: 3, signal: null }, stderr: { text: 'bad thing' } }), POLICY)
    const error = await runner.run(['version']).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(GhExecutionError)
    expect(error).toMatchObject({ code: 'gh-failed', detail: 'bad thing' })
  })

  it('classifies a lossy stdout tail as output-overflow', async () => {
    const runner = new GhRunner(stubContext({ stdout: { text: 'tail', lossy: true } }), POLICY)
    await expect(runner.run(['version'])).rejects.toMatchObject({ code: 'output-overflow' })
  })
})

describe('GhRunner.graphql', () => {
  it('parses JSON envelopes', async () => {
    const runner = new GhRunner(stubContext({ stdout: { text: '{"data":{"ok":true}}' } }), POLICY)
    await expect(runner.graphql('query{}', { first: 1 })).resolves.toEqual({ data: { ok: true } })
  })

  it('classifies invalid JSON as invalid-response', async () => {
    const runner = new GhRunner(stubContext({ stdout: { text: 'not json' } }), POLICY)
    await expect(runner.graphql('query{}', {})).rejects.toMatchObject({ code: 'invalid-response' })
  })
})

describe('GhRunner.run detail and cancellation branches', () => {
  it('falls back to the stdout tail when stderr is empty', async () => {
    const runner = new GhRunner(stubContext({
      outcome: { exitCode: 2, signal: null },
      stdout: { text: 'boom on stdout' },
      stderr: { text: '' },
    }), POLICY)
    const error = await runner.run(['version']).catch((value: unknown) => value)
    expect(error).toMatchObject({ code: 'gh-failed', detail: 'boom on stdout' })
  })

  it('reports a caller cancellation rather than a signal kill', async () => {
    let settle: (outcome: SubprocessOutcome) => void = () => {}
    const plan: StubPlan = { stdout: { text: '' }, stderr: { text: '' } }
    const ctx = stubContext(plan)
    const originalSpawn = (ctx as unknown as { subprocess: { spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle } }).subprocess.spawn
    ;(ctx as unknown as { subprocess: { spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle } }).subprocess.spawn = (spec) => {
      const handle = originalSpawn(spec)
      return { ...handle, done: new Promise<SubprocessOutcome>((resolve) => { settle = resolve }) }
    }
    const runner = new GhRunner(ctx, POLICY)
    const controller = new AbortController()
    const pending = runner.run(['version'], { signal: controller.signal })
    controller.abort()
    settle({ exitCode: null, signal: 'SIGTERM' })
    await expect(pending).rejects.toMatchObject({ code: 'aborted', message: 'gh invocation was cancelled' })
  })
})

describe('GhRunner signal edge', () => {
  it('reports an unknown kill signal', async () => {
    const runner = new GhRunner(stubContext({ outcome: { exitCode: null, signal: null }, stderr: { text: 'gone' } }), POLICY)
    await expect(runner.run(['version'])).rejects.toMatchObject({
      code: 'gh-failed',
      message: 'gh invocation was killed by signal (unknown)',
    })
  })
})
