// A small expression language for the `expr` object: numbers, `$i1`…`$i9`
// and `$f1`…`$f9` inlets, C-like operators and math functions. Parsed once
// into a tree and evaluated per message; it never calls `eval`. Ints and
// floats keep Max's typing: an operation on two ints is an int (division
// truncates), anything touching a float is a float.

export interface ExprValue { readonly value: number; readonly float: boolean }

type Node =
  | {kind: 'number'; value: number; float: boolean}
  | {kind: 'inlet'; index: number; float: boolean}
  | {kind: 'unary'; operator: string; operand: Node}
  | {kind: 'binary'; operator: string; left: Node; right: Node}
  | {kind: 'conditional'; test: Node; then: Node; otherwise: Node}
  | {kind: 'call'; name: string; args: Node[]};

export interface CompiledExpr {
  /** Number of inlets the expression reads (at least 1). */
  readonly inlets: number;
  /** Evaluate with inlet values; missing inlets read 0. */
  evaluate(inputs: readonly number[], random?: () => number): ExprValue;
}

const FUNCTIONS: Record<string, {arity: [number, number]; apply: (args: ExprValue[], random: () => number) => ExprValue}> = {
  abs: {arity: [1, 1], apply: ([a]) => ({value: Math.abs(a!.value), float: a!.float})},
  min: {arity: [2, 2], apply: ([a, b]) => ({value: Math.min(a!.value, b!.value), float: a!.float || b!.float})},
  max: {arity: [2, 2], apply: ([a, b]) => ({value: Math.max(a!.value, b!.value), float: a!.float || b!.float})},
  pow: {arity: [2, 2], apply: ([a, b]) => ({value: a!.value ** b!.value, float: true})},
  sqrt: {arity: [1, 1], apply: ([a]) => ({value: Math.sqrt(a!.value), float: true})},
  exp: {arity: [1, 1], apply: ([a]) => ({value: Math.exp(a!.value), float: true})},
  log: {arity: [1, 1], apply: ([a]) => ({value: Math.log(a!.value), float: true})},
  log10: {arity: [1, 1], apply: ([a]) => ({value: Math.log10(a!.value), float: true})},
  sin: {arity: [1, 1], apply: ([a]) => ({value: Math.sin(a!.value), float: true})},
  cos: {arity: [1, 1], apply: ([a]) => ({value: Math.cos(a!.value), float: true})},
  tan: {arity: [1, 1], apply: ([a]) => ({value: Math.tan(a!.value), float: true})},
  atan2: {arity: [2, 2], apply: ([a, b]) => ({value: Math.atan2(a!.value, b!.value), float: true})},
  floor: {arity: [1, 1], apply: ([a]) => ({value: Math.floor(a!.value), float: true})},
  ceil: {arity: [1, 1], apply: ([a]) => ({value: Math.ceil(a!.value), float: true})},
  round: {arity: [1, 1], apply: ([a]) => ({value: Math.round(a!.value), float: true})},
  int: {arity: [1, 1], apply: ([a]) => ({value: Math.trunc(a!.value), float: false})},
  float: {arity: [1, 1], apply: ([a]) => ({value: a!.value, float: true})},
  random: {arity: [2, 2], apply: ([a, b], random) => ({value: Math.floor(a!.value + random() * (b!.value - a!.value)), float: false})},
};

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11,
};

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*(\$[if][1-9]|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%()<>!~&|^,?:])/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError(`expr: cannot read "${source.slice(index).trim()}".`);
    tokens.push(match[1]!);
    index = pattern.lastIndex;
  }
  return tokens;
}

