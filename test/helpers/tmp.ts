import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const mkTmp = (prefix = "mp-test-") => mkdtemp(join(tmpdir(), prefix));
