import type { AgentSideConnection, McpServer } from "@agentclientprotocol/sdk"
import { RequestError } from "@agentclientprotocol/sdk"
import { PiRpcProcess } from "../pi-rpc/process.js"

type SessionCreateParams = {
  cwd: string
  mcpServers: McpServer[]
  conn: AgentSideConnection
}

export type StopReason = "end_turn" | "cancelled" | "error"

export class SessionManager {
  private sessions = new Map<string, PiAcpSession>()

  async create(params: SessionCreateParams): Promise<PiAcpSession> {
    const sessionId = crypto.randomUUID()
    const proc = await PiRpcProcess.spawn({ cwd: params.cwd })

    const session = new PiAcpSession({
      sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      proc,
      conn: params.conn,
    })

    this.sessions.set(sessionId, session)
    return session
  }

  get(sessionId: string): PiAcpSession {
    const s = this.sessions.get(sessionId)
    if (!s) throw RequestError.invalidParams(`Unknown sessionId: ${sessionId}`)
    return s
  }
}

class PiAcpSession {
  readonly sessionId: string
  readonly cwd: string
  readonly mcpServers: McpServer[]

  private readonly proc: PiRpcProcess
  private readonly conn: AgentSideConnection

  // Used to map abort semantics to ACP stopReason.
  private cancelRequested = false

  constructor(opts: {
    sessionId: string
    cwd: string
    mcpServers: McpServer[]
    proc: PiRpcProcess
    conn: AgentSideConnection
  }) {
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.mcpServers = opts.mcpServers
    this.proc = opts.proc
    this.conn = opts.conn

    this.proc.onEvent((ev) => {
      // TODO: translate pi events to ACP session/update notifications.
      // MVP skeleton: ignore.
      void ev
    })
  }

  async prompt(message: string): Promise<StopReason> {
    this.cancelRequested = false

    // TODO: send pi prompt, stream events to ACP via this.conn.sessionUpdate(...)
    // For now, call and wait for turn end.
    try {
      await this.proc.prompt(message)
      return this.cancelRequested ? "cancelled" : "end_turn"
    } catch {
      return this.cancelRequested ? "cancelled" : "error"
    }
  }

  async cancel(): Promise<void> {
    this.cancelRequested = true
    await this.proc.abort()
  }
}
