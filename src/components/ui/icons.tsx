/** أيقونات SVG خفيفة — بلا أي مكتبة خارجية */

type P = { size?: number; className?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconType = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </svg>
)

export const IconPlay = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPause = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconSearch = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const IconClose = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconChevron = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconUpload = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
)

export const IconImage = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 3 3 3-3 5 5" />
  </svg>
)

export const IconVideo = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="m16 10 5-3v10l-5-3z" />
  </svg>
)

export const IconMusic = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="7" cy="17" r="3" />
    <circle cx="18" cy="15" r="3" />
    <path d="M10 17V5l11-2v12" />
  </svg>
)

export const IconDownload = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </svg>
)

export const IconShare = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="6" r="2.6" />
    <circle cx="18" cy="18" r="2.6" />
    <path d="m8.4 10.8 7.2-3.6M8.4 13.2l7.2 3.6" />
  </svg>
)

export const IconCheck = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m5 13 4 4L19 7" />
  </svg>
)

export const IconSparkle = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
)

export const IconBook = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 6c-1.8-1.6-4.4-2-8-2v14c3.6 0 6.2.4 8 2 1.8-1.6 4.4-2 8-2V4c-3.6 0-6.2.4-8 2z" />
    <path d="M12 6v14" />
  </svg>
)

export const IconPalette = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h6.5A2.5 2.5 0 0 0 21 9.5C21 5.9 17 3 12 3z" />
    <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconExport = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="m8 12 2.5 2.5L16 9" />
  </svg>
)

export const IconWave = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h1.5M8 8v8M12 5v14M16 8v8M19.5 12H21" />
  </svg>
)

export const IconBell = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
)

export const IconExpand = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />
  </svg>
)

export const IconRetry = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v4h-4" />
  </svg>
)

export const IconAlert = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 2.5 20h19L12 3z" />
    <path d="M12 10v4M12 17.2v.3" />
  </svg>
)

export const IconCrescent = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" fill="currentColor" stroke="none" />
  </svg>
)
