#!/usr/bin/env node
/**
 * One-time admin provisioning script.
 *
 * Prepares an EXISTING Atlas cluster (e.g. your Flex cluster) for the
 * workshop:
 *   1. Creates/updates 3 scoped Atlas database users via the Atlas CLI:
 *      - workshop_admin_user     readWrite on workshop_admin     (admin only)
 *      - workshop_readonly_user  read       on workshop_admin     (shared, attendees)
 *      - workshop_demo_user      readWrite on streaming_catalog  (shared, attendees)
 *   2. Opens the IP access list to 0.0.0.0/0 for the workshop duration.
 *   3. Seeds workshop_admin.settings with the AI Gateway API key, the shared
 *      Voyage AI API key (used by attendees' Part 1 notebook to call the
 *      embeddings API directly), and an initial start/expiry window.
 *   4. Seeds streaming_catalog.titles with the sample catalog and creates a
 *      MongoDB Atlas Automated Embedding ("autoEmbed") vector search index
 *      using the voyage-4 model — this is the index that powers Part 2 (the
 *      Mastra Studio agent demo). Automated Embedding is fully Atlas-hosted;
 *      this app's own code never calls the Voyage API for this index.
 *      Attendees separately call the Voyage API themselves, by hand, against
 *      their own personal sandbox collection in Part 1 of the workshop (see
 *      notebooks/01_build_vector_search.ipynb) — that's what
 *      ADMIN_VOYAGE_API_KEY below is seeded for.
 *
 * Idempotent: safe to re-run. Existing users/documents/indexes are left
 * alone rather than duplicated.
 *
 * Note: newly created Atlas database users can take anywhere from a few
 * seconds up to roughly a minute to fully propagate to the cluster's auth
 * layer after `atlas dbusers create` returns. The first connection attempt
 * for each user automatically retries on auth errors for a short window
 * (see ./connect-with-retry.ts) so this script succeeds reliably on a
 * clean, first-ever run without requiring a manual re-run.
 *
 * Requires: Atlas CLI (`atlas`) authenticated (`atlas auth login`), and the
 * following environment variables set (see .env.example):
 *   ATLAS_PROJECT_ID, ATLAS_CLUSTER_HOST
 *   ADMIN_AI_GATEWAY_API_KEY
 *   ADMIN_VOYAGE_API_KEY
 *
 * Usage:
 *   npm run admin:provision -- \
 *     --demo-password '<choose-a-password>' \
 *     --readonly-password '<choose-a-password>' \
 *     --admin-password '<choose-a-password>' \
 *     --hours 24
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MongoClient } from 'mongodb'
import type { WorkshopSettings } from '../src/mastra/shared/demo-status.ts'
import { connectWithRetry } from './connect-with-retry.ts'

type Args = {
  demoPassword: string
  readonlyPassword: string
  adminPassword: string
  hours: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string, fallback?: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : fallback
  }

  const demoPassword = get('--demo-password')
  const readonlyPassword = get('--readonly-password')
  const adminPassword = get('--admin-password')
  const hours = Number(get('--hours', '24'))

  if (!demoPassword || !readonlyPassword || !adminPassword) {
    console.error(
      'Usage: npm run admin:provision -- --demo-password <pw> --readonly-password <pw> --admin-password <pw> [--hours 24]',
    )
    process.exit(1)
  }

  return { demoPassword, readonlyPassword, adminPassword, hours }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

function atlas(args: string[]): string {
  const displayArgs = args.map((value, index) => args[index - 1] === '--password' ? '[REDACTED]' : value)
  console.log(`$ atlas ${displayArgs.join(' ')}`)
  try {
    return execFileSync('atlas', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const cliError = err as Error & { stderr?: string }
    let detail = cliError.stderr || cliError.message
    const passwordIndex = args.indexOf('--password')
    const password = passwordIndex === -1 ? undefined : args[passwordIndex + 1]
    if (password) detail = detail.replaceAll(password, '[REDACTED]')
    throw new Error(`Atlas command failed: atlas ${displayArgs.join(' ')}\n${detail}`)
  }
}

/** Creates an Atlas database user, tolerating "already exists" errors so the script stays idempotent. */
function ensureDbUser(opts: {
  projectId: string
  username: string
  password: string
  databaseName: string
  roleName: 'read' | 'readWrite'
}) {
  try {
    atlas([
      'dbusers',
      'create',
      '--username',
      opts.username,
      '--password',
      opts.password,
      '--role',
      `${opts.roleName}@${opts.databaseName}`,
      '--projectId',
      opts.projectId,
      '--output',
      'json',
    ])
    console.log(`Created Atlas DB user: ${opts.username}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/duplicate|already exists/i.test(message)) {
      console.log(`Atlas DB user already exists, leaving as-is: ${opts.username}`)
    } else {
      throw err
    }
  }
}

function ensureOpenAccessList(projectId: string) {
  try {
    atlas([
      'accessLists',
      'create',
      '0.0.0.0/0',
      '--projectId',
      projectId,
      '--type',
      'cidrBlock',
      '--comment',
      'workshop-temporary-open-access',
      '--output',
      'json',
    ])
    console.log('Opened IP access list to 0.0.0.0/0 for the workshop.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/duplicate|already exists/i.test(message)) {
      console.log('IP access list entry 0.0.0.0/0 already present.')
    } else {
      throw err
    }
  }
}

async function seedAdminSettings(adminConnectionString: string, hours: number) {
  const aiGatewayApiKey = requireEnv('ADMIN_AI_GATEWAY_API_KEY')
  const voyageApiKey = requireEnv('ADMIN_VOYAGE_API_KEY')

  const client = new MongoClient(adminConnectionString)
  await connectWithRetry(client, 'workshop_admin_user')
  try {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000)

    await client
      .db('workshop_admin')
      .collection<WorkshopSettings>('settings')
      .updateOne(
        { _id: 'workshop' },
        {
          $set: {
            aiGatewayApiKey,
            voyageApiKey,
            startsAt: now,
            expiresAt,
            enabled: true,
            updatedAt: now,
          },
        },
        { upsert: true },
      )

    console.log(
      `Seeded workshop_admin.settings — active from ${now.toISOString()} to ${expiresAt.toISOString()} (${hours}h window).`,
    )
  } finally {
    await client.close()
  }
}

async function seedCatalogAndIndex(demoConnectionString: string) {
  const client = new MongoClient(demoConnectionString)
  await connectWithRetry(client, 'workshop_demo_user')
  try {
    const db = client.db('streaming_catalog')
    const collection = db.collection('titles')

    const existingCount = await collection.countDocuments({ ownerId: 'seed' })
    if (existingCount > 0) {
      console.log(`streaming_catalog.titles already has ${existingCount} seed documents, skipping insert.`)
    } else {
      const __dirname = path.dirname(fileURLToPath(import.meta.url))
      const dataPath = path.resolve(__dirname, 'data/sample_catalog.json')
      const catalog = JSON.parse(readFileSync(dataPath, 'utf8'))
      const result = await collection.insertMany(catalog)
      console.log(`Inserted ${result.insertedCount} seed titles into streaming_catalog.titles.`)
    }

    const existingIndexes = await collection
      .listSearchIndexes('plot_vector_index')
      .toArray()
      .catch(() => [])
    if (existingIndexes.length > 0) {
      console.log('Vector search index "plot_vector_index" already exists, skipping creation.')
      return
    }

    // Automated Embedding ("autoEmbed") index: Atlas generates embeddings for
    // the "synopsis" text field automatically using voyage-4, for both the
    // existing seed documents (initial sync) and any future inserts/updates
    // (via change streams) — including documents attendees contribute live.
    // No embedding vector or Voyage API key is supplied by this app.
    await collection.createSearchIndexes([
      {
        name: 'plot_vector_index',
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'autoEmbed', path: 'synopsis', model: 'voyage-4', modality: 'text' },
            { type: 'filter', path: 'ownerId' },
            { type: 'filter', path: 'genres' },
            { type: 'filter', path: 'release_year' },
          ],
        },
      },
    ])
    console.log(
      'Submitted creation of Automated Embedding vector search index "plot_vector_index" ' +
        'on streaming_catalog.titles (field: synopsis, model: voyage-4). Initial sync for the ' +
        'seed catalog may take a few minutes — check status with the collection-indexes tool ' +
        'or $listSearchIndexes before running the live demo.',
    )
  } finally {
    await client.close()
  }
}

async function main() {
  const args = parseArgs()
  const projectId = requireEnv('ATLAS_PROJECT_ID')

  console.log('--- Step 1/4: Ensuring scoped Atlas database users exist ---')
  ensureDbUser({
    projectId,
    username: 'workshop_admin_user',
    password: args.adminPassword,
    databaseName: 'workshop_admin',
    roleName: 'readWrite',
  })
  ensureDbUser({
    projectId,
    username: 'workshop_readonly_user',
    password: args.readonlyPassword,
    databaseName: 'workshop_admin',
    roleName: 'read',
  })
  ensureDbUser({
    projectId,
    username: 'workshop_demo_user',
    password: args.demoPassword,
    databaseName: 'streaming_catalog',
    roleName: 'readWrite',
  })

  console.log('\n--- Step 2/4: Opening IP access list (0.0.0.0/0) ---')
  ensureOpenAccessList(projectId)

  const clusterHost = requireEnv('ATLAS_CLUSTER_HOST') // e.g. "your-cluster.abcde.mongodb.net"
  const adminConnectionString = `mongodb+srv://workshop_admin_user:${encodeURIComponent(
    args.adminPassword,
  )}@${clusterHost}/?retryWrites=true&w=majority`
  const demoConnectionString = `mongodb+srv://workshop_demo_user:${encodeURIComponent(
    args.demoPassword,
  )}@${clusterHost}/?retryWrites=true&w=majority`

  console.log('\n--- Step 3/4: Seeding workshop_admin.settings ---')
  await seedAdminSettings(adminConnectionString, args.hours)

  console.log('\n--- Step 4/4: Seeding streaming_catalog.titles + Automated Embedding index ---')
  await seedCatalogAndIndex(demoConnectionString)

  console.log('\nDone. Share these with attendees (e.g. via a handout, NOT via git):')
  console.log(
    `  MONGODB_DEMO_CONNECTION_STRING=mongodb+srv://workshop_demo_user:${args.demoPassword}@${clusterHost}/?retryWrites=true&w=majority`,
  )
  console.log(
    `  MONGODB_ADMIN_READONLY_CONNECTION_STRING=mongodb+srv://workshop_readonly_user:${args.readonlyPassword}@${clusterHost}/?retryWrites=true&w=majority`,
  )
  console.log(
    '\nKeep workshop_admin_user credentials to yourself — use admin/update-settings.ts for ongoing lifecycle control.',
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
