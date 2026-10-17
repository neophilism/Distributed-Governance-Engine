import {TextSelection} from 'prosemirror-state';

function validText(value,limit) {
  return typeof value==='string'&&value.length<=limit&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
/** Literal, bounded search of editable body text; never crosses a block or reference atom. */
export function findTextMatches(state,query,{caseSensitive=false,limit=1000}={}) {
  if(!validText(query,256)||typeof caseSensitive!=='boolean'||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid bounded text search');
  const matches=[];let truncated=false;
  if(!query)return {matches,truncated};
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,caseSensitive?'gu':'giu');
  function collect(text,start) {
    pattern.lastIndex=0;let match;
    while((match=pattern.exec(text))!==null){
      if(matches.length===limit){truncated=true;return;}
      matches.push({from:start+match.index,to:start+match.index+match[0].length});
    }
  }
  state.doc.descendants((node,pos)=>{
    if(truncated)return false;
    if(!node.isTextblock)return true;
    let text='',start=pos+1;
    node.forEach((child,offset)=>{
      if(truncated)return;
      if(child.isText){if(!text)start=pos+1+offset;text+=child.text;}
      else{collect(text,start);text='';}
    });
    if(!truncated)collect(text,start);
    return false;
  });
  return {matches,truncated};
}
export function findNextText(query,options={}) {
  return (state,dispatch)=>{
    const {matches}=findTextMatches(state,query,options);if(!matches.length)return false;
    const match=matches.find(m=>m.from>=state.selection.to)??matches[0];
    if(dispatch)dispatch(state.tr.setSelection(TextSelection.create(state.doc,match.from,match.to)).scrollIntoView());
    return true;
  };
}
/** Recompute against current text; a stale selection cannot replace a different occurrence. */
export function replaceFoundText(query,replacement,{all=false,caseSensitive=false}={}) {
  return (state,dispatch)=>{
    if(!validText(replacement,10000)||typeof all!=='boolean')return false;
    const {matches,truncated}=findTextMatches(state,query,{caseSensitive});
    if(!matches.length||(all&&truncated))return false;
    const selected=all?matches:matches.filter(m=>m.from===state.selection.from&&m.to===state.selection.to);
    if(!selected.length)return false;
    const resultingLength=state.doc.textContent.length+selected.reduce((sum,m)=>sum+replacement.length-(m.to-m.from),0);
    if(resultingLength>1000000)return false;
    if(dispatch){const tr=state.tr;for(const match of [...selected].reverse())tr.insertText(replacement,match.from,match.to);dispatch(tr.scrollIntoView());}
    return true;
  };
}
