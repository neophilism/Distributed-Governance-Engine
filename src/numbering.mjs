import {invariant} from './integrity.mjs';
export const FEDERAL_HIERARCHY=Object.freeze(['section','lower-alpha','decimal','upper-alpha','lower-roman','upper-roman']);
const alpha=n=>{let s='';while(n>0){n--;s=String.fromCharCode(97+n%26)+s;n=Math.floor(n/26);}return s;};
function roman(n) {
  invariant(n<=3999,'Roman numbering above 3999 needs an explicit alternate profile');
  let s=''; for(const [v,t] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) while(n>=v){s+=t;n-=v;}
  return s;
}
export function legalLabel(index,depth,profile=FEDERAL_HIERARCHY) {
  invariant(Number.isSafeInteger(index)&&index>0&&index<=1000000,'Invalid legal numbering index');
  invariant(Array.isArray(profile)&&Number.isSafeInteger(depth)&&depth>=0&&depth<profile.length,'Invalid legal numbering level');
  const style=profile[depth];
  if(style==='section') return 'SEC. '+index+'.';
  if(style==='decimal') return '('+index+')';
  if(style==='lower-alpha') return '('+alpha(index)+')';
  if(style==='upper-alpha') return '('+alpha(index).toUpperCase()+')';
  if(style==='lower-roman') return '('+roman(index).toLowerCase()+')';
  if(style==='upper-roman') return '('+roman(index)+')';
  throw new Error('Unknown numbering style');
}
