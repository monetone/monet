// DevRow — the dense develop-panel slider row for Galerie's narrow rail. A thin
// wrapper over the shared monet-react SliderRow (the promoted form of Vision's
// old local Row) with rail-sized columns and integer stepping by default.

import { SliderRow } from "@monet-ui/monet-react";

export interface DevRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Double-click resets (matches galerie's slider double-click-to-zero). */
  onReset?: () => void;
  suffix?: string;
  decimals?: number;
  format?: (v: number) => string;
}

export function DevRow({ step = 1, ...props }: DevRowProps) {
  return <SliderRow labelWidth={64} valueWidth={30} step={step} {...props} />;
}
