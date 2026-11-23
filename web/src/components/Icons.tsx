import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
});

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconClipboard = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const IconUndo = (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);
