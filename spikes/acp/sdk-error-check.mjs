// Offline check: does an Error thrown in an agent prompt handler reach the client with its message intact?
import * as acp from "@agentclientprotocol/sdk";
const mk = (thrower) => acp.agent({ name: "fake" })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "s1" }))
  .onRequest(acp.methods.agent.session.prompt, thrower);
const cases = {
  plainError: () => { throw new Error("Claude usage limit reached (429 rate limit)"); },
  requestError: () => { throw new acp.RequestError(-32000, "Authentication required", { detail: "please login" }); },
  authRequired: () => { throw acp.RequestError.authRequired?.({ x: 1 }) ?? new Error("no authRequired helper"); },
};
console.log("RequestError statics:", Object.getOwnPropertyNames(acp.RequestError).join(","));
for (const [name, fn] of Object.entries(cases)) {
  const c = acp.client({ name: "c" });
  try {
    await c.connectWith(mk(fn), async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      const s = await ctx.request(acp.methods.agent.session.new, { cwd: "/tmp", mcpServers: [] });
      await ctx.request(acp.methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: "text", text: "hi" }] });
    });
    console.log(name, "-> no error?!");
  } catch (e) {
    console.log(name, "->", JSON.stringify({ ctor: e?.constructor?.name, message: e?.message, code: e?.code, data: e?.data }));
  }
}
