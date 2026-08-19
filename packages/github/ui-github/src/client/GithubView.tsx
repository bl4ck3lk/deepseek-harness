/**
 * GitHub dashboard tab: PR listing over one repository with a detail pane
 * (facts, review threads, commits). Read-only by design — write actions stay
 * with the model-facing gh_pr_* tools, which carry the confirmation gates.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  GithubCommitListValue, GithubPrDetail, GithubPrState, GithubPrSummary,
  GithubResult, GithubThreadFilter, GithubThreadListValue,
} from '@deepseek-ai/dsh-github/types'
import css from './GithubView.module.css'

/** The typed github Remote namespace carried by the slot inject face. */
type GithubRemote = ClientRemote['github']

/** Full view props composed by the conversation-view slot. */
export type GithubViewProps = ConvViewProps & { github: GithubRemote } & PropsLocale<'github'>

/** Carrier envelope every Remote method resolves to. */
type Carrier<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One settled fetch: business value or one displayable failure message. */
type Settled<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Fold the carrier and business envelopes into one displayable outcome.
 * @param promise - one Remote call's resolution.
 * @returns the business value or the first available failure message.
 */
async function settle<T>(promise: Promise<Carrier<GithubResult<T>>>): Promise<Settled<T>> {
  const carried = await promise
  if (!carried.ok) {
    return { ok: false, message: carried.error.message }
  }
  const business = carried.value
  if (!business.ok) return { ok: false, message: business.error.message }
  return { ok: true, value: business.value }
}

/** List-row state badge. */
function stateBadgeClass(state: GithubPrState): string | undefined {
  return state === 'OPEN' ? `${css.badge} ${css.badgeOpen}` : css.badge
}

/**
 * The dashboard tab body. All fetches go through the injected Remote
 * namespace; a request counter discards stale responses so fast repo or
 * filter switches never paint an older result over a newer one.
 */
