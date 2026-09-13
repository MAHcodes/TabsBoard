/* TabsBoard — color utilities for theme derivation */
(function (root) {
  function clamp(n) { return Math.max(0, Math.min(255, n)); }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 8) hex = hex.slice(0, 6);
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('');
  }

  // Blend `hex` toward `target` by ratio 0..1
  function mix(hex, target, ratio) {
    const a = hexToRgb(hex), b = hexToRgb(target);
    return rgbToHex({
      r: a.r + (b.r - a.r) * ratio,
      g: a.g + (b.g - a.g) * ratio,
      b: a.b + (b.b - a.b) * ratio
    });
  }

  function lighten(hex, pct) { return mix(hex, '#ffffff', pct / 100); }
  function darken(hex, pct) { return mix(hex, '#000000', pct / 100); }

  function withAlpha(hex, alphaHex) { return hex + alphaHex; }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const [rl, gl, bl] = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }

  const ColorUtils = { hexToRgb, rgbToHex, mix, lighten, darken, withAlpha, relativeLuminance };
  if (typeof module !== 'undefined') module.exports = ColorUtils;
  root.ColorUtils = ColorUtils;
})(typeof self !== 'undefined' ? self : this);