/** Parse an expression. Throws a SyntaxError naming the problem. */
export function compileExpr(source: string): CompiledExpr {
  const tokens = tokenize(source);
  if (!tokens.length) throw new SyntaxError('expr: the expression is empty.');
  let position = 0;
  let inlets = 1;
  const peek = () => tokens[position];
  const take = (expected?: string) => {
    const token = tokens[position];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new SyntaxError(`expr: expected ${expected ?? 'a value'}${token === undefined ? ' at the end' : ` but found "${token}"`}.`);
    }
    position++;
    return token;
  };

  const primary = (): Node => {
    const token = take();
    if (token === '(') { const inner = conditional(); take(')'); return inner; }
    if (token === '-' || token === '!' || token === '~' || token === '+') return {kind: 'unary', operator: token, operand: unary()};
    if (/^\$[if][1-9]$/.test(token)) {
      const index = Number(token[2]) - 1;
      inlets = Math.max(inlets, index + 1);
      return {kind: 'inlet', index, float: token[1] === 'f'};
    }
    if (/^[\d.]/.test(token)) return {kind: 'number', value: Number(token), float: /[.eE]/.test(token)};
    if (/^[A-Za-z_]/.test(token)) {
      if (token === 'pi') return {kind: 'number', value: Math.PI, float: true};
      const definition = FUNCTIONS[token];
      if (!definition) throw new SyntaxError(`expr: no function named ${token}.`);
      take('(');
      const args: Node[] = [];
      if (peek() !== ')') { args.push(conditional()); while (peek() === ',') { take(','); args.push(conditional()); } }
      take(')');
      if (args.length < definition.arity[0] || args.length > definition.arity[1]) throw new SyntaxError(`expr: ${token} takes ${definition.arity[0]} argument${definition.arity[0] === 1 ? '' : 's'}.`);
      return {kind: 'call', name: token, args};
    }
    throw new SyntaxError(`expr: unexpected "${token}".`);
  };
  const unary = (): Node => primary();
  const binary = (minimum: number): Node => {
    let left = unary();
    for (;;) {
      const operator = peek();
      const precedence = operator === undefined ? undefined : BINARY[operator];
      if (precedence === undefined || precedence < minimum) return left;
      take();
      // `**` is right-associative; everything else is left-associative.
      const right = binary(operator === '**' ? precedence : precedence + 1);
      left = {kind: 'binary', operator: operator!, left, right};
    }
  };
  const conditional = (): Node => {
    const test = binary(1);
    if (peek() !== '?') return test;
    take('?');
    const then = conditional();
    take(':');
    return {kind: 'conditional', test, then, otherwise: conditional()};
  };

  const tree = conditional();
  if (position < tokens.length) throw new SyntaxError(`expr: unexpected "${tokens[position]}".`);

  const evaluate = (node: Node, inputs: readonly number[], random: () => number): ExprValue => {
    switch (node.kind) {
      case 'number': return {value: node.value, float: node.float};
      case 'inlet': {
        const raw = inputs[node.index] ?? 0;
        return node.float ? {value: raw, float: true} : {value: Math.trunc(raw), float: false};
      }
      case 'unary': {
        const operand = evaluate(node.operand, inputs, random);
        if (node.operator === '-') return {value: -operand.value, float: operand.float};
        if (node.operator === '+') return operand;
        if (node.operator === '!') return {value: operand.value ? 0 : 1, float: false};
        return {value: ~Math.trunc(operand.value), float: false};
      }
      case 'conditional': return evaluate(node.test, inputs, random).value ? evaluate(node.then, inputs, random) : evaluate(node.otherwise, inputs, random);
      case 'call': return FUNCTIONS[node.name]!.apply(node.args.map(arg => evaluate(arg, inputs, random)), random);
      case 'binary': {
        const a = evaluate(node.left, inputs, random), b = evaluate(node.right, inputs, random);
        const float = a.float || b.float;
        const int = (value: number) => ({value: Math.trunc(value), float: false});
        switch (node.operator) {
          case '+': return {value: a.value + b.value, float};
          case '-': return {value: a.value - b.value, float};
          case '*': return {value: a.value * b.value, float};
          case '/': return float ? {value: a.value / b.value, float} : (b.value === 0 ? {value: 0, float} : int(a.value / b.value));
          case '%': return float ? {value: a.value % b.value, float} : (b.value === 0 ? {value: 0, float} : int(a.value % b.value));
          case '**': return {value: a.value ** b.value, float: float || b.value < 0};
          case '<': return {value: Number(a.value < b.value), float: false};
          case '<=': return {value: Number(a.value <= b.value), float: false};
          case '>': return {value: Number(a.value > b.value), float: false};
          case '>=': return {value: Number(a.value >= b.value), float: false};
          case '==': return {value: Number(a.value === b.value), float: false};
          case '!=': return {value: Number(a.value !== b.value), float: false};
          case '&&': return {value: Number(Boolean(a.value) && Boolean(b.value)), float: false};
          case '||': return {value: Number(Boolean(a.value) || Boolean(b.value)), float: false};
          case '&': return int(Math.trunc(a.value) & Math.trunc(b.value));
          case '|': return int(Math.trunc(a.value) | Math.trunc(b.value));
          case '^': return int(Math.trunc(a.value) ^ Math.trunc(b.value));
          case '<<': return int(Math.trunc(a.value) << Math.trunc(b.value));
          default: return int(Math.trunc(a.value) >> Math.trunc(b.value));
        }
      }
    }
  };

  return Object.freeze({
    inlets,
    evaluate: (inputs: readonly number[], random: () => number = Math.random) => {
      const result = evaluate(tree, inputs, random);
      return Number.isFinite(result.value) ? result : {value: 0, float: result.float};
    },
  });
}
