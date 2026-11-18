import { expect, test } from 'bun:test'
import { importMcp } from './mcpImport.js'

test('MCP import prepares a disabled stdio or HTTP server without executing it', () => {
  expect(importMcp('{"mcpServers":{"local":{"command":"node"}}}')).toEqual({id:'local',label:'local',enabled:false,config:{type:'stdio',command:'node',args:[]}})
  expect(importMcp('{"mcpServers":{"remote":{"url":"https://example.test/mcp"}}}').config.type).toBe('http')
})
test('MCP import rejects ambiguous, malformed and unsupported configurations', () => {
  for (const input of ['{', '{}', '{"mcpServers":[]}', '{"mcpServers":{}}', '{"mcpServers":{"a":{},"b":{}}}', '{"mcpServers":{"../escape":{}}}', '{"mcpServers":{"a":{"type":"oauth"}}}']) expect(() => importMcp(input)).toThrow()
})
