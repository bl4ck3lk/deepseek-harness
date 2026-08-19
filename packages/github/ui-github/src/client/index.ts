/**
 * GitHub PR surface: one conversation-view dashboard tab plus one keyed tool
 * card per `gh_pr_*` tool, all over the `ctx.remote.github` namespace. The
 * dashboard stays read-only; write actions belong to the model-facing tools,
 * which carry the confirmation gates.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' and 'tool.call.toolview' SlotMap rows
// (declared by their owning packages) must be in the program to register.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { GithubToolRow } from './GithubToolRow.tsx'
import { GithubView } from './GithubView.tsx'
import { en, NS, zh } from './locales.ts'

export type { GithubToolRowProps } from './GithubToolRow.tsx'
export type { GithubViewProps } from './GithubView.tsx'
export type { GithubCardKind, GithubCardModel, GithubCardState } from './card-model.ts'
export type { GithubKey } from './locales.ts'

/** The twelve `gh_pr_*` wire tool names this package renders. */
export const GITHUB_TOOL_NAMES = [
  'gh_pr_list',
  'gh_pr_view',
  'gh_pr_threads',
  'gh_pr_thread',
  'gh_pr_commits',
  'gh_pr_context',
  'gh_pr_comment',
  'gh_pr_reply',
  'gh_pr_thread_resolve',
  'gh_pr_review',
  'gh_pr_merge',
  'gh_pr_close',
] as const

/** Required services: the slot registry, the locale service, and the github Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.github']

/**
 * Client plugin body: register the dictionaries, the dashboard tab, and one
 * keyed toolview per gh_pr_* tool. Every registration rides the slot
 * service's effect wrapper, so plugin unload removes the whole surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-github: dictionaries')
  const t = ctx.locale.bind(NS)
  const github: ClientRemote['github'] = ctx.remote.github

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'github',
    order: 20,
    locale: NS,
    label: () => t('view.tab'),
    inject: () => ({ github }),
  }, GithubView))

  ctx.slots.inject('tool.call.toolview', function* () {
    for (const toolName of GITHUB_TOOL_NAMES) {
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key: toolName,
        locale: NS,
      }, GithubToolRow)
    }
  })
}
