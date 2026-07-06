const greek: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
}

const symbols: Record<string, string> = {
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  proportional: "∝",
  propto: "∝",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
}

const superscript: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
}

const subscript: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
}

function scripted(input: string, map: Record<string, string>) {
  const rendered = input
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
  return rendered === input ? `^(${input})` : rendered
}

function formatMath(input: string): string {
  let out = input.trim()
  out = out
    .replace(/\\begin\{(?:equation|equation\*|aligned|align|align\*)\}/g, "")
    .replace(/\\end\{(?:equation|equation\*|aligned|align|align\*)\}/g, "")
    .replace(/\\\\/g, "\n")
    .replace(/&=/g, "=")
    .replace(/&/g, "")

  for (let i = 0; i < 4; i++) {
    out = out
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, numerator, denominator) => {
        return `(${formatMath(numerator)})/(${formatMath(denominator)})`
      })
      .replace(/\\sqrt\{([^{}]+)\}/g, (_, value) => `√(${formatMath(value)})`)
  }

  out = out
    .replace(/\^\{([^{}]+)\}/g, (_, value) => scripted(value, superscript))
    .replace(/_\{([^{}]+)\}/g, (_, value) => scripted(value, subscript))
    .replace(/\^([A-Za-z0-9+\-=()])/g, (_, value) => scripted(value, superscript))
    .replace(/_([A-Za-z0-9+\-=()])/g, (_, value) => scripted(value, subscript))
    .replace(/\\([A-Za-z]+)/g, (match, name) => greek[name] ?? symbols[name] ?? match.replace(/^\\/, ""))
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")

  return out.trim()
}

function formatNonCodeMarkdown(input: string): string {
  return input
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n${formatMath(math)}\n\n`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => `\n\n${formatMath(math)}\n\n`)
    .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, math) => `\n\n${formatMath(math)}\n\n`)
    .replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_, math) => `\n\n${formatMath(math)}\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => formatMath(math))
    .replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (_, math) => formatMath(math))
}

export function formatTerminalMath(markdown: string): string {
  const codeFencePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g
  return markdown
    .split(codeFencePattern)
    .map((part, index) => (index % 2 === 1 ? part : formatNonCodeMarkdown(part)))
    .join("")
}
