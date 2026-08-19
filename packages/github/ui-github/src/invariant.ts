/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-github`.
 * @module @deepseek-ai/dsh-client-ui-github/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-github'

/** Cordis companion plugin name. */
export const name = 'client-ui-github-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns only slot registrations (one
 * conversation-view tab, twelve keyed toolviews) whose disposal is owned by
 * the slot service's effect wrapper. All mutable state (dashboard fetches)
 * lives in React component state in the browser process, out of reach of the
 * host invariant service; the node half emits no cordis events and holds no
 * cross-plugin state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
