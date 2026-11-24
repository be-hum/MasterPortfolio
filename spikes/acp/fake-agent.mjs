// Fake ACP agent on SDK 2.9.1 agent-side API, used to verify stdio wiring + error propagation.
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
const scenario = process.env.FAKE_AGENT_SCENARIO ?? "ok";
let n = 0;
acp.agent({ name: "fake-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: `s${++n}` }))
  .onNotification(acp.methods.agent.session.cancel, () => {})
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (scenario === "throw") throw new Error("Claude usage limit reached (429 rate limit)");
    if (scenario === "permission") {
      const r = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: "t1", title: "Read /etc/passwd", kind: "read", status: "pending" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }],
      });
      await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `outcome=${JSON.stringify(r.outcome)} ` } } });
    }
    await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "FAKE-REPLY" } } });
    return { stopReason: "end_turn" };
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
