import React,{useState} from 'react';
import {findTextMatches,replaceFoundText} from '../editor/search.mjs';

export function SearchTools({controller,editable,notify}) {
  const [query,setQuery]=useState(''),[replacement,setReplacement]=useState(''),[caseSensitive,setCaseSensitive]=useState(false);
  function find() {
    const result=controller.current?.findNext(query,{caseSensitive});
    notify(result?.found?(result.truncated?'More than 1,000 matches. Narrow your search.':`${result.matches.length} matching occurrence(s). Selected the next match.`):'No matching body text found.');
  }
  function replace(all) {
    const editor=controller.current;if(!editor)return;
    if(all&&findTextMatches(editor.view.state,query,{caseSensitive}).truncated){notify('More than 1,000 matches. Narrow your search before replacing all.');return;}
    const done=editor.command(replaceFoundText(query,replacement,{all,caseSensitive}));
    notify(done?(all?'All matching body text replaced. Use Undo to restore it.':'Selected occurrence replaced. Use Find next to select another.'):'Replacement was not applied. Select a matching occurrence or use a smaller replacement.');
  }
  return <form className="search-tools" aria-label="Find and replace body text" onSubmit={e=>{e.preventDefault();find();}}>
    <label>Find in body text<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={256}/></label>
    <label className="checkbox"><input type="checkbox" checked={caseSensitive} onChange={e=>setCaseSensitive(e.target.checked)}/>Match case</label>
    <button disabled={!query}>Find next</button>
    <label>Replace with<input value={replacement} onChange={e=>setReplacement(e.target.value)} disabled={!editable} maxLength={10000}/></label>
    <button type="button" disabled={!editable||!query} onClick={()=>replace(false)}>Replace selected</button>
    <button type="button" disabled={!editable||!query} onClick={()=>replace(true)}>Replace all</button>
  </form>;
}
