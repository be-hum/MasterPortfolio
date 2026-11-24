import { describe, it, expect } from "vitest";
import { detectSecret } from "../../src/privacy/secrets.js";
import { isSensitivePath } from "../../src/privacy/sensitivePath.js";

const codes = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

describe("detectSecret (본문 검사)", () => {
  it("flags private key blocks and well-known token formats", () => {
    expect(detectSecret("x\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).toBe("개인 키");
    expect(detectSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe("개인 키");
    expect(detectSecret("token: ghp_" + "a1".repeat(18))).toBe("API 키·토큰");
    expect(detectSecret("key=sk-ant-api03-" + "x1".repeat(20))).toBe("API 키·토큰");
    expect(detectSecret("AKIA" + "ABCDEFGHIJKLMNOP")).toBe("API 키·토큰");
    expect(detectSecret("AIza" + "b".repeat(35))).toBe("API 키·토큰");
  });
  it("flags 2FA backup/recovery code lists", () => {
    expect(detectSecret(codes(10, (i) => `${i}a1b2-c3d4${i}`.slice(0, 11)))).toBe("복구 코드");
    expect(detectSecret(codes(5, (i) => `${i + 1}. 1234 567${i}    ${i + 6}. 2345 678${i}`))).toBe("복구 코드");
    expect(detectSecret("GitHub recovery codes\nKeep these safe")).toBe("복구 코드");
    expect(detectSecret("디스코드 백업 코드 목록")).toBe("복구 코드");
  });
  it("does not flag normal documents", () => {
    expect(detectSecret("# 캡스톤 보고서\n정확도 92% 달성\nweek1 notes\n")).toBeNull();
    expect(detectSecret(codes(10, (i) => `hello world ${i}`))).toBeNull();
    expect(detectSecret(codes(10, () => "dead beef"))).toBeNull();
    expect(detectSecret("API 키는 환경변수로 관리했다. sk-로 시작하는 키 형식")).toBeNull();
    expect(detectSecret("NAND Flash https://news.sk-hynix.com/" + "a".repeat(40) + "-2024")).toBeNull();
  });
});

describe("isSensitivePath (계정 비밀 파일)", () => {
  it("flags backup/recovery code, key and password files and the 중요자료 folder", () => {
    for (const p of [
      "/c/Documents/x/Backup-codes-user.txt", "/c/Documents/x/site-recovery-codes.txt", "/c/x/chat_backup_codes.txt",
      "/c/x/host-recovery-codes-a@b.com.txt", "/c/x/someapp-key.txt", "/c/x/api_key.md", "/c/x/server.pem",
      "/c/x/passwords.txt", "/c/x/비밀번호.txt", "/c/x/credentials.json", "/c/x/2fa-codes.txt", "/c/x/복구 코드.txt",
      "/c/Documents/중요자료/anything.pdf",
    ]) expect(isSensitivePath(p, []), p).not.toBeNull();
  });
  it("keeps project and coursework files", () => {
    for (const p of [
      "/Users/k/projects/password-manager/README.md", "/c/x/password-cracking-report.md", "/c/x/keyboard.md",
      "/c/x/Codex/token-token-context-token/outputs/발표.pptx", "/c/x/암호분석/4. 최신 국제 표준 암호화인증 및 해시함수.pdf",
      "/c/x/monkey.txt", "/c/x/backup-plan.md",
    ]) expect(isSensitivePath(p, []), p).toBeNull();
  });
});
