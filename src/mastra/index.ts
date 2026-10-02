import { Mastra } from '@mastra/core'
import { PinoLogger } from '@mastra/loggers'
import { streamingCatalogAgent } from './agents/streaming-catalog-agent.ts'

export const mastra = new Mastra({
  agents: { streamingCatalogAgent },
  logger: new PinoLogger({ name: 'workshop-mastra', level: 'info' }),
})
