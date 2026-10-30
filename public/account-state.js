'use strict';
// UI authorization is fail-closed. The server still verifies every private request.
(() => {
  let state = Object.freeze({status:'unknown', actor:null, generation:0});
  const snapshot = () => state;
  const canContribute = () => state.status === 'signed_in';
  const isCurrent = expected => !!expected && canContribute() && expected.actor === state.actor && expected.generation === state.generation;
  const isTemporaryTransition = detail => Boolean(detail?.previous?.actor && detail.previous.actor === detail.current?.actor &&
    ((detail.previous.status === 'signed_in' && detail.current.status === 'unknown') || (detail.previous.status === 'unknown' && detail.current.status === 'signed_in')));
  function render() {
    document.documentElement.dataset.accountState = state.status;
    const paused = state.status === 'unknown' && Boolean(state.actor);
    document.documentElement.dataset.accountPaused = String(paused);
    document.querySelectorAll('[data-requires-account]').forEach(node => { node.hidden = !canContribute(); });
    for (const id of ['recordEditorDialog','ownEditsDialog','candidateDialog','accountDialog','contributorsDialog']) {
      const dialog = document.getElementById?.(id);
      if (dialog) dialog.inert = paused || (['recordEditorDialog','ownEditsDialog','candidateDialog'].includes(id) && !canContribute());
    }
  }
  function transition(status, actor = null) {
    if (state.status === status && state.actor === actor) return;
    const previous = state;
    state = Object.freeze({status, actor, generation:previous.generation + 1});
    render();
    window.dispatchEvent(new CustomEvent('hauntologies-auth-changed', {detail:{previous, current:state}}));
    if (previous.actor && previous.actor !== actor) window.dispatchEvent(new CustomEvent('contributions-session-ended', {detail:{stateManaged:true}}));
    if (actor && previous.actor !== actor) window.dispatchEvent(new CustomEvent('contributions-session-started', {detail:{actor}}));
  }
  const resolve = session => typeof session?.actor_id === 'string' && session.actor_id && session.password_required === false ? transition('signed_in', session.actor_id) : transition('signed_out');
  const invalidate = expected => { if (!expected || isCurrent(expected)) transition('signed_out'); };
  const pause = () => { if (state.status === 'signed_in') transition('unknown', state.actor); };
  window.HauntologiesAccount = Object.freeze({snapshot, canContribute, isCurrent, isTemporaryTransition, resolve, invalidate, pause, suspend:()=>transition('unknown')});
  window.addEventListener('contributions-session-ended', event => {
    if(event.detail?.stateManaged)return;
    if(event.detail?.signedOut&&state.actor){try{localStorage.setItem('hauntologies-signed-out:'+state.actor,String(Date.now()));}catch{}}
    invalidate();
  });
  // Includes controls inserted into record cards after the initial catalog request.
  new MutationObserver(render).observe(document.body, {childList:true, subtree:true});
  for (const type of ['click','submit']) document.addEventListener(type, event => {
    if (!canContribute() && event.target.closest?.('[data-requires-account]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  render();
})();
