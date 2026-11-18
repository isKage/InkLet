/**
 * A realistic fragment: headings, environments, labelled equations and cross
 * references, plus a price trap that must stay prose.
 */
export const MARKDOWN_SAMPLE = `# 一阶线性椭圆方程

设 $\\Omega \\subset \\mathbb{R}^n$ 为有界区域，$A(x)$ 一致椭圆。

::: theorem \\label{thm:main} 能量估计
若 $f \\in H^{-1}(\\Omega)$，则存在唯一弱解 $u$，且

$$
\\norm{u}_{H^1_0} \\le C \\norm{f}_{H^{-1}}
$$ \\label{eq:est}

其中 $C$ 只依赖于 $\\Omega$。
:::

::: proof
由 \\ref{thm:main} 取试验函数 $v = u$，结合 \\ref{eq:est} 立得。
:::

::: figure \\label{fig:a} 区域示意
![](region.png)
:::

注意 $5 和 $10 不是公式——悬空的美元符号必须被当成普通文本。
`;
