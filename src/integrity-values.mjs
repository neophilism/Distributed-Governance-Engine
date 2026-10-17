export function invariant(condition, message) { if (!condition) throw new Error(message); }
export function identifier(value) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value), 'Invalid identifier');
  return value;
}
export function integer(value, {positive=false}={}) {
  invariant(typeof value==='string' && /^(0|[1-9][0-9]{0,77})$/.test(value), 'Expected a canonical unsigned decimal integer string');
  const n=BigInt(value);
  invariant(!positive || n>0n, 'Expected a positive integer');
  return n;
}
const validUnicode=s=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);

/** Restricted development canonical JSON. Not a claim of RFC 8785 implementation. */
export function canonicalize(value) {
  const seen=new Set();
  function visit(v,depth) {
    invariant(depth<=64,'Object exceeds canonical depth limit');
    if(v===null || typeof v==='boolean') return JSON.stringify(v);
    if(typeof v==='string') { invariant(validUnicode(v),'Invalid Unicode'); return JSON.stringify(v); }
    if(typeof v==='number') { invariant(Number.isSafeInteger(v) && !Object.is(v,-0),'Only safe integer numbers are supported'); return String(v); }
    invariant(typeof v==='object' && v!==null && !seen.has(v),'Unsupported or cyclic canonical value');
    invariant(Object.getOwnPropertySymbols(v).length===0,'Symbol keys are unsupported');
    seen.add(v);
    let result;
    if(Array.isArray(v)) {
      const keys=Object.keys(v);
      invariant(keys.length===v.length && keys.every((k,i)=>k===String(i)),'Sparse or decorated arrays are unsupported');
      result='['+keys.map(k=>{const d=Object.getOwnPropertyDescriptor(v,k);invariant(d&&Object.hasOwn(d,'value'),'Accessor properties are unsupported');return visit(d.value,depth+1);}).join(',')+']';
    } else {
      invariant(Object.getPrototypeOf(v)===Object.prototype || Object.getPrototypeOf(v)===null,'Only plain objects are supported');
      result='{'+Object.keys(v).sort().map(k=>{
        invariant(validUnicode(k),'Invalid Unicode key');
        const d=Object.getOwnPropertyDescriptor(v,k);
        invariant(d && Object.hasOwn(d,'value'),'Accessor properties are unsupported');
        return JSON.stringify(k)+':'+visit(d.value,depth+1);
      }).join(',')+'}';
    }
    seen.delete(v);
    return result;
  }
  return visit(value,0);
}
export function validDigest(v) { invariant(typeof v==='string' && /^[a-f0-9]{64}$/.test(v),'Invalid digest'); return v; }
