import { describe, expect, it } from 'vitest';
import { createAcademicParser, extractMathSource, NodeNames } from '../src/index.js';

const parser = createAcademicParser();

/** A fragment in the shape a researcher would actually type. */
const FRAGMENT = `# 一阶线性椭圆方程

设 $\\Omega \\subset \\mathbb{R}^n$ 为有界区域。

若 $f \\in H^{-1}(\\Omega)$，则存在唯一 $u$ 使得

$$
\\norm{u}_{H^1_0} \\le C \\norm{f}_{H^{-1}}
$$

其中 $C$ 只依赖于 $\\Omega$。

## 方法

- 取试验函数 $v = u$
- 逐项估计

| 网格 | 误差 |
| --- | --- |
| $h$ | $O(h^2)$ |

\`\`\`python
def energy(u):
    return 0.5 * norm(grad(u)) ** 2
\`\`\`
`;

interface Hit {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

function hits(src: string): Hit[] {
  const tree = parser.parse(src);
  const found: Hit[] = [];
  tree.iterate({
    enter(node) {
      found.push({
        name: node.name,
        from: node.from,
        to: node.to,
        text: src.slice(node.from, node.to),
      });
    },
  });
  return found;
}

describe('academic fragment', () => {
  const found = hits(FRAGMENT);
  const named = (name: string): Hit[] => found.filter((h) => h.name === name);

  it('covers the document exactly', () => {
    expect(parser.parse(FRAGMENT).length).toBe(FRAGMENT.length);
  });

  it('finds the headings', () => {
    expect(named('ATXHeading1').map((h) => h.text)).toEqual(['# 一阶线性椭圆方程']);
    expect(named('ATXHeading2').map((h) => h.text)).toEqual(['## 方法']);
  });

  it('finds display maths with the TeX apart from the delimiters', () => {
    let tex = '';
    let count = 0;
    parser.parse(FRAGMENT).iterate({
      enter(node) {
        if (node.name !== NodeNames.DisplayMath) return;
        count += 1;
        tex = extractMathSource(FRAGMENT, node.node);
      },
    });
    expect(count).toBe(1);
    expect(tex).toBe('\\norm{u}_{H^1_0} \\le C \\norm{f}_{H^{-1}}');
  });

  it('keeps inline maths, lists and tables as real blocks', () => {
    expect(named(NodeNames.InlineMath).length).toBeGreaterThanOrEqual(4);
    expect(named('ListItem').length).toBe(2);
    expect(named('Table')).toHaveLength(1);
    expect(named('FencedCode')).toHaveLength(1);
  });

  it('leaves the dollar amounts in prose alone', () => {
    const prose = hits('价格 $5 和 $10 不是公式。');
    expect(prose.filter((h) => h.name === NodeNames.InlineMath)).toHaveLength(0);
  });
});
