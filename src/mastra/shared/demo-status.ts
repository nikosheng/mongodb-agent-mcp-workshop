import { MongoClient, type Db } from 'mongodb'

export const ADMIN_DB_NAME = 'workshop_admin'
export const ADMIN_SETTINGS_COLLECTION = 'settings'
export const ADMIN_SETTINGS_ID = 'workshop'

export type WorkshopSettings = {
  _id: string
  aiGatewayApiKey: string
  /**
   * Shared Voyage AI API key used by the attendee-facing Jupyter notebook
   * (notebooks/01_build_vector_search.ipynb) to call the embeddings API
   * directly. Fetched read-only, same as aiGatewayApiKey — never written by
   * attendees, only by scripts/admin via the admin connection string.
   */
  voyageApiKey: string
  startsAt: Date
  expiresAt: Date
  enabled: boolean
  updatedAt?: Date
}

export type DemoStatus = {
  active: boolean
  reason?: string
  settings?: WorkshopSettings
}

let cachedClient: MongoClient | null = null
let cachedClientConnectionString: string | null = null

/**
 * Lazily creates (and reuses) a MongoClient for the read-only admin
 * connection. This connection string should only ever point at the
 * `workshop_readonly_user` credential, which Atlas restricts to read-only
 * access on the `workshop_admin` database. The agent-facing MCP server
 * never uses this connection or credential.
 */
async function getAdminClient(connectionString: string): Promise<MongoClient> {
  if (cachedClient && cachedClientConnectionString === connectionString) {
    return cachedClient
  }
  if (cachedClient) {
    await cachedClient.close().catch(() => {})
  }
  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 8000,
  })
  await client.connect()
  cachedClient = client
  cachedClientConnectionString = connectionString
  return client
}

function getAdminDb(client: MongoClient): Db {
  return client.db(ADMIN_DB_NAME)
}

/**
 * Reads the singleton workshop settings document and computes whether the
 * demo should currently be considered "active" (enabled + within the
 * admin-configured time window). This is the single source of truth that
 * gates both LLM calls and embedding generation for every attendee.
 */
export async function getDemoStatus(connectionString: string): Promise<DemoStatus> {
  try {
    const client = await getAdminClient(connectionString)
    const db = getAdminDb(client)
    const doc = await db
      .collection<WorkshopSettings>(ADMIN_SETTINGS_COLLECTION)
      .findOne({ _id: ADMIN_SETTINGS_ID })

    if (!doc) {
      return { active: false, reason: 'Workshop settings have not been provisioned yet.' }
    }

    const now = new Date()
    const startsAt = new Date(doc.startsAt)
    const expiresAt = new Date(doc.expiresAt)

    if (!doc.enabled) {
      return { active: false, reason: 'The workshop demo has been disabled by the admin.', settings: doc }
    }
    if (now < startsAt) {
      return {
        active: false,
        reason: `The workshop demo has not started yet (starts at ${startsAt.toISOString()}).`,
        settings: doc,
      }
    }
    if (now > expiresAt) {
      return {
        active: false,
        reason: `The workshop demo window has ended (expired at ${expiresAt.toISOString()}). Thanks for attending!`,
        settings: doc,
      }
    }
    if (!doc.aiGatewayApiKey) {
      return { active: false, reason: 'Workshop API key is not configured yet.', settings: doc }
    }

    return { active: true, settings: doc }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { active: false, reason: `Could not reach workshop admin settings: ${message}` }
  }
}
