import type { MongoClient } from 'mongodb'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** True for MongoDB/Atlas authentication failures — the specific class of error that's
 *  transient right after creating a new Atlas database user, as opposed to e.g. a genuine
 *  wrong password or network error, which also surface as MongoServerError but shouldn't be
 *  silently retried for a full minute. We match on Atlas's auth-failure error code/name and
 *  the "bad auth" message rather than retrying on every MongoServerError. */
function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const anyErr = err as Error & { code?: unknown; codeName?: unknown }
  return anyErr.codeName === 'AtlasError' || anyErr.code === 8000 || /bad auth|authentication failed/i.test(err.message)
}

const AUTH_RETRY_ATTEMPTS = 6
const AUTH_RETRY_DELAY_MS = 8000 // ~8s between attempts, ~40s total retry budget

/**
 * Connects a MongoClient, retrying on authentication errors for a short
 * window. Newly created Atlas database users can take anywhere from a few
 * seconds up to roughly a minute to fully propagate to the cluster's auth
 * layer after `atlas dbusers create` returns — without this retry, a
 * freshly-provisioned user can intermittently fail its very first
 * connection attempt with "bad auth: Authentication failed" even though the
 * username/password are entirely correct. Any other kind of error (wrong
 * password after a stale re-run, network failure, etc.) is thrown
 * immediately without retrying.
 */
export async function connectWithRetry(client: MongoClient, label: string): Promise<void> {
  for (let attempt = 1; attempt <= AUTH_RETRY_ATTEMPTS; attempt++) {
    try {
      await client.connect()
      return
    } catch (err) {
      const isLastAttempt = attempt === AUTH_RETRY_ATTEMPTS
      if (!isAuthError(err) || isLastAttempt) {
        throw err
      }
      console.log(
        `  ${label}: auth not ready yet (attempt ${attempt}/${AUTH_RETRY_ATTEMPTS}) — this is normal right after ` +
          `creating a new Atlas database user. Retrying in ${AUTH_RETRY_DELAY_MS / 1000}s...`,
      )
      await sleep(AUTH_RETRY_DELAY_MS)
    }
  }
}
