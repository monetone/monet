// Allow CSS custom properties (e.g. `--accent`) in inline `style` objects.
import "react";
declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
