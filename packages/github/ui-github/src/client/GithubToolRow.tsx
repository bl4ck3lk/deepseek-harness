/** Keyed tool card shared by all thirteen `gh_pr_*` tools. */

import { useState } from 'react'
import { CodeBlock, DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  arrayAt, booleanAt, githubCard, numberAt, repoLabel, stringAt,
  type GithubCardKind, type GithubCardModel,
} from './card-model.ts'
import type { GithubKey } from './locales.ts'
import css from './GithubToolRow.module.css'

/** Full card props composed by the keyed Tool slot. */
export type GithubToolRowProps = ToolCallViewProps & PropsLocale<'github'>

const KIND_TITLES: Record<GithubCardKind, GithubKey> = {
  'github.pr-list': 'card.prList',
  'github.pr-detail': 'card.prDetail',
  'github.thread-list': 'card.threadList',
  'github.thread-full': 'card.threadFull',
  'github.commit-list': 'card.commitList',
  'github.context-digest': 'card.contextDigest',
  'github.comment-created': 'card.commentCreated',
  'github.thread-reply': 'card.threadReply',
  'github.thread-resolution': 'card.threadResolution',
  'github.review-submitted': 'card.reviewSubmitted',
  'github.merged': 'card.merged',
  'github.state-change': 'card.stateChange',
}

type Translate = (key: GithubKey, params?: Record<string, unknown>) => string

/** One compact fact pair rendered in the expanded body. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className={css.factLabel}>{label}: </span>
      {value}
    </span>
  )
}

/** Render one `owner/name` reference cell when present. */
function repoFact(value: unknown): string | null {
  const repo = repoLabel(value)
  if (repo !== null) return repo
  const nested = repoLabel((value as Record<string, unknown> | null)?.repo)
  return nested
}

/** Derive the collapsed one-line summary for one settled card. */
function summaryOf(model: GithubCardModel, t: Translate): string {
  const value = model.value
  if (model.state === 'running') return t('card.running')
  if (model.state === 'error') return t('card.failed', { message: model.errorMessage ?? 'error' })
  switch (model.kind) {
    case 'github.pr-list': {
      const repo = repoFact(value)
      const count = arrayAt(value, 'pullRequests').length
      return repo === null ? String(count) : `${repo} · ${count}`
    }
    case 'github.pr-detail': {
      const number = numberAt(value, 'number')
      const title = stringAt(value, 'title')
      const state = stringAt(value, 'state')
      return [number === null ? null : `#${number}`, title, state].filter(part => part !== null).join(' ')
    }
    case 'github.thread-list': {
      const number = numberAt(value, 'number')
      const count = arrayAt(value, 'threads').length
      const filter = stringAt(value, 'filter') ?? 'all'
      return `#${number ?? '?'} · ${count} (${filter})`
    }
    case 'github.thread-full': {
      const path = stringAt(value, 'path') ?? ''
      const line = numberAt(value, 'line')
      const comments = arrayAt(value, 'comments').length
      const resolved = booleanAt(value, 'isResolved') === true
      return `${path}${line === null ? '' : `:${line}`} · ${comments} · ${resolved ? 'resolved' : 'unresolved'}`
    }
    case 'github.commit-list': {
      const number = numberAt(value, 'number')
      const total = numberAt(value, 'totalCount') ?? arrayAt(value, 'commits').length
      return `#${number ?? '?'} · ${total}`
    }
    case 'github.context-digest': {
      const number = numberAt(value, 'number')
      const checks = (value as Record<string, unknown> | null)?.checks
      const passing = numberAt(checks, 'passing')
      const total = numberAt(checks, 'total')
      const suffix = passing !== null && total !== null ? ` · ${passing}/${total} checks` : ''
      return `#${number ?? '?'}${suffix}`
    }
    case 'github.comment-created':
    case 'github.thread-reply':
      return stringAt(value, 'url') ?? ''
    case 'github.thread-resolution': {
      const resolved = booleanAt(value, 'isResolved') === true
      return `${stringAt(value, 'threadId') ?? ''} → ${resolved ? 'resolved' : 'unresolved'}`
    }
    case 'github.review-submitted':
      return `#${numberAt(value, 'number') ?? '?'} · ${stringAt(value, 'event') ?? ''}`
    case 'github.merged':
      return `#${numberAt(value, 'number') ?? '?'} · ${stringAt(value, 'method') ?? ''}`
    case 'github.state-change':
      return `#${numberAt(value, 'number') ?? '?'} → ${stringAt(value, 'state') ?? ''}`
    default:
      return ''
  }
}

