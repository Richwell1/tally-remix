import type { SVGProps } from "react";

// lucide-react v1 removed brand glyphs. These minimal inline equivalents keep
// the existing footer design intact and accept the same className props.
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
} as const;

export function Facebook(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z" />
    </svg>
  );
}

export function Linkedin(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 9h3v12H3V9zm6 0h3v1.7c.6-1 1.7-2 3.5-2 2.7 0 4.5 1.8 4.5 5V21h-3v-6.3c0-1.7-.8-2.7-2.2-2.7-1.3 0-2.3.9-2.3 2.7V21H9V9z" />
    </svg>
  );
}

export function Instagram(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.5-3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" />
    </svg>
  );
}

export function Twitter(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3h5.3l4 5.6L17.2 3H21l-6.7 7.7L21.4 21H16l-4.3-6-5.2 6H3l7.1-8.2L3 3z" />
    </svg>
  );
}
