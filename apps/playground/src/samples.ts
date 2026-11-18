export interface Sample {
  readonly label: string;
  readonly tex: string;
  readonly display: boolean;
}

/** Gallery for the M0 spike: one row per construct the product promises to support. */
export const SAMPLES: readonly Sample[] = [
  { label: 'inline', tex: 'E = mc^2 + \\frac{a}{b}', display: false },
  { label: '\\bm (greek)', tex: '\\bm{\\alpha} \\otimes \\bm{\\beta}', display: false },
  { label: '\\bm (latin)', tex: '\\bm{x} \\cdot \\bm{y}', display: false },
  { label: 'blackboard', tex: 'x \\in \\mathbb{R}^{n},\\ y \\in \\mathbb{C}', display: false },
  { label: 'fraktur / script', tex: '\\mathfrak{g} \\to \\mathscr{L} \\to \\mathcal{L}(V)', display: false },
  { label: 'bold vectors', tex: '\\mathbf{v} = \\sum_i \\mathbf{e}_i', display: false },
  {
    label: 'align',
    tex: '\\begin{align}\\nabla \\cdot \\bm{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\ \\nabla \\times \\bm{B} &= \\mu_0 \\bm{J}\\end{align}',
    display: true,
  },
  {
    label: 'cases',
    tex: 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
    display: true,
  },
  {
    label: 'intertext',
    tex: '\\begin{align} a &= b \\\\ \\intertext{and therefore} c &= d \\end{align}',
    display: true,
  },
  {
    label: 'nested matrix',
    tex: '\\begin{pmatrix} \\begin{matrix} 1 & 2 \\end{matrix} & 3 \\end{pmatrix}',
    display: true,
  },
  {
    label: 'document macro',
    tex: '\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert} \\norm{x} \\le 1',
    display: false,
  },
  { label: 'operator*, substack', tex: '\\operatorname*{arg\\,min}_{\\substack{x \\\\ y}} f(x,y)', display: false },
  { label: 'mathtools', tex: 'x \\coloneqq y \\xrightarrow{f} z', display: false },
  { label: 'CJK text', tex: '\\text{当 } x > 0 \\text{ 时，结论成立}', display: false },
  { label: 'tag override', tex: 'a = b \\tag{2.7}', display: true },
  { label: 'error (bad brace)', tex: '\\frac{1}{', display: false },
];