/** Fact rows for the expanded body, per presentation kind. */
function factsOf(model: GithubCardModel): Array<[label: string, value: string]> {
  const value = model.value
  const facts: Array<[string, string]> = []
  const repo = repoFact(value)
  if (repo !== null) facts.push(['repo', repo])
  const number = numberAt(value, 'number')
  if (number !== null) facts.push(['PR', `#${number}`])
  switch (model.kind) {
    case 'github.pr-detail': {
      const additions = numberAt(value, 'additions')
      const deletions = numberAt(value, 'deletions')
      const files = numberAt(value, 'changedFiles')
      if (additions !== null && deletions !== null && files !== null) {
        facts.push(['diff', `+${additions} −${deletions} / ${files} files`])
      }
      break
    }
    case 'github.context-digest': {
      const threads = (value as Record<string, unknown> | null)?.threadCounts
      const unresolved = numberAt(threads, 'unresolved')
      const total = numberAt(threads, 'total')
      if (unresolved !== null && total !== null) facts.push(['threads', `${unresolved} unresolved / ${total}`])
      break
    }
    case 'github.thread-resolution': {
      const resolved = booleanAt(value, 'isResolved')
      if (resolved !== null) facts.push(['state', resolved ? 'resolved' : 'unresolved'])
      break
    }
    default:
      break
  }
  return facts
}

/**
 * One `gh_pr_*` card: a DisclosureRow whose title names the presentation
 * kind, whose collapsed content summarizes the stamped value, and whose body
 * carries the fact rows plus the raw JSON for inspection.
 */
export function GithubToolRow({ block, t }: GithubToolRowProps) {
  const model = githubCard(block)
  const [open, setOpen] = useState(false)
  const titleKey: GithubKey = model.kind === null
    ? (model.state === 'running' ? 'card.running' : 'card.unknown')
    : KIND_TITLES[model.kind]
  const state = model.state === 'running' ? 'ongoing' : model.state === 'error' ? 'error' : 'done'
  const facts = factsOf(model)
  const valueText = model.value === null ? null : JSON.stringify(model.value, null, 2)
  return (
    <DisclosureRow
      icon={<StateDot state={state} />}
      title={model.state === 'running' ? t('card.running') : t(titleKey)}
      open={open}
      expandable={model.state !== 'running'}
      onToggle={() => { setOpen(current => !current) }}
      collapsedContent={<span className={css.summary}>{summaryOf(model, t)}</span>}
    >
      <div className={css.body}>
        {model.state === 'error' && model.errorCode !== null && (
          <p className={css.factRow}>{t('card.errorCode', { code: model.errorCode })}</p>
        )}
        {facts.length > 0 && (
          <p className={css.factRow}>
            {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
          </p>
        )}
        {model.kind === 'github.comment-created' || model.kind === 'github.thread-reply'
          ? stringAt(model.value, 'url') !== null
            ? (
              <a className={css.link} href={stringAt(model.value, 'url') as string} target="_blank" rel="noreferrer">
                {stringAt(model.value, 'url')}
              </a>
            )
            : null
          : null}
        {valueText !== null && (
          <>
            <p className={css.sectionTitle}>{t('card.showDetail')}</p>
            <CodeBlock code={valueText} lang="json" className={css.code} />
          </>
        )}
        {model.argumentsText !== null && (
          <>
            <p className={css.sectionTitle}>arguments</p>
            <CodeBlock code={model.argumentsText} lang="json" className={css.code} />
          </>
        )}
      </div>
    </DisclosureRow>
  )
}
