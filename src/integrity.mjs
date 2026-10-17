import {createHash} from 'node:crypto';

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
export function digest(domain,value) {
  identifier(domain);
  return createHash('sha256').update('dce-c14n-v0-dev\0'+domain+'\0'+canonicalize(value)).digest('hex');
}
export function validDigest(v) { invariant(typeof v==='string' && /^[a-f0-9]{64}$/.test(v),'Invalid digest'); return v; }

const hashBytes=bytes=>createHash('sha256').update(bytes).digest();
const leafHash=d=>hashBytes(Buffer.concat([Buffer.from([0]),Buffer.from(validDigest(d),'hex')]));
const parentHash=(l,r)=>hashBytes(Buffer.concat([Buffer.from([1]),l,r]));
/** Development Merkle tree; odd nodes duplicate, empty root is domain-separated. */
export function merkleBatch(digests) {
  invariant(Array.isArray(digests) && digests.length<=100000,'Invalid batch');
  let level=digests.map(leafHash);
  const levels=[level];
  while(level.length>1) {
    const next=[];
    for(let i=0;i<level.length;i+=2) next.push(parentHash(level[i],level[i+1]??level[i]));
    levels.push(next); level=next;
  }
  const treeRoot=level[0]?.toString('hex')??hashBytes(Buffer.from([2])).toString('hex');
  return {root:digest('merkle-batch',{count:digests.length,treeRoot}),count:digests.length,
    proofs:digests.map((_,index)=>{
      let i=index;
      const path=[];
      for(let l=0;l<levels.length-1;l++) {
        const row=levels[l]; const sibling=i^1;
        path.push({side:i%2?'left':'right',hash:(row[sibling]??row[i]).toString('hex')});
        i=Math.floor(i/2);
      }
      return {index,count:digests.length,path};
    })};
}
export function verifyInclusion(leaf,proof,root) {
  try {
    validDigest(root);
    invariant(proof && Number.isSafeInteger(proof.index) && Number.isSafeInteger(proof.count) && proof.count>0 && proof.count<=100000 && proof.index>=0 && proof.index<proof.count && Array.isArray(proof.path),'Invalid proof');
    let current=leafHash(leaf), i=proof.index, width=proof.count;
    for(const step of proof.path) {
      invariant(width>1 && step.side===(i%2?'left':'right'),'Invalid proof side');
      const other=Buffer.from(validDigest(step.hash),'hex');
      if(i%2===0 && i+1===width) invariant(other.equals(current),'Invalid duplicated odd node');
      current=step.side==='left'?parentHash(other,current):parentHash(current,other);
      i=Math.floor(i/2); width=Math.ceil(width/2);
    }
    return width===1 && digest('merkle-batch',{count:proof.count,treeRoot:current.toString('hex')})===root;
  } catch { return false; }
}
