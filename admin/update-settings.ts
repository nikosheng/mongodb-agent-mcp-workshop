#!/usr/bin/env node
/**
 * Day-to-day admin lifecycle control for the workshop. Reads/writes the
 * single workshop_admin.settings document directly — the only thing
 * attendees' agents consult to decide whether they're allowed to call the
 * LLM at all. No redeploy, no attendee action required for any of these.
 *
 * Requires ADMIN_CONNECTION_STRING (workshop_admin_user, readWrite on
 * workshop_admin) in your environment/.env.
 *
 * Usage:
 *   npm run admin:status
 *   npm run admin:extend -- --hours 24       # push expiresAt forward by N hours from now
 *   npm run admin:disable                    # instant kill-switch
 *   npm run admin:enable                     # re-enable (does not change the time window)
 *   npm run admin:rotate-key -- --key sk-...  # rotate the Grove AI Gateway key
 */
import { MongoClient } from 'mongodb'
import type { WorkshopSettings } from '../src/mastra/shared/demo-status.ts'

type Action = 'status' | 'extend' | 'disable' | 'enable' | 'rotate-key'

function parseArgs(): { action: Action; hours?: number; key?: string } {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }
  const actionIdx = argv.indexOf('--action')
  const action = (actionIdx !== -1 ? argv[actionIdx + 1] : argv[0]) as Action | undefined

  if (!action || !['status', 'extend', 'disable', 'enable', 'rotate-key'].includes(action)) {
    console.error('Usage: tsx admin/update-settings.ts --action <status|extend|disable|enable|rotate-key>')
    process.exit(1)
  }

  const hoursArg = get('--hours')
  const key = get('--key')

  return { action: action as Action, hours: hoursArg ? Number(hoursArg) : undefined, key }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

async function main() {
  const { action, hours, key } = parseArgs()
  const adminConnectionString = requireEnv('ADMIN_CONNECTION_STRING')

  const client = new MongoClient(adminConnectionString)
  await client.connect()
  const settings = client.db('workshop_admin').collection<WorkshopSettings>('settings')

  try {
    switch (action) {
      case 'status': {
        const doc = await settings.findOne({ _id: 'workshop' })
        if (!doc) {
          console.log('No workshop settings document found. Run `npm run admin:provision` first.')
          break
        }
        const now = new Date()
        const active =
          doc.enabled && now >= new Date(doc.startsAt) && now <= new Date(doc.expiresAt) && !!doc.aiGatewayApiKey
        console.log(JSON.stringify({ ...doc, aiGatewayApiKey: doc.aiGatewayApiKey ? '(set)' : '(missing)' }, null, 2))
        console.log(`\nCurrently ${active ? 'ACTIVE' : 'INACTIVE'} (server time: ${now.toISOString()})`)
        break
      }

      case 'extend': {
        const extendHours = hours ?? 24
        const newExpiresAt = new Date(Date.now() + extendHours * 60 * 60 * 1000)
        await settings.updateOne(
          { _id: 'workshop' },
          { $set: { expiresAt: newExpiresAt, enabled: true, updatedAt: new Date() } },
        )
        console.log(`Extended workshop window: expiresAt = ${newExpiresAt.toISOString()} (enabled=true)`)
        break
      }

      case 'disable': {
        await settings.updateOne({ _id: 'workshop' }, { $set: { enabled: false, updatedAt: new Date() } })
        console.log('Workshop disabled. All attendee agents will stop calling the LLM immediately.')
        break
      }

      case 'enable': {
        await settings.updateOne({ _id: 'workshop' }, { $set: { enabled: true, updatedAt: new Date() } })
        console.log('Workshop re-enabled (time window unchanged — check `admin:status` if unsure).')
        break
      }

      case 'rotate-key': {
        if (!key) {
          console.error('Usage: npm run admin:rotate-key -- --key <new-grove-api-key>')
          process.exit(1)
        }
        await settings.updateOne({ _id: 'workshop' }, { $set: { aiGatewayApiKey: key, updatedAt: new Date() } })
        console.log('Grove AI Gateway API key rotated. Takes effect on each attendee agent\'s next request.')
        break
      }
    }
  } finally {
    await client.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
