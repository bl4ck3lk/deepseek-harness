// @vitest-environment jsdom
// Card model: what one gh_pr_* card can and cannot derive from the frozen
// running/settled block slice.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  arrayAt, booleanAt, githubCard, numberAt, repoLabel, stringAt,
} from '../src/client/card-model.ts'

const ARGS = '{"repo":"fixture-owner/fixture-repo","first":5}'

function running(over: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1', name: 'gh_pr_list', argsRaw: ARGS, turn: 1, step: 1, time: 1_000,
    callView: null, subCalls: [], ...over,
  }
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 2_000, callId: 'call-1',
    call: { name: 'gh_pr_list', argsRaw: ARGS }, callTime: 1_000,
    content: [{ type: 'text', text: 'ok' }], isError: false,
    meta: { kind: 'github.pr-list', value: { repo: { owner: 'o', name: 'r' }, pullRequests: [] } },
    callView: null, resultView: null, subCalls: [], ...over,
  }
}

describe('githubCard', () => {
  it('reads a running call as running with formatted arguments', () => {
    const card = githubCard(running())
    expect(card).toMatchObject({ state: 'running', kind: null, value: null, errorMessage: null, errorCode: null })
    expect(card.argumentsText).toBe(JSON.stringify(JSON.parse(ARGS), null, 2))
  })

  it('keeps unparseable arguments verbatim and maps empty arguments to null', () => {
    expect(githubCard(running({ argsRaw: 'not json' })).argumentsText).toBe('not json')
    expect(githubCard(running({ argsRaw: '' })).argumentsText).toBeNull()
  })

  it('takes the stamped kind and value from a settled result', () => {
    const card = githubCard(settled())
    expect(card.state).toBe('done')
    expect(card.kind).toBe('github.pr-list')
    expect(card.value).toMatchObject({ repo: { owner: 'o', name: 'r' } })
    expect(card.errorMessage).toBeNull()
  })

  it('classifies a business error and carries its info', () => {
    const card = githubCard(settled({ isError: true, error: { name: 'GithubToolError', code: 'not-found' } }))
    expect(card.state).toBe('error')
    expect(card.errorMessage).toBe('GithubToolError')
    expect(card.errorCode).toBe('not-found')
  })

  it('falls back when an error result carries no error info', () => {
    const card = githubCard(settled({ isError: true }))
    expect(card.errorMessage).toBeNull()
    expect(card.errorCode).toBeNull()
  })

  it('drops arguments in an errored result whose call fell outside the window', () => {
    const card = githubCard(settled({ isError: true, call: null }))
    expect(card.state).toBe('error')
    expect(card.argumentsText).toBeNull()
  })

  it('rejects unstamped and foreign meta shapes', () => {
    expect(githubCard(settled({ meta: undefined })).kind).toBeNull()
    expect(githubCard(settled({ meta: 'github.pr-list' })).kind).toBeNull()
    expect(githubCard(settled({ meta: { kind: 'other.kind' } })).kind).toBeNull()
    expect(githubCard(settled({ meta: { kind: 'github.pr-list' } })).value).toBeNull()
  })

  it('drops arguments when the settled call fell outside the window', () => {
    expect(githubCard(settled({ call: null })).argumentsText).toBeNull()
  })
})

describe('field accessors', () => {
  it('narrows string, number, boolean and array fields defensively', () => {
    const record = { s: 'x', n: 3, b: true, list: [1], nan: Number.NaN, inf: Infinity }
    expect(stringAt(record, 's')).toBe('x')
    expect(stringAt(record, 'n')).toBeNull()
    expect(numberAt(record, 'n')).toBe(3)
    expect(numberAt(record, 'nan')).toBeNull()
    expect(numberAt(record, 'inf')).toBeNull()
    expect(booleanAt(record, 'b')).toBe(true)
    expect(booleanAt(record, 's')).toBeNull()
    expect(arrayAt(record, 'list')).toEqual([1])
    expect(arrayAt(record, 's')).toEqual([])
    expect(stringAt(null, 's')).toBeNull()
    expect(numberAt('x', 'n')).toBeNull()
    expect(booleanAt([], 'b')).toBeNull()
    expect(arrayAt(undefined, 'list')).toEqual([])
  })

  it('formats one repo reference only when both halves are strings', () => {
    expect(repoLabel({ owner: 'o', name: 'r' })).toBe('o/r')
    expect(repoLabel({ owner: 'o' })).toBeNull()
    expect(repoLabel({ owner: 1, name: 'r' })).toBeNull()
    expect(repoLabel(null)).toBeNull()
  })
})
