import React from 'react';
export function usePhoneLayout() {
  const [phone, setPhone] = React.useState(() => matchMedia('(max-width: 860px)').matches);
  React.useEffect(() => { const query = matchMedia('(max-width: 860px)'); const update = () => setPhone(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return phone;
}
/** Track the visible area, including keyboard resize, without moving document scroll. */
export function installMobileViewport() {
  const viewport = window.visualViewport;
  const update = () => {
    document.documentElement.style.setProperty('--mobile-height', (viewport?.height ?? innerHeight) + 'px');
    document.documentElement.style.setProperty('--mobile-top', (viewport?.offsetTop ?? 0) + 'px');
    document.documentElement.toggleAttribute('data-keyboard-open', innerHeight - (viewport?.height ?? innerHeight) > 120);
  };
  update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
}
