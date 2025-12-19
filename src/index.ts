import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { PiAcpAgent } from './acp/agent.js'

// ACP speaks NDJSON over stdio.
// Pattern based on opencode's `cli/cmd/acp.ts`.

const input = new WritableStream<Uint8Array>({
  write(chunk) {
    return new Promise<void>((resolve, reject) => {
      process.stdout.write(chunk, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
})

const output = new ReadableStream<Uint8Array>({
  start(controller) {
    process.stdin.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
    process.stdin.on('end', () => controller.close())
    process.stdin.on('error', err => controller.error(err))
  }
})

const stream = ndJsonStream(input, output)

new AgentSideConnection(conn => new PiAcpAgent(conn), stream)

process.stdin.resume()
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
