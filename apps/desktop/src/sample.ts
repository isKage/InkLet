/**
 * The demo document the `#demo` workspace opens. It exercises every construct
 * the editor supports, so the first launch demonstrates rather than explains.
 */
export const SAMPLE = `# 一阶线性椭圆方程

设 $\\Omega \\subset \\mathbb{R}^n$ 为有界区域，$A(x)$ 一致椭圆。

**能量估计**：若 $f \\in H^{-1}(\\Omega)$，则存在唯一弱解 $u \\in H^1_0(\\Omega)$，且

$$
\\lVert u \\rVert_{H^1_0} \\le C \\lVert f \\rVert_{H^{-1}}
$$

其中 $C$ 只依赖于 $\\Omega$ 与椭圆常数。

称 $A$ **一致椭圆**，若存在 $\\lambda, \\Lambda > 0$ 使得

$$
\\lambda |\\xi|^2 \\le \\xi^\\top A(x) \\xi \\le \\Lambda |\\xi|^2 .
$$

## 离散格式

记 $V_h \\subset H^1_0$ 为分片线性有限元空间，双线性形式

$$
a_h(u_h, v_h) \\coloneqq \\int_\\Omega \\nabla u_h \\cdot A \\nabla v_h \\, dx .
$$

等价的 LaTeX 写法也可以：

\\[
\\nabla \\cdot (A \\nabla u) = f
\\]

需要编号时写 \`\\tag{2.7}\`：

$$
a = b \\tag{2.7}
$$

数值上使用如下迭代：

\`\`\`python
for _ in range(max_iter):
    r = b - A @ x
    x += tau * r
\`\`\`

对齐写法：

$$
\\begin{align}
a_h(u_h, v_h) &= (f, v_h) && \\forall v_h \\in V_h, \\\\
u_h(0) &= 0 .
\\end{align}
$$

![三角形剖分](mesh.png)

## 备注

**注意**：收敛性依赖 *一致椭圆* 假设，否则 $C$ 会依赖于网格。行内代码 \`a_h(.,.)\` 也应当保留。

- 列表项里的公式 $\\mathcal{O}(h)$ 也会渲染；
- 价格 $5 和 $10 不是公式；
- 这一个条目故意写得比较长，用来检查多行与自动换行时的悬挂缩进是否对齐，
  第二行应当从第一行正文的起始位置开始，而不是退回到圆点下面。

| 网格 | $L^2$ 误差 | $H^1$ 误差 |
|---|---|---|
| $h$ | $\\mathcal{O}(h^2)$ | $\\mathcal{O}(h)$ |
| $h/2$ | $\\mathcal{O}(h^2)$ | $\\mathcal{O}(h)$ |
`;
