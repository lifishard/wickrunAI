import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'copy' | 'enter' | 'close' | 'plus' | 'settings' | 'fork' | 'retry' | 'edit'
  | 'menu' | 'trash' | 'back' | 'send' | 'search' | 'file' | 'audio' | 'video'
  | 'chevronRight' | 'chevronDown' | 'zoomIn' | 'zoomOut' | 'pin' | 'pinOff'
  | 'download' | 'folder' | 'sparkles' | 'clock' | 'more' | 'eyeOff' | 'arrowUpRight' | 'pause'
  | 'bolt' | 'circleHalf' | 'lock' | 'thumbsUp' | 'thumbsDown' | 'check'
  | 'checkCircle' | 'info' | 'list' | 'play' | 'brain' | 'shield'
  | 'calendar' | 'link' | 'monitor' | 'sun' | 'moon';

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & { name: IconName; size?: number };

/** One quiet outline family for controls. The containing button supplies its accessible name. */
export default function Icon({ name, size = 18, ...props }: Props) {
  const content: Record<IconName, ReactNode> = {
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    enter: <><path d="M20 4v8a4 4 0 0 1-4 4H5" /><path d="m9 12-4 4 4 4" /></>,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: <><path d="M12 3.5a2 2 0 0 1 2 1.4l.4 1.2 1.2.7 1.2-.3a2 2 0 0 1 2.2 1l1 1.8a2 2 0 0 1-.3 2.4l-.9.9v1.4l.9.9a2 2 0 0 1 .3 2.4l-1 1.8a2 2 0 0 1-2.2 1l-1.2-.3-1.2.7-.4 1.2a2 2 0 0 1-2 1.4h-2a2 2 0 0 1-2-1.4l-.4-1.2-1.2-.7-1.2.3a2 2 0 0 1-2.2-1l-1-1.8a2 2 0 0 1 .3-2.4l.9-.9v-1.4l-.9-.9a2 2 0 0 1-.3-2.4l1-1.8a2 2 0 0 1 2.2-1l1.2.3 1.2-.7.4-1.2a2 2 0 0 1 2-1.4z" /><circle cx="12" cy="12" r="3" /></>,
    fork: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 7v6a5 5 0 0 0 5 5h5M8 5h8" /></>,
    retry: <><path d="M20 11a8 8 0 1 0-2.2 6" /><path d="M20 4v7h-7" /></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4zM13 7l4 4" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>,
    back: <><path d="m10 6-6 6 6 6M4 12h11a5 5 0 0 1 5 5v2" /></>,
    send: <><path d="m3 11 18-8-8 18-2-8-8-2zM11 13l10-10" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    file: <><path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h8" /></>,
    audio: <><path d="M9 18V5l11-2v12M9 9l11-2" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="15" r="3" /></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>,
    chevronRight: <path d="m9 5 7 7-7 7" />,
    chevronDown: <path d="m5 9 7 7 7-7" />,
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M7.5 10.5h6" /></>,
    pin: <><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6zM12 14v7" /></>,
    pinOff: <><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6zM12 14v7M3 3l18 18" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" /></>,
    folder: <path d="M3 6h7l2 2h9v12H3z" />,
    sparkles: <><path d="m12 2 2.1 6 6 2.1-6 2.1L12 18l-2.1-5.8L4 10.1 9.9 8zM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    eyeOff: <><path d="M3 3 21 21M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M4.7 7.5A11 11 0 0 0 2 12s3.7 7 10 7a9.8 9.8 0 0 0 4.2-.9M9 5.4A10 10 0 0 1 12 5c6.3 0 10 7 10 7a15 15 0 0 1-2.5 3.2" /></>,
    arrowUpRight: <><path d="M5 19 19 5M8 5h11v11" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    bolt: <path d="m13 2-8 11h6l-1 9 9-12h-6l1-8z" />,
    circleHalf: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    thumbsUp: <><path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3zM7 10l4-7a2 2 0 0 1 3.6 1.4L14 8h5a3 3 0 0 1 2.9 3.8l-2 7A3 3 0 0 1 17 21H7" /></>,
    thumbsDown: <><path d="M7 14V3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3zM7 14l4 7a2 2 0 0 0 3.6-1.4L14 16h5a3 3 0 0 0 2.9-3.8l-2-7A3 3 0 0 0 17 3H7" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    brain: <><path d="M12 5a4 4 0 0 0-7.5 1.5A4 4 0 0 0 4 14a4 4 0 0 0 6 5.5c.6-.5 1.2-1.4 2-2.5V5zM12 5a4 4 0 0 1 7.5 1.5A4 4 0 0 1 20 14a4 4 0 0 1-6 5.5c-.6-.5-1.2-1.4-2-2.5" /><path d="M8 9c1.5 0 2.5 1 2.5 2.5M16 9c-1.5 0-2.5 1-2.5 2.5" /></>,
    shield: <><path d="M12 2 20 5v6c0 5-3 8-8 11-5-3-8-6-8-11V5z" /><path d="m9 12 2 2 4-4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3" /></>,
    link: <><path d="M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 10a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2" /></>,
    monitor: <><rect x="2" y="3" width="20" height="15" rx="2" /><path d="M8 22h8M12 18v4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z" />,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{content[name]}</svg>;
}
