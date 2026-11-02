export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const groupNames={power:'전력',signal:'신호',cargo:'화물',scan:'검사'};
export const countCompleted=value=>Array.isArray(value)?value.length:Number(value)||0;
export function listen(target,event,handler,signal,options={}){target.addEventListener(event,handler,{...options,signal});}
export function focusHeading(root){root.querySelector('h1,h2')?.setAttribute('tabindex','-1');root.querySelector('h1,h2')?.focus({preventScroll:true});}
