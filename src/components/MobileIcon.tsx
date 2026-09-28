import React from 'react';
const paths = {
 menu:'M4 6h16M4 12h16M4 18h16', plus:'M12 5v14M5 12h14', send:'m5 12 7-7 7 7M12 5v14',
 more:'M6 12h.01M12 12h.01M18 12h.01', chevron:'m9 5 7 7-7 7',
 note:'M6 3h9l4 4v14H5V3h1m9 0v5h5M8 12h8M8 16h6', pen:'m15 5 4 4M4 20l5-1L21 7l-4-4L5 15l-1 5Z',
 key:'M14 3a7 7 0 0 0-6 10L2 19v3h4v-3h3l2-2a7 7 0 1 0 3-14Zm3 4h.01',
 settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0'
};
export default function MobileIcon({name}: {name:keyof typeof paths}) {
 return <svg className="mobile-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name==='more'?3:1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
