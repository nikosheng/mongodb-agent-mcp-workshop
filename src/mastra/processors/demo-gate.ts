import type { Processor, ProcessInputArgs, ProcessInputResult } from '@mastra/core/processors'
import { getDemoStatus } from '../shared/demo-status.ts'

const ADMIN_READONLY_CONNECTION_STRING = process.env.MONGODB_ADMIN_READONLY_CONNECTION_STRING

/**
 * Blocks every agent call before it reaches the LLM unless the admin-managed
 * workshop_admin.settings document says the demo is currently active
 * (enabled + within the start/expiry window). This is the one-day usage
 * switch: the admin flips `enabled` or lets `expiresAt` pass, and every
 * attendee's agent stops calling the Grove AI Gateway immediately, with no
 * redeploy required.
 */
export class DemoGateProcessor implements Processor {
  id = 'demo-gate'

  async processInput({ abort, messages }: ProcessInputArgs): Promise<ProcessInputResult> {
    if (!ADMIN_READONLY_CONNECTION_STRING) {
      abort(
        'Workshop is not configured: MONGODB_ADMIN_READONLY_CONNECTION_STRING is missing from your .env file. ' +
          'Ask the workshop admin for the shared credentials.',
      )
      return messages
    }

    const status = await getDemoStatus(ADMIN_READONLY_CONNECTION_STRING)

    if (!status.active) {
      abort(status.reason ?? 'This workshop demo is not currently available.')
    }

    return messages
  }
}
