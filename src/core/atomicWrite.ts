import { rename, writeFile } from "node:fs/promises";

/**
 * 임시 파일에 쓴 뒤 바꿔 넣는다. 작업을 [중지]로 강제 종료해도 기존 파일이 반쯤 쓰인 채 남지 않는다
 * (남는 것은 옛 내용이거나 새 내용 둘 중 하나).
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
