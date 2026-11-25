import { it, expect } from "vitest";
import { pathInputError } from "../../src/setup/config.js";
it("UNC paths (WSL shares) are accepted as full paths on Windows", () => { expect(pathInputError("\\\\wsl.localhost\\Ubuntu\\home\\yh\\projects", "win32")).toBeNull(); expect(pathInputError("\\\\wsl$\\Ubuntu\\home", "win32")).toBeNull(); });
