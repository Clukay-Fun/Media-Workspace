import type { TextStyle } from "./text-style";

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/u;
const CLOSE = /^[，。、；：！？”’）》」』〉】…—,.;:!?)\]%]$/u;

/** 以近似字宽估算自然折行；实际字体、字重和浏览器排版可能有误差。 */
export function estimateNaturalLines(
  text: string,
  style: TextStyle,
): { text: string; width: number }[] {
  const { size, letterSpacing } = style.font;
  const maxWidth = Math.max(1, style.layout.maxWidth - (style.box?.padding[1] ?? 0) * 2);
  const width = (s: string) =>
    [...s].reduce(
      (n, c) => n + (CJK.test(c) ? size : c === " " ? size * 0.3 : size * 0.55) + letterSpacing,
      0,
    );
  const result: { text: string; width: number }[] = [];
  for (const paragraph of text.split("\n")) {
    const tokens = paragraph.match(/[A-Za-z]+|[0-9]+|[^A-Za-z0-9]/gu) ?? [];
    let line = "";
    for (const token of tokens) {
      if (line && width(line + token) > maxWidth && !CLOSE.test(token)) {
        result.push({ text: line, width: width(line) });
        line = "";
      }
      line += token;
    }
    result.push({ text: line, width: width(line) });
  }
  return result;
}
