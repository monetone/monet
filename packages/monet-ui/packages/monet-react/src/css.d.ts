// Allow CSS custom properties (e.g. `--accent`) in inline `style` objects.
// Monet passes the per-app accent through `style={{ "--accent": … }}`.
import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
