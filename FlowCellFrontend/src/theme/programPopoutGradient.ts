import { gradientPositionForPlacement, interpolateThemeColor } from "./themeModel.js";

/** Popout palettes retain every selected stop, including under Spread and Scatter. */
export function programPopoutGradientColor(args: {
  colors: readonly string[];
  spread: number;
  scatter: number;
  seed: number;
  placementId: string;
  y: number;
  minimumY: number;
  maximumY: number;
}): string {
  if (args.colors.length === 1) return args.colors[0];
  const range = args.maximumY - args.minimumY;
  const position = range > 0 ? Math.min(1, Math.max(0, (args.y - args.minimumY) / range)) : 0;
  const scaled = position * (args.colors.length - 1);
  const anchor = Math.round(scaled);
  if (Math.abs(scaled - anchor) < 1e-10) return args.colors[anchor];
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const spread = Math.min(1, Math.max(0, args.spread / 100));
  // Spread controls the transition width inside each interval, rather than
  // cropping the selected palette to its middle and losing its endpoints.
  const blend = spread > 0 ? 0.5 + (fraction - 0.5) / spread : fraction < 0.5 ? 0 : 1;
  const noise = gradientPositionForPlacement({
    placementId: args.placementId, y: 0.5, minimumY: 0, maximumY: 1,
    gradient: { spread: 100, scatter: args.scatter, seed: args.seed }
  }) - 0.5;
  const jitter = noise * 4 * fraction * (1 - fraction);
  return interpolateThemeColor(args.colors[index], args.colors[index + 1], blend + jitter);
}
