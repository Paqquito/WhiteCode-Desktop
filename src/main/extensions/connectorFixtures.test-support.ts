import { readFileSync } from 'node:fs'
import { parseConnector } from './connectors.js'
import { McpRegistry as Registry } from './mcpRegistry.js'

/** Fixture partagée par les tests de connecteurs. */
export const TICKETS_CONNECTOR = parseConnector(JSON.parse(readFileSync(new URL('./fixtures/tickets/connector.json', import.meta.url), 'utf8')))
export class TicketsRegistry extends Registry {
  constructor(...args: ConstructorParameters<typeof Registry>) {
    args[4] ??= async () => [TICKETS_CONNECTOR]
    super(...args)
  }
}
