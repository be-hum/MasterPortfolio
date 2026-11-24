import { describe, it, expect } from "vitest";
import { maskText, sanitize } from "../../src/privacy/mask.js";

describe("maskText positives", () => {
  it.each([
    ["주민번호 900101-1234567 입니다", "[주민번호]", "rrn"],
    ["외국인 9001015234567", "[주민번호]", "rrn"],
    ["카드 4111-1111-1111-1111", "[카드번호]", "card"],
    ["입금 계좌: 국민 123456-01-123456", "[계좌번호]", "account"],
    ["여권번호 M12345678", "[여권번호]", "passport"],
    ["연락처 010-1234-5678", "[전화번호]", "phone"],
    ["연락처 01012345678", "[전화번호]", "phone"],
    ["+82 10-1234-5678 로 연락", "[전화번호]", "phone"],
    ["사무실 02-123-4567", "[전화번호]", "phone"],
    ["031)123-4567", "[전화번호]", "phone"],
    ["070-1234-5678", "[전화번호]", "phone"],
  ])("%s", (input, marker, kind) => {
    const r = maskText(input);
    expect(r.text).toContain(marker);
    expect(r.counts[kind as keyof typeof r.counts]).toBe(1);
  });
});

describe("maskText fix round 1 positives", () => {
  it.each([
    ["계좌번호:\n123456-01-123456", "[계좌번호]", "account"],
    ["국민은행 계좌번호는 아래와 같습니다\n123456-01-123456", "[계좌번호]", "account"],
    ["900101 - 1234567", "[주민번호]", "rrn"],
    ["900101–1234567", "[주민번호]", "rrn"],
    ["９００１０１-１２３４５６７", "[주민번호]", "rrn"],
    ["900101-1******", "[주민번호]", "rrn"],
    ["(02) 123-4567", "[전화번호]", "phone"],
    ["031) 123-4567", "[전화번호]", "phone"],
    ["+82 (0)10-1234-5678", "[전화번호]", "phone"],
    ["+82-2-123-4567", "[전화번호]", "phone"],
    ["여권번호 M123A4567", "[여권번호]", "passport"],
    ["여권번호 m12345678", "[여권번호]", "passport"],
    ["카드 4111 1111 1111 1111", "[카드번호]", "card"],
  ])("%s", (input, marker, kind) => {
    const r = maskText(input);
    expect(r.text).toContain(marker);
    expect(r.counts[kind as keyof typeof r.counts]).toBe(1);
  });
});

describe("maskText fix round 1 negatives", () => {
  it.each([
    "은행 안내입니다\n" + "가".repeat(40) + "\n123456-01-123456",
    "은행 프로젝트 202203-202212",
    "은행 프로젝트 20220301-20221231",
    "매출 230115\n1234567원",
    "2010 2011 2012 2013",
    "2015 2016 2017 2018",
    "ts 1700000015838",
  ])("%s is unchanged", (input) => {
    expect(maskText(input).text).toBe(input);
  });
});

describe("maskText negatives (Review Focus 3)", () => {
  it.each([
    "기간 2025-03-01 ~ 2025-06-30",
    "학번 20231234",
    "버전 1.2.3 배포",
    "2019-2023 재학",
    "정확도 92.5% 달성, 사용자 12,345명",
    "카드 1234-5678-9012-3456 (Luhn 실패)",
    "번호 123456-01-123456 (키워드 없음)",
    "M12345678 (키워드 없음)",
    "이메일 kim@example.com",
  ])("%s is unchanged", (input) => {
    expect(maskText(input).text).toBe(input);
  });
});

describe("sanitize", () => {
  it("reports marker ratio", () => {
    const r = sanitize("900101-1234567");
    expect(r.markerRatio).toBeGreaterThanOrEqual(0.8);
  });
});

describe("RRN separator bound", () => {
  it("masks up to 3 spaces/tabs on each side of the dash and leaves longer gaps alone", () => {
    expect(sanitize("900101 \t - \t1234567").text).toBe("[주민번호]");
    expect(sanitize("900101      1234567").text).toBe("[주민번호]"); // 대시 없이 3+3칸
    expect(sanitize("900101    -    1234567").text).toBe("900101    -    1234567");
    expect(sanitize("900101       1234567").text).toBe("900101       1234567");
  });
});
