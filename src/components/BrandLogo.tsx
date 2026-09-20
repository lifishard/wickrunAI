import React from 'react';
import './BrandLogo.css';

export default function BrandLogo({ loading = false, size = 28, label, className = '' }: {
  loading?: boolean; size?: number; label?: string; className?: string;
}) {
  return <svg viewBox="0 0 100 100" width={size} height={size}
    className={`wickrun-mark${loading ? ' is-loading' : ''} ${className}`}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <g className="wickrun-orbit">
      <path d="M75.46 75.46A36 36 0 1 1 85.09 41.96" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <circle cx="84.77" cy="59.32" r="4" fill="currentColor" />
    </g>
    <path className="wickrun-wick" d="M33 42C37 53 38 62 42 62S47 48 50 48S54 62 58 62S63 53 67 42"
      fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function BrandLoading({ label }: { label: string }) {
  return <div className="wickrun-loading" role="status"><BrandLogo loading /><span>{label}</span></div>;
}
