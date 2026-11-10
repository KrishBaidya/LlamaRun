// Stdio MCP server that forwards to Cua Driver's `mcp` in a benchmark sandbox
// (agents/llamarun_bench/driver.py), so both agents hold one driver session per task.
//
//   CUA_MCP_TOKEN=... node bench/mcp-tcp.mjs <host> <port>
import { connect } from 'node:net'

const [host, port] = process.argv.slice(2)
const socket = connect(Number(port), host, () => {
  socket.write(`${process.env.CUA_MCP_TOKEN ?? ''}\n`)
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.on('close', () => process.exit(0))
socket.on('error', (err) => {
  console.error(`mcp-tcp: ${err.message}`)
  process.exit(1)
})
