/*!
 * PatentLens shared date helpers
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL.
 */

// Classic-script binding is intentional while the legacy renderer is being
// migrated incrementally. Keep the function signature and coercion behavior
// identical to the original implementation.
function parseDocDateToTimestamp(d) {
  if (!d) return 0;
  const s = String(d).trim();
  if (!s) return 0;
  const ts = new Date(s).getTime();
  if (!isNaN(ts) && ts > 0) return ts;
  const normalized = s.replace(/[.\-]/g, "/");
  const parts = normalized.split("/").map(p => parseInt(p));
  if (parts.length >= 3) {
    let y, m, day;
    if (parts[0] > 31) {
      y = parts[0]; m = parts[1]; day = parts[2];
    } else if (parts[2] > 31) {
      y = parts[2];
      if (parts[0] > 12) {
        day = parts[0]; m = parts[1];
      } else if (parts[1] > 12) {
        m = parts[0]; day = parts[1];
      } else {
        m = parts[0]; day = parts[1];
      }
    } else {
      y = parts[0] > 31 ? parts[0] : (parts[2] > 31 ? parts[2] : parts[0]);
      m = parts[1] || 1;
      day = parts[2] || 1;
    }
    y = y || 1970; m = (m >= 1 && m <= 12) ? m : 1; day = (day >= 1 && day <= 31) ? day : 1;
    if (y < 100) y += 2000;
    return new Date(y, m - 1, day).getTime();
  }
  return 0;
}