export function GithubView({ github, t }: GithubViewProps) {
  const [repoText, setRepoText] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [pullRequests, setPullRequests] = useState<readonly GithubPrSummary[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<GithubPrDetail | null>(null)
  const [threads, setThreads] = useState<GithubThreadListValue | null>(null)
  const [threadFilter, setThreadFilter] = useState<GithubThreadFilter>('unresolved')
  const [commits, setCommits] = useState<GithubCommitListValue | null>(null)
  const requestId = useRef(0)

  const repoArg = (): string | undefined => {
    const trimmed = repoText.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const loadList = useCallback(async () => {
    const generation = ++requestId.current
    setLoading(true)
    setListError(null)
    const result = await settle(github.listPullRequests({
      ...(repoArg() === undefined ? {} : { repo: repoArg() }),
      ...(stateFilter === '' ? {} : { state: stateFilter as GithubPrState }),
    }))
    if (generation !== requestId.current) return
    setLoading(false)
    if (!result.ok) {
      setListError(result.message)
      setPullRequests([])
      return
    }
    setPullRequests(result.value.pullRequests)
  }, [github, repoText, stateFilter])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (selected === null) {
      setDetail(null)
      setThreads(null)
      setCommits(null)
      return
    }
    const generation = ++requestId.current
    const repo = repoArg()
    void (async () => {
      const [detailResult, threadResult, commitResult] = await Promise.all([
        settle(github.getPullRequest({ ...(repo === undefined ? {} : { repo }), number: selected })),
        settle(github.listThreads({ ...(repo === undefined ? {} : { repo }), number: selected, filter: threadFilter })),
        settle(github.listCommits({ ...(repo === undefined ? {} : { repo }), number: selected })),
      ])
      if (generation !== requestId.current) return
      setDetail(detailResult.ok ? detailResult.value : null)
      setThreads(threadResult.ok ? threadResult.value : null)
      setCommits(commitResult.ok ? commitResult.value : null)
    })()
  }, [github, selected, threadFilter, repoText])

  return (
    <div className={css.view}>
      <div className={css.toolbar}>
        <label htmlFor="github-repo">{t('view.repoLabel')}</label>
        <input
          id="github-repo"
          className={css.repoInput}
          placeholder={t('view.repoPlaceholder')}
          value={repoText}
          onChange={(event) => { setRepoText(event.target.value); setSelected(null) }}
        />
        <select
          className={css.stateSelect}
          aria-label={t('view.title')}
          value={stateFilter}
          onChange={(event) => { setStateFilter(event.target.value); setSelected(null) }}
        >
          <option value="">{t('view.state.all')}</option>
          <option value="OPEN">{t('view.state.open')}</option>
          <option value="MERGED">{t('view.state.merged')}</option>
          <option value="CLOSED">{t('view.state.closed')}</option>
        </select>
        <button type="button" className={css.refreshButton} onClick={() => { void loadList() }}>
          <IconRefreshOutline16 size={14} />
          {t('view.refresh')}
        </button>
      </div>

      {loading && <p className={css.notice}>{t('view.loading')}</p>}
      {listError !== null && !loading && (
        <p className={`${css.notice} ${css.noticeError}`} role="alert">
          {t('view.error', { message: listError })}
        </p>
      )}
      {!loading && listError === null && pullRequests.length === 0 && selected === null && (
        <p className={css.notice}>{t('view.empty')}</p>
      )}

      {selected === null && pullRequests.length > 0 && (
        <div className={css.prList}>
          {pullRequests.map(pr => (
            <button
              type="button"
              key={`${pr.repo.owner}/${pr.repo.name}#${pr.number}`}
              className={css.prRow}
              onClick={() => { setSelected(pr.number) }}
            >
              <span className={css.prNumber}>#{pr.number}</span>
              <span className={css.prTitle}>{pr.title}</span>
              <span className={stateBadgeClass(pr.state)}>{pr.state.toLowerCase()}</span>
              {pr.isDraft && <span className={css.badge}>{t('view.pr.draft')}</span>}
              {pr.checksState !== null && (
                <span className={pr.checksState === 'FAILURE' || pr.checksState === 'ERROR'
                  ? `${css.badge} ${css.badgeError}`
                  : css.badge}
                >
                  {`${t('view.pr.checks')}: ${pr.checksState.toLowerCase()}`}
                </span>
              )}
              <span className={css.prMeta}>{pr.author}</span>
            </button>
          ))}
        </div>
      )}

      {selected !== null && (
        <div className={css.detail}>
          <div className={css.detailHeader}>
            <button type="button" className={css.backButton} onClick={() => { setSelected(null) }}>
              {t('view.detail.back')}
            </button>
            <h3 className={css.detailTitle}>
              {detail === null ? `#${selected}` : `#${detail.number} ${detail.title}`}
            </h3>
          </div>
          {detail !== null && (
            <>
              <p className={css.detailStats}>
                {t('view.detail.stats', {
                  additions: detail.additions,
                  deletions: detail.deletions,
                  files: detail.changedFiles,
                })}
                {' · '}
                {t('view.detail.threads', {
                  unresolved: detail.threadCounts.unresolved,
                  total: detail.threadCounts.total,
                })}
              </p>
              {detail.labels.length > 0 && (
                <p className={css.detailStats}>
                  {`${t('view.detail.labels')}: ${detail.labels.join(', ')}`}
                </p>
              )}
              {detail.bodyText.length > 0 && (
                <pre className={css.detailBody}>{detail.bodyText}</pre>
              )}
            </>
          )}

          <div className={css.sectionHeader}>
            <h4 className={css.sectionTitle}>{t('view.threads.title')}</h4>
            <select
              className={css.stateSelect}
              aria-label={t('view.threads.title')}
              value={threadFilter}
              onChange={(event) => { setThreadFilter(event.target.value as GithubThreadFilter) }}
            >
              <option value="unresolved">{t('view.threads.filter.unresolved')}</option>
              <option value="resolved">{t('view.threads.filter.resolved')}</option>
              <option value="all">{t('view.threads.filter.all')}</option>
            </select>
          </div>
          {threads !== null && threads.threads.length === 0 && (
            <p className={css.notice}>{t('view.threads.empty')}</p>
          )}
          {threads?.threads.map(thread => (
            <div className={css.threadRow} key={thread.id}>
              <span className={css.threadPath}>
                {`${thread.path}${thread.line === null ? '' : `:${thread.line}`}`}
                {thread.isOutdated ? ` (${t('view.threads.outdated')})` : ''}
                {` · ${thread.isResolved ? t('card.resolved') : t('card.unresolved')}`}
                {` · ${t('view.threads.comments', { count: thread.commentCount })}`}
              </span>
              {thread.firstComment !== null && (
                <p className={css.threadExcerpt}>
                  {`${thread.firstComment.author}: ${thread.firstComment.body}`}
                </p>
              )}
            </div>
          ))}

          <div className={css.sectionHeader}>
            <h4 className={css.sectionTitle}>{t('view.commits.title')}</h4>
            {commits !== null && (
              <span className={css.notice}>{t('view.commits.total', { count: commits.totalCount })}</span>
            )}
          </div>
          {commits !== null && commits.commits.length === 0 && (
            <p className={css.notice}>{t('view.commits.empty')}</p>
          )}
          {commits?.commits.map(commit => (
            <div className={css.commitRow} key={commit.sha}>
              <span className={css.commitSha}>{commit.sha.slice(0, 7)}</span>
              <span className={css.commitHeadline}>{commit.headline}</span>
              <span className={css.commitMeta}>
                {`${commit.authorLogin ?? commit.authorName ?? ''} · ${commit.authoredDate}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
