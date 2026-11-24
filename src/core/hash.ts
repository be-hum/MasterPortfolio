import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256String(s: string): string {
  return "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("error", reject)
      .on("end", () => resolve("sha256:" + h.digest("hex")));
  });
}
