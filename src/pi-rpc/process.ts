import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as readline from "node:readline"

type PiRpcCommand =
  | { type: "prompt"; id?: string; message: string }
  | { type: "abort"; id?: string }
  | { type: "get_state"; id?: string }

type PiRpcResponse = { type: "response"; id: string; ok: boolean; result?: unknown; error?: unknown }

type PiRpcEvent = Record<string, unknown>

type SpawnParams = {
  cwd: string
  piCommand?: string
}

export class PiRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, { resolve: (v: PiRpcResponse) => void; reject: (e: unknown) => void }>()
  private eventHandlers: Array<(ev: PiRpcEvent) => void> = []

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child

    const rl = readline.createInterface({ input: child.stdout })
    rl.on("line", (line) => {
      if (!line.trim()) return
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        // ignore malformed lines for now
        return
      }

      if (msg?.type === "response" && typeof msg.id === "string") {
        const pending = this.pending.get(msg.id)
        if (pending) {
          this.pending.delete(msg.id)
          pending.resolve(msg as PiRpcResponse)
        }
      } else {
        for (const h of this.eventHandlers) h(msg as PiRpcEvent)
      }
    })

    child.on("exit", (code, signal) => {
      const err = new Error(`pi process exited (code=${code}, signal=${signal})`)
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
    })
  }

  static async spawn(params: SpawnParams): Promise<PiRpcProcess> {
    const cmd = params.piCommand ?? "pi"
    const child = spawn(cmd, ["--mode", "rpc", "--no-session"], {
      cwd: params.cwd,
      stdio: "pipe",
      env: process.env,
    })

    child.stderr.on("data", () => {
      // leave stderr untouched; ACP clients may capture it.
    })

    const proc = new PiRpcProcess(child)

    // Best-effort handshake.
    try {
      await proc.getState()
    } catch {
      // ignore for now
    }

    return proc
  }

  onEvent(handler: (ev: PiRpcEvent) => void) {
    this.eventHandlers.push(handler)
  }

  async prompt(message: string): Promise<void> {
    const res = await this.request({ type: "prompt", message })
    if (!res.ok) throw new Error(`pi prompt failed: ${JSON.stringify(res.error ?? res.result)}`)
  }

  async abort(): Promise<void> {
    const res = await this.request({ type: "abort" })
    if (!res.ok) throw new Error(`pi abort failed: ${JSON.stringify(res.error ?? res.result)}`)
  }

  async getState(): Promise<unknown> {
    const res = await this.request({ type: "get_state" })
    if (!res.ok) throw new Error(`pi get_state failed: ${JSON.stringify(res.error ?? res.result)}`)
    return res.result
  }

  private request(cmd: PiRpcCommand): Promise<PiRpcResponse> {
    const id = crypto.randomUUID()
    const withId = { ...cmd, id }

    const line = JSON.stringify(withId) + "\n"

    return new Promise<PiRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(line, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }
}
