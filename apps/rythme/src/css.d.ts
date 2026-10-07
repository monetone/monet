// Allow `import "...css"` side-effect imports and CSS custom properties in
// inline style objects (e.g. `style={{ "--accent": color }}`).
declare module "*.css";

import "react";
declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
