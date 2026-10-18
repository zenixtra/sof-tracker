# SoF Tracker screen reader: looks at the game window like you do (a screenshot of what's on screen, never the
# game's memory) and reads HP, MP, level and EXP from the HUD and loot announcements from the chat box, using the
# text recognition built into Windows. Prints one JSON line per look. Started by the tracker when you switch it on.
#   -GamePid <pid>   read that game window every -Interval seconds
#   -Image <file>    read one saved screenshot instead (for testing)
#   -Once            one look, then stop;  -SaveFrame <file.png>  also save what was captured (checking the regions)
#   -RingDir <dir>   keep the last -RingSize looks there as f0.jpg … (for death replays and drop pictures)
param([int]$GamePid = 0, [string]$Image = '', [double]$Interval = 3, [double]$Fast = 0, [string]$Regions = '', [switch]$Once, [string]$SaveFrame = '', [string]$DebugDir = '',
  [string]$RingDir = '', [int]$RingSize = 12, [string]$IntervalFile = '', [string]$IconIndex = '', [string]$HotbarIds = '', [string]$FontFile = '')
#   -IconIndex <f>   data\icon-index.bin: the item and skill icons a buff can show with (built by the tracker)
#   -IntervalFile <f> "seconds;fast" is read from this file before every pause (the tracker speeds up and slows down
#                     the reading without restarting it); 0 seconds = the next full look right away
#   -HotbarIds <ids> item ids to look for on the hotbar (comma separated: potions, ginseng); -FontFile: the game's font
#                    (MG BASIC2.TTF), for reading the counts on them
#   -Fast <n>        n fast looks per second during the pause: only the HP / MP / EXP bars, by pixel colour ({"q":1,…})
$ring = 0; $look = 0
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false # the tracker reads UTF-8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]

# compiled with optimisation: the icon search goes over a few hundred thousand screen positions per look
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
$cp.CompilerOptions = '/optimize+'
foreach ($a in 'System.dll', 'System.Core.dll', 'System.Drawing.dll') { [void]$cp.ReferencedAssemblies.Add($a) }
Add-Type -CompilerParameters $cp -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class SofScreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, int rop);
  public static string LastMethod = "";
  // the game window's inside (null when minimised). Copied from the window's own picture, which Windows keeps
  // even while other windows cover the game; copied from the screen when that comes back empty and the game is in front.
  public static Bitmap Capture(IntPtr hwnd) {
    LastMethod = "hidden";
    if (hwnd == IntPtr.Zero || IsIconic(hwnd)) return null;
    RECT r; if (!GetClientRect(hwnd, out r) || r.R < 200 || r.B < 200) return null;
    LastMethod = "covered";
    var bmp = new Bitmap(r.R, r.B, PixelFormat.Format24bppRgb);
    bool ok;
    using (var g = Graphics.FromImage(bmp)) {
      var hdc = g.GetHdc(); var src = GetDC(hwnd);
      ok = src != IntPtr.Zero && BitBlt(hdc, 0, 0, r.R, r.B, src, 0, 0, 0x00CC0020); // SRCCOPY
      if (src != IntPtr.Zero) ReleaseDC(hwnd, src); g.ReleaseHdc(hdc);
    }
    if (ok && !Blank(bmp)) { LastMethod = "window"; return bmp; }
    if (!InFront(hwnd)) { bmp.Dispose(); return null; }
    POINT p = new POINT(); ClientToScreen(hwnd, ref p);
    using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(r.R, r.B));
    LastMethod = "screen"; return bmp;
  }
  // all one colour (black): the window gave nothing
  static bool Blank(Bitmap b) {
    var c0 = b.GetPixel(0, 0);
    for (int y = 0; y < b.Height; y += 37) for (int x = 0; x < b.Width; x += 41) if (b.GetPixel(x, y) != c0) return false;
    return true;
  }
  public static bool InFront(IntPtr hwnd) { return GetForegroundWindow() == hwnd; }
  // the EXP bar: a cyan strip a few pixels above the bottom edge, filled from the left. Fraction filled, or -1.
  // filled part: cyan, ending in a light tip; empty part: dark olive; the bar ends at a gold border on the right
  public static double ExpFill(Bitmap src) {
    double best = -1; int bestCount = 0;
    for (int y = Math.Max(0, src.Height - 14); y < src.Height; y++) {
      // follow the filled run from the left; gaps of a few pixels (blur, compression noise) are bridged
      int first = -1, last = -1, count = 0, gap = 0;
      for (int x = 0; x < src.Width; x++) {
        var c = src.GetPixel(x, y);
        bool cyan = c.B > 170 && c.G > 120 && c.R < 90;
        if (cyan) { if (first < 0) first = x; last = x; count++; gap = 0; }
        else if (first >= 0 && ++gap > 4) break;
      }
      if (first < 0 || first > 30 || count < 3) continue;
      int end = src.Width - 1; // the gold border: reddish-brown, little blue
      for (int x = src.Width - 1; x > last; x--) { var c = src.GetPixel(x, y); if (!(c.R > 85 && c.B < 45 && c.R > c.B + 50)) { end = x; break; } }
      double fill = (double)(last - first + 1) / Math.Max(1, end - first + 1);
      if (count > bestCount) { bestCount = count; best = Math.Min(1.0, fill); }
    }
    return best;
  }
  // text -> black on white, scaled up (what the OCR reads best). mode 0: by brightness, 1: by the strongest colour
  // channel (blue, yellow and orange chat text are as "bright" as white there)
  public static Bitmap Prep(Bitmap src, int x, int y, int w, int h, int scale, int minLum) { return Prep(src, x, y, w, h, scale, minLum, 0); }
  public static Bitmap Prep(Bitmap src, int x, int y, int w, int h, int scale, int minLum, int mode) {
    x = Math.Max(0, Math.Min(x, src.Width - 1)); y = Math.Max(0, Math.Min(y, src.Height - 1));
    w = Math.Min(w, src.Width - x); h = Math.Min(h, src.Height - y);
    var outp = new Bitmap(w * scale, h * scale, PixelFormat.Format24bppRgb);
    var sd = src.LockBits(new Rectangle(x, y, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var od = outp.LockBits(new Rectangle(0, 0, outp.Width, outp.Height), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
    var s = new byte[sd.Stride * h]; Marshal.Copy(sd.Scan0, s, 0, s.Length);
    var o = new byte[od.Stride * outp.Height];
    for (int j = 0; j < outp.Height; j++) for (int i = 0; i < outp.Width; i++) {
      int si = (j / scale) * sd.Stride + (i / scale) * 3;
      bool ink;
      if (mode == 2) ink = IsChatColor(s[si + 2], s[si + 1], s[si]);
      // mode 3: red text only (the skill levels drawn in red on the skill icons)
      else if (mode == 3) { int rr = s[si + 2], gg = s[si + 1], bb = s[si]; ink = rr > 150 && gg < 110 && bb < 110 && rr - gg > 80; }
      // mode 4: the hotbar's item counts, pale green-cyan (not the icon under them: reddish, or leaf green with little blue)
      else if (mode == 4) { int rr = s[si + 2], gg = s[si + 1], bb = s[si]; ink = rr + gg + bb >= 330 && gg >= rr; }
      else {
        double lum = mode == 1 ? Math.Max(s[si], Math.Max(s[si + 1], s[si + 2])) : 0.11 * s[si] + 0.59 * s[si + 1] + 0.3 * s[si + 2];
        ink = lum > minLum;
      }
      byte v = ink ? (byte)0 : (byte)255;
      int oi = j * od.Stride + i * 3; o[oi] = v; o[oi + 1] = v; o[oi + 2] = v;
    }
    Marshal.Copy(o, 0, od.Scan0, o.Length);
    src.UnlockBits(sd); outp.UnlockBits(od);
    return outp;
  }
  // an item tooltip: a darkened box with a 1-pixel light grey border (the title's colour depends on the item, the
  // box does not). Found by its top border (a long grey line with dark pixels just below) and its left border
  // (a grey column going down). Returns "x,y,w,h" or "".
  static bool Rim(byte[] s, int i) {
    int b = s[i], g = s[i + 1], r = s[i + 2], mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
    return mn >= 100 && mx <= 215 && mx - mn <= 45;
  }
  static int Max3(byte[] s, int i) { return Math.Max(s[i], Math.Max(s[i + 1], s[i + 2])); }
  public static string FindTooltip(Bitmap src) {
    int W = src.Width, H = src.Height;
    var d = src.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var s = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, s, 0, s.Length); int st = d.Stride; src.UnlockBits(d);
    for (int y = 30; y < H - 80; y++) {
      int run = 0, dark = 0;
      for (int x = 0; x < W; x++) {
        int i = y * st + x * 3, below = (y + 3) * st + x * 3;
        if (Rim(s, i)) { run++; if (Max3(s, below) < 110) dark++; }
        else {
          // a top border: 150+ px of grey line, mostly dark just inside
          if (run >= 150 && dark >= run * 0.7) {
            int x0 = x - run, x1 = x - 1;
            // the left and right borders go down from the corners (allow a pixel of slack for the corner)
            int down = 0, gap = 0;
            for (int yy = y + 1; yy < H && gap <= 2; yy++) {
              bool l = Rim(s, yy * st + x0 * 3) || (x0 + 1 < W && Rim(s, yy * st + (x0 + 1) * 3));
              bool r = Rim(s, yy * st + x1 * 3) || (x1 > 0 && Rim(s, yy * st + (x1 - 1) * 3));
              if (l || r) { down++; gap = 0; } else gap++;
            }
            if (down >= 60) {
              // something drawn over the top border (an item icon) can cut the line short: the right border is the
              // furthest grey column to the right that goes down most of the box's height
              // (and the top border has to run most of the way there, so a window frame further right isn't taken)
              for (int xr = Math.Min(W - 1, x1 + 300); xr > x1; xr--) {
                int hits = 0, top = 0;
                for (int yy = y + 1; yy <= y + down; yy++) if (Rim(s, yy * st + xr * 3)) hits++;
                if (hits < down * 0.6 || !Rim(s, y * st + xr * 3)) continue;
                for (int xx = x1; xx <= xr; xx++) if (Rim(s, y * st + xx * 3)) top++;
                if (top >= (xr - x1 + 1) * 0.7) { x1 = xr; break; }
              }
              return x0 + "," + y + "," + (x1 - x0 + 1) + "," + (down + 1);
            }
          }
          run = 0; dark = 0;
        }
      }
    }
    return "";
  }
  // the quest window (Ctrl+Q): its selected tab is a purple bar ("Quest in progress" or, one row lower, "Available
  // Quest"); the quest list is to the right of it. Returns "x,y,mode" (x, y: the bar's top-left; mode: progress | available)
  static bool Purple(byte[] s, int i) { int b = s[i], g = s[i + 1], r = s[i + 2]; return b >= 90 && b <= 160 && r >= 50 && r <= 95 && b - r >= 35 && b - g >= 45; }
  public static string FindQuestWindow(Bitmap src) {
    int W = src.Width, H = src.Height;
    var d = src.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var s = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, s, 0, s.Length); int st = d.Stride; src.UnlockBits(d);
    for (int y = 20; y < H - 300; y++) {
      int run = 0;
      for (int x = 0; x < W - 450; x++) {
        if (Purple(s, y * st + x * 3)) { run++; continue; }
        if (run >= 90 && run <= 150) {
          int x0 = x - run;
          // a few rows of the bar, then the list's dark background to the right
          int rows = 0; for (int yy = y; yy < y + 6; yy++) if (Purple(s, yy * st + (x0 + run / 2) * 3)) rows++;
          int dark = 0; for (int k = 0; k < 20; k++) { int i = (y + 90 + k * 8) * st + (x0 + 260) * 3; if (Math.Max(s[i], Math.Max(s[i + 1], s[i + 2])) < 70) dark++; }
          if (rows >= 4 && dark >= 12) {
            // a grey (unselected) button right above: this purple one is "Available Quest"
            int grey = 0; for (int k = 0; k < 10; k++) { int i = (y - 14) * st + (x0 + 10 + k * 9) * 3; int mx = Math.Max(s[i], Math.Max(s[i + 1], s[i + 2])), mn = Math.Min(s[i], Math.Min(s[i + 1], s[i + 2])); if (mx >= 40 && mx <= 95 && mx - mn <= 25) grey++; }
            return x0 + "," + y + "," + (grey >= 6 ? "available" : "progress");
          }
        }
        run = 0;
      }
    }
    return "";
  }
  // the Status window (C): a column of 5 buttons 28 px apart (Basic, Glorious, Skill, Ability, Action), the open one
  // purple, its page to the right. Returns "x,y,page" (x, y: the purple button's top-left; page 0 – 4), or ""
  static bool GreyButton(byte[] s, int st, int x, int y) { int i = y * st + x * 3; int mx = Math.Max(s[i], Math.Max(s[i + 1], s[i + 2])), mn = Math.Min(s[i], Math.Min(s[i + 1], s[i + 2])); return mx >= 30 && mx <= 95 && mx - mn <= 25; }
  public static string FindStatusWindow(Bitmap src) {
    int W = src.Width, H = src.Height;
    var d = src.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var s = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, s, 0, s.Length); int st = d.Stride; src.UnlockBits(d);
    for (int y = 4; y < H - 40; y++) {
      int run = 0;
      for (int x = 0; x < W - 360; x++) {
        if (Purple(s, y * st + x * 3)) { run++; continue; }
        if (run >= 100 && run <= 132) {
          int x0 = x - run, rows = 0;
          for (int yy = y; yy < y + 6 && yy < H; yy++) if (Purple(s, yy * st + (x0 + run / 2) * 3)) rows++;
          if (rows >= 4) {
            // the other four buttons, grey, above and below in steps of 28 px (two spots each)
            int above = 0, below = 0;
            for (int k = -4; k <= 4; k++) {
              if (k == 0) continue;
              int yy = y + 4 + 28 * k; if (yy < 0 || yy >= H) continue;
              if (GreyButton(s, st, x0 + 30, yy) && GreyButton(s, st, x0 + 85, yy)) { if (k < 0) above++; else below++; }
            }
            if (above + below == 4) return x0 + "," + y + "," + above;
          }
        }
        run = 0;
      }
    }
    return "";
  }
  // the Skill page's open tab, reddish in the tab row above the skills: 0 Ascension, 1 Combat, 2 Support (-1: none)
  public static int StatusTab(Bitmap src, int bx, int by) {
    int y = by - 50; if (y < 0) return -1;
    int best = -1; double bestR = 0;
    for (int t = 0; t < 3; t++) {
      long r = 0, g = 0, b = 0; int n = 0;
      for (int x = bx + 136 + 72 * t; x < bx + 192 + 72 * t && x < src.Width; x++) for (int dy = 0; dy < 4; dy++) { var c = src.GetPixel(x, y + dy); r += c.R; g += c.G; b += c.B; n++; }
      if (n == 0) continue;
      double ar = r / (double)n, ag = g / (double)n, ab = b / (double)n;
      if (ar > 120 && ar - ag > 40 && ab > 40 && ar > bestR) { bestR = ar; best = t; }
    }
    return best;
  }
  // a prepared (black on white) line without its commas and dots: small marks in the lower half between the digits.
  // "1,318,033,090" is read far better as "1318033090" by the text recognition
  public static Bitmap NoCommas(Bitmap b) {
    int W = b.Width, H = b.Height;
    var d = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
    var s = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, s, 0, s.Length); int st = d.Stride;
    System.Func<int, int, bool> ink = (x, y) => s[y * st + x * 3] < 128;
    int top = H, bot = -1;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (ink(x, y)) { top = Math.Min(top, y); bot = Math.Max(bot, y); }
    if (bot > top) {
      int lh = bot - top + 1;
      for (int x = 0; x < W; ) {
        bool any = false; for (int y = top; y <= bot; y++) if (ink(x, y)) { any = true; break; }
        if (!any) { x++; continue; }
        int a = x, t = H, bt = -1;
        while (x < W) { bool col = false; for (int y = top; y <= bot; y++) if (ink(x, y)) { col = true; t = Math.Min(t, y); bt = Math.Max(bt, y); } if (!col) break; x++; }
        // a mark that is short and starts in the lower half of the line: a comma or a dot
        if (bt - t + 1 < lh * 0.45 && t > top + lh / 2) for (int c = a; c < x; c++) for (int y = 0; y < H; y++) { int i = y * st + c * 3; s[i] = s[i + 1] = s[i + 2] = 255; }
      }
    }
    Marshal.Copy(s, 0, d.Scan0, s.Length); b.UnlockBits(d);
    return b;
  }
  // the inventory's weight line ("9532 / 11993 (79.5%)") is drawn in a teal the game world hardly has; the gold line
  // sits ~45 px above it. Returns "x0,y0,x1,y1" of the teal text (or "")
  static bool Teal(byte[] s, int i) {
    int b = s[i], g = s[i + 1], r = s[i + 2];
    return g >= 160 && g <= 220 && r >= 120 && r <= 180 && b >= 140 && b <= 200 && g - r >= 18 && g - b >= 5 && g - b <= 40;
  }
  public static string FindInventory(Bitmap src) {
    int W = src.Width, H = src.Height;
    var d = src.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var s = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, s, 0, s.Length); int st = d.Stride; src.UnlockBits(d);
    // rows with a cluster of teal pixels: count per row within a 220 px window
    int bestY = -1, bestN = 0, bx0 = 0, bx1 = 0;
    for (int y = 60; y < H - 20; y++) {
      int n = 0, x0 = -1, x1 = -1;
      for (int x = W / 4; x < W; x++) if (Teal(s, y * st + x * 3)) { if (x0 < 0) x0 = x; if (x - x0 > 220) { if (n > bestN && n >= 10) { bestN = n; bestY = y; bx0 = x0; bx1 = x1; } n = 0; x0 = x; } n++; x1 = x; }
      if (n > bestN && n >= 10 && x1 - x0 >= 40) { bestN = n; bestY = y; bx0 = x0; bx1 = x1; }
    }
    if (bestY < 0) return "";
    // the text's rows around the best one
    int top = bestY, bot = bestY;
    for (int y = bestY - 1; y > bestY - 14 && y > 0; y--) { int n = 0; for (int x = bx0; x <= bx1; x++) if (Teal(s, y * st + x * 3)) n++; if (n >= 3) top = y; }
    for (int y = bestY + 1; y < bestY + 14 && y < H; y++) { int n = 0; for (int x = bx0; x <= bx1; x++) if (Teal(s, y * st + x * 3)) n++; if (n >= 3) bot = y; }
    return bx0 + "," + top + "," + bx1 + "," + bot;
  }
  // the colours the game draws chat text in (and darker shades of them at the letters' edges)
  static readonly int[][] ChatColors = {
    new[] { 120, 120, 255 },  // blue: "…Exp obtained", system lines
    new[] { 255, 255, 0 },    // yellow: announcements
    new[] { 235, 120, 52 },   // orange: notices
    new[] { 144, 253, 27 },   // green
    new[] { 255, 255, 255 },  // white: chat
  };
  public static bool IsChatColor(int r, int g, int b) {
    foreach (var p in ChatColors) {
      double k = (double)(r * p[0] + g * p[1] + b * p[2]) / (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      if (k < 0.82 || k > 1.08) continue;
      double dr = r - k * p[0], dg = g - k * p[1], db = b - k * p[2];
      if (dr * dr + dg * dg + db * db < 22 * 22) return true;
    }
    return false;
  }
  // the characters of a line of HUD text (the game's pixel font), for the tracker's own digit recognition:
  // "gap:rows" per character, rows as 0/1 strings joined by '.', all of the line's height
  public static string Glyphs(Bitmap src, int x, int y, int w, int h, int minLum) {
    x = Math.Max(0, x); y = Math.Max(0, y); w = Math.Min(w, src.Width - x); h = Math.Min(h, src.Height - y);
    var d = src.LockBits(new Rectangle(x, y, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    int stride = d.Stride; var s = new byte[stride * h]; Marshal.Copy(d.Scan0, s, 0, s.Length); src.UnlockBits(d);
    var ink = new bool[w, h];
    int top = h, bottom = -1;
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
      int k = j * stride + i * 3;
      if (0.11 * s[k] + 0.59 * s[k + 1] + 0.3 * s[k + 2] > minLum) { ink[i, j] = true; top = Math.Min(top, j); bottom = Math.Max(bottom, j); }
    }
    if (bottom < 0) return "";
    var outp = new System.Collections.Generic.List<string>();
    int gap = 0;
    for (int i = 0; i < w; ) {
      bool any = false; for (int j = top; j <= bottom; j++) if (ink[i, j]) { any = true; break; }
      if (!any) { gap++; i++; continue; }
      int a = i;
      while (i < w) { bool col = false; for (int j = top; j <= bottom; j++) if (ink[i, j]) { col = true; break; } if (!col) break; i++; }
      var rows = new string[bottom - top + 1];
      for (int j = top; j <= bottom; j++) { var sb = new System.Text.StringBuilder(); for (int c = a; c < i; c++) sb.Append(ink[c, j] ? '1' : '0'); rows[j - top] = sb.ToString(); }
      outp.Add((outp.Count == 0 ? 0 : gap) + ":" + string.Join(".", rows));
      gap = 0;
    }
    return string.Join(",", outp);
  }
  // ---- effect icons (stunned, poisoned, defence up…): the game's own small icon pictures, searched for on screen
  class Icon { public string Name; public int W, H; public byte[] Px; public bool[] Mask; public int[] Anchors; }
  static readonly System.Collections.Generic.List<Icon> icons = new System.Collections.Generic.List<Icon>();
  public static int LoadIcons(string[] files, string[] names) {
    icons.Clear();
    for (int n = 0; n < files.Length; n++) {
      try {
        using (var raw = new Bitmap(files[n])) using (var b = raw.Clone(new Rectangle(0, 0, raw.Width, raw.Height), PixelFormat.Format24bppRgb)) {
          int stride; var s = Bytes(b, out stride);
          var ic = new Icon { Name = names[n], W = b.Width, H = b.Height, Px = new byte[b.Width * b.Height * 3], Mask = new bool[b.Width * b.Height] };
          // the colour in all four corners is the see-through background (some icon sets have one)
          int k0 = 0, k1 = (b.Width - 1) * 3, k2 = (b.Height - 1) * stride, k3 = k2 + k1;
          bool keyed = true; for (int c = 0; c < 3; c++) keyed &= s[k0 + c] == s[k1 + c] && s[k0 + c] == s[k2 + c] && s[k0 + c] == s[k3 + c];
          var anchors = new System.Collections.Generic.List<int>();
          for (int j = 0; j < b.Height; j++) for (int i = 0; i < b.Width; i++) {
            int k = j * stride + i * 3, p = (j * b.Width + i);
            for (int c = 0; c < 3; c++) ic.Px[p * 3 + c] = s[k + c];
            ic.Mask[p] = !(keyed && s[k] == s[k0] && s[k + 1] == s[k0 + 1] && s[k + 2] == s[k0 + 2]);
          }
          // a few spread-out pixels checked first, so most screen positions are ruled out at once
          foreach (var f in new[] { new[] { 0.5, 0.5 }, new[] { 0.25, 0.25 }, new[] { 0.75, 0.75 }, new[] { 0.25, 0.75 }, new[] { 0.75, 0.25 } }) {
            int ai = (int)(b.Width * f[0]), aj = (int)(b.Height * f[1]), p = aj * b.Width + ai;
            if (ic.Mask[p]) anchors.Add(p);
          }
          if (anchors.Count < 3) continue;
          ic.Anchors = anchors.ToArray();
          icons.Add(ic);
        }
      } catch { /* a broken file: skipped */ }
    }
    return icons.Count;
  }
  // "name@x,y;…" of the icons found in the HUD areas (the top band and the left side). Every screen pixel is read
  // once and compared with each icon's first anchor (icons of a size share it); the closest full match per spot wins.
  public static string FindIcons(Bitmap src) {
    if (icons.Count == 0) return "";
    int stride; var s = Bytes(src, out stride);
    // icons indexed by where their first anchor sits (icons of a size share it) and its colour in 16 steps per
    // channel, twice (shifted by half a step, so a colour near a step boundary is still found)
    var groups = new System.Collections.Generic.Dictionary<int, System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>[]>();
    Func<int, int, int, int, int> key = (b, g, r, sh) => (((b + sh) >> 4) << 10) | (((g + sh) >> 4) << 5) | ((r + sh) >> 4);
    for (int c = 0; c < icons.Count; c++) {
      var ic = icons[c]; int p = ic.Anchors[0], off = (p / ic.W) * 1000 + (p % ic.W);
      System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>[] gd;
      if (!groups.TryGetValue(off, out gd)) { gd = new[] { new System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>(), new System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>() }; groups[off] = gd; }
      for (int z = 0; z < 2; z++) {
        int kk = key(ic.Px[p * 3], ic.Px[p * 3 + 1], ic.Px[p * 3 + 2], z * 8);
        System.Collections.Generic.List<int> l; if (!gd[z].TryGetValue(kk, out l)) gd[z][kk] = l = new System.Collections.Generic.List<int>(); l.Add(c);
      }
    }
    var hits = new System.Collections.Generic.List<Tuple<long, int, int, int>>(); // diff per pixel, icon, x, y
    var cand = new System.Collections.Generic.HashSet<int>();
    Action<int, int, int, int> scan = (x0, y0, x1, y1) => {
      for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
        cand.Clear();
        foreach (var g in groups) {
          int oy = g.Key / 1000, ox = g.Key % 1000;
          if (x + ox >= src.Width || y + oy >= src.Height) continue;
          int k = (y + oy) * stride + (x + ox) * 3;
          for (int z = 0; z < 2; z++) { System.Collections.Generic.List<int> l; if (g.Value[z].TryGetValue(key(s[k], s[k + 1], s[k + 2], z * 8), out l)) foreach (var c in l) cand.Add(c); }
        }
        foreach (var c in cand) {
          var ic = icons[c];
          if (x + ic.W > src.Width || y + ic.H > src.Height) continue;
          bool ok = true;
          for (int a = 1; a < ic.Anchors.Length && ok; a++) {
            int p = ic.Anchors[a], kk = (y + p / ic.W) * stride + (x + p % ic.W) * 3, q = p * 3;
            ok = Math.Abs(s[kk] - ic.Px[q]) + Math.Abs(s[kk + 1] - ic.Px[q + 1]) + Math.Abs(s[kk + 2] - ic.Px[q + 2]) <= 60;
          }
          if (!ok) continue;
          long diff = 0; int n = 0;
          for (int j = 0; j < ic.H; j++) for (int i = 0; i < ic.W; i++) {
            int p = j * ic.W + i; if (!ic.Mask[p]) continue;
            int kk = (y + j) * stride + (x + i) * 3, q = p * 3;
            diff += Math.Abs(s[kk] - ic.Px[q]) + Math.Abs(s[kk + 1] - ic.Px[q + 1]) + Math.Abs(s[kk + 2] - ic.Px[q + 2]); n++;
          }
          if (n > 0 && diff / n <= 40) hits.Add(Tuple.Create(diff / n, c, x, y));
        }
      }
    };
    scan(0, 0, src.Width - 1, Math.Min(220, src.Height - 1));   // under and next to the HP / MP bars
    scan(0, 221, Math.Min(320, src.Width - 1), Math.Min(430, src.Height - 1));
    hits.Sort((a, b) => a.Item1.CompareTo(b.Item1));
    var found = new System.Collections.Generic.List<string>();
    var taken = new System.Collections.Generic.List<Rectangle>();
    foreach (var h in hits) {
      var ic = icons[h.Item2]; var r = new Rectangle(h.Item3, h.Item4, ic.W, ic.H);
      if (taken.Exists(t => t.IntersectsWith(r))) continue;
      taken.Add(r); found.Add(ic.Name + "@" + h.Item3 + "," + h.Item4);
    }
    return string.Join(";", found);
  }
  // ---- buffs: the column of item / skill icons at the right edge, matched against data\icon-index.bin (lib/iconindex.js)
  static byte[] bxSet; static uint[] bxId; static byte[][] bxRgb; static bool[][] bxMask; static int[] bxKey;
  static System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>[] bxIndex;
  // the middle's colour in 32 steps per channel, twice (shifted by half a step): close colours share a key
  static int CenterKey(int r, int g, int b, int sh) { return (((r + sh) >> 3) << 10) | (((g + sh) >> 3) << 5) | ((b + sh) >> 3); }
  public static int LoadBuffIndex(string file) {
    var d = System.IO.File.ReadAllBytes(file);
    if (d.Length < 8 || d[0] != 'S' || d[1] != 'O' || d[2] != 'F' || d[3] != 'I') return 0;
    int n = BitConverter.ToInt32(d, 4), o = 8;
    bxSet = new byte[n]; bxId = new uint[n]; bxRgb = new byte[n][]; bxMask = new bool[n][]; bxKey = new int[n];
    bxIndex = new[] { new System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>(), new System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>() };
    for (int i = 0; i < n; i++) {
      bxSet[i] = d[o]; bxId[i] = BitConverter.ToUInt32(d, o + 1); o += 5;
      bxRgb[i] = new byte[768]; Array.Copy(d, o, bxRgb[i], 0, 768); o += 768;
      bxMask[i] = new bool[256]; for (int c = 0; c < 256; c++) bxMask[i][c] = (d[o + (c >> 3)] & (1 << (c & 7))) != 0; o += 32;
      // the middle 8 x 8 cells' colour: corner labels ("18", "x2") don't change it
      long r = 0, g = 0, b = 0; int m = 0;
      for (int y = 4; y < 12; y++) for (int x = 4; x < 12; x++) { int c = y * 16 + x; if (!bxMask[i][c]) continue; r += bxRgb[i][c * 3]; g += bxRgb[i][c * 3 + 1]; b += bxRgb[i][c * 3 + 2]; m++; }
      if (m < 32) { bxKey[i] = -1; continue; }
      for (int z = 0; z < 2; z++) {
        int k = CenterKey((int)(r / m), (int)(g / m), (int)(b / m), z * 4);
        System.Collections.Generic.List<int> l; if (!bxIndex[z].TryGetValue(k, out l)) bxIndex[z][k] = l = new System.Collections.Generic.List<int>(); l.Add(i);
      }
    }
    return n;
  }
  // "set:id@x,y;…" (set 1 item, 2 and 3 skill icons) of the buff icons found
  public static string FindBuffs(Bitmap src) {
    if (bxIndex == null) return "";
    int x0 = Math.Max(0, src.Width - 160), x1 = src.Width - 33, y0 = src.Height / 4, y1 = src.Height - 70;
    if (x1 <= x0 || y1 <= y0) return "";
    return MatchIconArea(src, x0, y0, src.Width, y1, 0);
  }
  // icons of the index whose top-left is in [x0, x1) x [y0, y1] (x1: where the area ends on the right); set 0: any
  // set, else only that one (2: skill icons in the skill window). "set:id@x,y;…", best fits first, no overlaps
  public static string MatchIconArea(Bitmap src, int x0, int y0, int x1, int y1, int setOnly) { return MatchIconArea(src, x0, y0, x1, y1, setOnly, false); }
  // hotbar: the slot's key label (top left, "F3") and the item count (bottom right, "102") are drawn over the icon, so
  // those cells are left out of the comparison
  static bool HotbarSkip(int c) { int cx = c % 16, cy = c / 16; return (cy >= 8 && cx >= 4) || (cy < 5 && cx < 8); }
  public static string MatchIconArea(Bitmap src, int x0, int y0, int x1, int y1, int setOnly, bool hotbar) {
    if (bxIndex == null) return "";
    x0 = Math.Max(0, x0); y0 = Math.Max(0, y0); x1 = Math.Min(src.Width, x1); y1 = Math.Min(src.Height - 33, y1);
    if (x1 - x0 < 32 || y1 <= y0) return "";
    int stride; var s = Bytes(src, out stride);
    // integral images of the strip, per channel (for any 2 x 2 block and the middle area in a few reads)
    int W = x1 - x0 + 1, H = y1 + 34 - y0 + 1;
    var I = new long[3][]; for (int c = 0; c < 3; c++) I[c] = new long[(W + 1) * (H + 1)];
    for (int j = 0; j < H && y0 + j < src.Height; j++) {
      long r0 = 0, r1 = 0, r2 = 0;
      for (int i = 0; i < W && x0 + i < src.Width; i++) {
        int k = (y0 + j) * stride + (x0 + i) * 3; r0 += s[k + 2]; r1 += s[k + 1]; r2 += s[k];
        int p = (j + 1) * (W + 1) + (i + 1), q = j * (W + 1) + (i + 1);
        I[0][p] = I[0][q] + r0; I[1][p] = I[1][q] + r1; I[2][p] = I[2][q] + r2;
      }
    }
    Func<int, int, int, int, int, long> box = (c, x, y, w, h) => { int a = y * (W + 1) + x, b = y * (W + 1) + x + w, e = (y + h) * (W + 1) + x, f = (y + h) * (W + 1) + x + w; return I[c][f] - I[c][b] - I[c][e] + I[c][a]; };
    var hits = new System.Collections.Generic.List<Tuple<double, int, int, int>>();
    var cand = new System.Collections.Generic.HashSet<int>();
    for (int y = 0; y + 32 <= H && y0 + y <= y1; y++) for (int x = 0; x + 32 <= W; x++) {
      int mr = (int)(box(0, x + 8, y + 8, 16, 16) / 256), mg = (int)(box(1, x + 8, y + 8, 16, 16) / 256), mb = (int)(box(2, x + 8, y + 8, 16, 16) / 256);
      cand.Clear();
      for (int z = 0; z < 2; z++) { System.Collections.Generic.List<int> l; if (bxIndex[z].TryGetValue(CenterKey(mr, mg, mb, z * 4), out l)) foreach (var i in l) cand.Add(i); }
      foreach (var i in cand) {
        if (setOnly != 0 && bxSet[i] != setOnly) continue;
        var rgb = bxRgb[i]; var mask = bxMask[i];
        // a quick look at four cells (one may differ: a label in that corner), then all of them
        int miss = 0;
        foreach (var c in new[] { 4 * 16 + 4, 4 * 16 + 11, 11 * 16 + 4, 11 * 16 + 11, 6 * 16 + 9, 7 * 16 + 2 }) {
          if (!mask[c] || (hotbar && HotbarSkip(c))) continue;
          int cx = c % 16, cy = c / 16;
          int dr = (int)(box(0, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3], dg = (int)(box(1, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3 + 1], db = (int)(box(2, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3 + 2];
          if (Math.Abs(dr) + Math.Abs(dg) + Math.Abs(db) > 120 && ++miss > 1) break;
        }
        if (miss > 1) continue;
        long sum = 0; int n = 0, bad = 0;
        for (int c = 0; c < 256; c++) {
          if (!mask[c] || (hotbar && HotbarSkip(c))) continue;
          int cx = c % 16, cy = c / 16;
          int d = Math.Abs((int)(box(0, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3]) + Math.Abs((int)(box(1, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3 + 1]) + Math.Abs((int)(box(2, x + cx * 2, y + cy * 2, 2, 2) / 4) - rgb[c * 3 + 2]);
          sum += d; n++; if (d > 120) bad++;
        }
        // close on average, and only a corner's worth of cells different (labels drawn over the icon: "1日", "x2", "特")
        if (n >= (hotbar ? 80 : 128) && sum / (double)n <= 55 && bad <= n / 4) hits.Add(Tuple.Create(sum / (double)n, i, x0 + x, y0 + y));
      }
    }
    hits.Sort((a, b) => a.Item1.CompareTo(b.Item1));
    var found = new System.Collections.Generic.List<string>(); var taken = new System.Collections.Generic.List<Rectangle>();
    foreach (var h in hits) {
      var r = new Rectangle(h.Item3, h.Item4, 32, 32);
      if (taken.Exists(t => { var q = Rectangle.Intersect(t, r); return q.Width * q.Height > 200; })) continue;
      taken.Add(r); found.Add(bxSet[h.Item2] + ":" + bxId[h.Item2] + "@" + h.Item3 + "," + h.Item4);
    }
    return string.Join(";", found);
  }
  // the hotbar's item icons: the 10 slots of the F1–F10 row (icon top-left at x = width/2 - 148 + 39·i, y = height - 49)
  // and of the 1–0 row above it (40 px higher), each compared with every item icon of the index a few pixels around
  // its place (the count and the key label are left out). "F3=1:1000000970@441,719;…"
  // the items to look for on the hotbar (potions, ginseng…: set by the tracker); empty = every item (slow)
  public static System.Collections.Generic.HashSet<uint> HotbarIds = new System.Collections.Generic.HashSet<uint>();
  public static string HotbarItems(Bitmap src) {
    if (bxIndex == null || src.Width < 700 || src.Height < 200) return "";
    int stride; var s = Bytes(src, out stride);
    Func<int, int, int, int> px = (x, y, c) => s[y * stride + x * 3 + (2 - c)]; // c: 0 R, 1 G, 2 B
    Func<int, int, int, int> cell = (x, y, c) => (px(x, y, c) + px(x + 1, y, c) + px(x, y + 1, c) + px(x + 1, y + 1, c)) / 4;
    var quick = new[] { 4 * 16 + 11, 6 * 16 + 9, 3 * 16 + 12, 2 * 16 + 9, 5 * 16 + 14, 7 * 16 + 2 };
    var found = new System.Collections.Generic.List<string>();
    for (int row = 0; row < 2; row++) for (int i = 0; i < 10; i++) {
      int bx = src.Width / 2 - 148 + 39 * i, by = src.Height - 49 - 40 * row;
      double best = 999; int bestI = -1, bestX = 0, bestY = 0;
      for (int dy = -2; dy <= 2; dy++) for (int dx = -3; dx <= 3; dx++) {
        int x = bx + dx, y = by + dy;
        if (x < 0 || y < 0 || x + 32 >= src.Width || y + 32 >= src.Height) continue;
        for (int k = 0; k < bxRgb.Length; k++) {
          if (bxSet[k] != 1 || (HotbarIds.Count > 0 && !HotbarIds.Contains(bxId[k]))) continue;
          var rgb = bxRgb[k]; var mask = bxMask[k];
          int miss = 0;
          foreach (var c in quick) {
            if (!mask[c]) continue;
            int cx = c % 16, cy = c / 16, d = 0;
            for (int ch = 0; ch < 3; ch++) d += Math.Abs(cell(x + cx * 2, y + cy * 2, ch) - rgb[c * 3 + ch]);
            if (d > 120 && ++miss > 1) break;
          }
          if (miss > 1) continue;
          long sum = 0; int n = 0, bad = 0;
          for (int c = 0; c < 256; c++) {
            if (!mask[c] || HotbarSkip(c)) continue;
            int cx = c % 16, cy = c / 16, d = 0;
            for (int ch = 0; ch < 3; ch++) d += Math.Abs(cell(x + cx * 2, y + cy * 2, ch) - rgb[c * 3 + ch]);
            sum += d; n++; if (d > 120) bad++;
          }
          if (n < 60) continue;
          double avg = sum / (double)n;
          if (avg <= 50 && bad <= n / 5 && avg < best) { best = avg; bestI = k; bestX = x; bestY = y; }
        }
      }
      if (bestI >= 0) found.Add((row == 0 ? "F" + (i + 1) : (i == 9 ? "0" : (i + 1).ToString())) + "=" + bxSet[bestI] + ":" + bxId[bestI] + "@" + bestX + "," + bestY);
    }
    return string.Join(";", found);
  }
  // (diagnostics) the closest icons around a spot: "set:id avg bad/n @x,y" for the best few
  public static string BuffDebug(Bitmap src, int px, int py) {
    if (bxIndex == null) return "no index";
    int stride; var s = Bytes(src, out stride);
    var res = new System.Collections.Generic.List<Tuple<double, string>>();
    for (int i = 0; i < bxRgb.Length; i++) {
      var rgb = bxRgb[i]; var mask = bxMask[i];
      for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) {
        int x = px + dx, y = py + dy; if (x < 0 || y < 0 || x + 32 > src.Width || y + 32 > src.Height) continue;
        long sum = 0; int n = 0, bad = 0;
        for (int c = 0; c < 256; c++) {
          if (!mask[c]) continue;
          int cx = c % 16, cy = c / 16, r = 0, g = 0, b = 0;
          for (int q = 0; q < 4; q++) { int k = (y + cy * 2 + q / 2) * stride + (x + cx * 2 + q % 2) * 3; b += s[k]; g += s[k + 1]; r += s[k + 2]; }
          int d = Math.Abs(r / 4 - rgb[c * 3]) + Math.Abs(g / 4 - rgb[c * 3 + 1]) + Math.Abs(b / 4 - rgb[c * 3 + 2]);
          sum += d; n++; if (d > 120) bad++;
        }
        if (n > 0) res.Add(Tuple.Create(sum / (double)n, bxSet[i] + ":" + bxId[i] + " " + Math.Round(sum / (double)n) + " " + bad + "/" + n + " @" + x + "," + y));
      }
    }
    res.Sort((a, b) => a.Item1.CompareTo(b.Item1));
    var o = new System.Collections.Generic.List<string>(); for (int i = 0; i < Math.Min(4, res.Count); i++) o.Add(res[i].Item2);
    return string.Join(" | ", o);
  }
  // ---- the minimap: "ax,ay|players|party". Your arrow (the largest orange shape; the middle when it isn't found),
  // then the red dots of other players and the small orange dots of party members, each as "dx,dy;…" from the arrow
  static System.Collections.Generic.List<int[]> Blobs(bool[,] mask, int w, int h) {
    // connected shapes: { centre x, centre y, pixels, width, height }
    var seen = new bool[w, h]; var stack = new System.Collections.Generic.Stack<int>(); var outp = new System.Collections.Generic.List<int[]>();
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
      if (!mask[i, j] || seen[i, j]) continue;
      int n = 0, minx = i, maxx = i, miny = j, maxy = j; long sx = 0, sy = 0;
      stack.Push(j * w + i); seen[i, j] = true;
      while (stack.Count > 0) {
        int p = stack.Pop(), a = p % w, c = p / w; n++; sx += a; sy += c;
        minx = Math.Min(minx, a); maxx = Math.Max(maxx, a); miny = Math.Min(miny, c); maxy = Math.Max(maxy, c);
        for (int d = 0; d < 4; d++) {
          int na = a + (d == 0 ? 1 : d == 1 ? -1 : 0), nc = c + (d == 2 ? 1 : d == 3 ? -1 : 0);
          if (na < 0 || nc < 0 || na >= w || nc >= h || seen[na, nc] || !mask[na, nc]) continue;
          seen[na, nc] = true; stack.Push(nc * w + na);
        }
      }
      outp.Add(new[] { (int)(sx / n), (int)(sy / n), n, maxx - minx + 1, maxy - miny + 1 });
    }
    return outp;
  }
  // your arrow on the minimap: the game's minimap_arrow.bmp turned every 10 degrees (it points where you face)
  static System.Collections.Generic.List<int[]> arrowPx = new System.Collections.Generic.List<int[]>(); // per angle: x, y, r, g, b …
  public static int LoadArrow(string file) {
    arrowPx.Clear();
    using (var b = new Bitmap(file)) {
      int w = b.Width, h = b.Height; double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
      for (int a = 0; a < 36; a++) {
        double t = a * Math.PI / 18, cs = Math.Cos(t), sn = Math.Sin(t);
        var px = new System.Collections.Generic.List<int>();
        for (int y = -9; y <= 9; y++) for (int x = -9; x <= 9; x++) {
          // where this screen pixel comes from in the unturned picture
          int sx = (int)Math.Round(cx + x * cs + y * sn), sy = (int)Math.Round(cy - x * sn + y * cs);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          var c = b.GetPixel(sx, sy);
          if (c.R > 240 && c.G < 20 && c.B > 240) continue; // magenta: see-through
          px.Add(x); px.Add(y); px.Add(c.R); px.Add(c.G); px.Add(c.B);
        }
        arrowPx.Add(px.ToArray());
      }
    }
    return arrowPx.Count;
  }
  // best place and angle of the arrow in the minimap: "x,y,angle" relative to the minimap's corner, or ""
  static string FindArrow(byte[] s, int stride, int x0, int y0, int w, int h) {
    double best = 1e9; int bx = 0, by = 0, ba = 0;
    // only around golden pixels (the arrow's body): everywhere else it can't be
    var spots = new System.Collections.Generic.List<int>();
    for (int y = 9; y < h - 9; y++) for (int x = 9; x < w - 9; x++) {
      int k = (y0 + y) * stride + (x0 + x) * 3, r = s[k + 2], g = s[k + 1], b = s[k];
      if (r > 180 && g > 110 && b < 110 && r >= g && r - b > 110) spots.Add(y * w + x);
    }
    var tried = new System.Collections.Generic.HashSet<int>();
    for (int a = 0; a < arrowPx.Count; a++) {
      var p = arrowPx[a]; int n = p.Length / 5;
      foreach (var sp in spots) for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) {
        int x = sp % w + dx, y = sp / w + dy;
        if (x < 9 || y < 9 || x >= w - 9 || y >= h - 9 || !tried.Add((a * h + y) * w + x)) continue;
        long d = 0; int i = 0;
        for (; i < n; i++) {
          int k = (y0 + y + p[i * 5 + 1]) * stride + (x0 + x + p[i * 5]) * 3;
          d += Math.Abs(s[k + 2] - p[i * 5 + 2]) + Math.Abs(s[k + 1] - p[i * 5 + 3]) + Math.Abs(s[k] - p[i * 5 + 4]);
          if (d > best * n) break; // already worse than the best so far
        }
        if (i < n) continue;
        double avg = (double)d / n;
        if (avg < best) { best = avg; bx = x; by = y; ba = a * 10; }
      }
    }
    return best <= 85 ? bx + "," + by + "," + ba : "";
  }
  public static string MinimapDots(Bitmap src) {
    // (below the red coordinates at the top, above the zone name at the bottom: both are text in red / orange)
    int x0 = src.Width - 168, x1 = src.Width - 6, y0 = 40, y1 = Math.Min(src.Height - 1, 184);
    if (x0 < 0) return "";
    int stride; var s = Bytes(src, out stride);
    int w = x1 - x0 + 1, h = y1 - y0 + 1;
    var red = new bool[w, h]; var orange = new bool[w, h];
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
      int k = (y0 + j) * stride + (x0 + i) * 3, r = s[k + 2], g = s[k + 1], b = s[k];
      red[i, j] = r > 160 && g < 80 && b < 100 && r - g > 110;
      orange[i, j] = r > 200 && g >= 90 && g <= 190 && b < 130 && r - g > 40 && g - b > 20;
    }
    // you: the arrow (by its shape, at any angle); without it, the middle of the minimap
    var arrow = arrowPx.Count > 0 ? FindArrow(s, stride, x0, y0, w, h) : "";
    int cx = (x0 + x1) / 2, cy = 99, angle = -1;
    if (arrow != "") { var v = arrow.Split(','); cx = x0 + int.Parse(v[0]); cy = y0 + int.Parse(v[1]); angle = int.Parse(v[2]); }
    var or = Blobs(orange, w, h);
    var players = new System.Collections.Generic.List<string>(); var party = new System.Collections.Generic.List<string>();
    // a dot: a small round blob (letters of the red coordinates are thin and wide)
    foreach (var bl in Blobs(red, w, h))
      if (bl[2] >= 6 && bl[2] <= 70 && bl[3] <= 11 && bl[4] <= 11 && bl[3] >= 3 && bl[4] >= 3) players.Add((x0 + bl[0] - cx) + "," + (y0 + bl[1] - cy));
    // party members: small orange dots with a dark middle (not part of your arrow)
    foreach (var bl in or) {
      if (bl[2] < 4 || bl[2] > 40 || bl[3] > 9 || bl[4] > 9 || bl[3] < 3 || bl[4] < 3) continue;
      int px = x0 + bl[0], py = y0 + bl[1];
      if (Math.Abs(px - cx) <= 6 && Math.Abs(py - cy) <= 6) continue;
      bool darkMid = false;
      for (int dy = -1; dy <= 1 && !darkMid; dy++) for (int dx = -1; dx <= 1 && !darkMid; dx++) { int k = (py + dy) * stride + (px + dx) * 3; darkMid = 0.11 * s[k] + 0.59 * s[k + 1] + 0.3 * s[k + 2] < 90; }
      if (darkMid) party.Add((px - cx) + "," + (py - cy));
    }
    return (arrow != "" ? (cx - x0) + "," + (cy - y0) + "," + angle : "") + "|" + string.Join(";", players) + "|" + string.Join(";", party);
  }
  // a word drawn in front of a prepared line of numbers: the text recognition reads "MP 1500 / 4992" more reliably
  // than the numbers alone
  public static Bitmap WithWord(Bitmap b, string word) {
    int gap = b.Height;
    using (var f = new Font("Arial", Math.Max(8, b.Height * 0.55f), FontStyle.Bold, GraphicsUnit.Pixel)) {
      int ww; using (var g0 = Graphics.FromImage(b)) ww = (int)g0.MeasureString(word, f).Width;
      var o = new Bitmap(b.Width + ww + gap, b.Height, PixelFormat.Format24bppRgb);
      using (var g = Graphics.FromImage(o)) { g.Clear(Color.White); g.DrawString(word, f, Brushes.Black, 0, b.Height * 0.15f); g.DrawImageUnscaled(b, ww + gap, 0); }
      return o;
    }
  }
  // a white margin around a prepared picture (the text recognition skips text that touches the edges)
  public static Bitmap Pad(Bitmap b, int m) {
    var o = new Bitmap(b.Width + 2 * m, b.Height + 2 * m, PixelFormat.Format24bppRgb);
    using (var g = Graphics.FromImage(o)) { g.Clear(Color.White); g.DrawImageUnscaled(b, m, m); }
    return o;
  }
  static byte[] Bytes(Bitmap src, out int stride) {
    var d = src.LockBits(new Rectangle(0, 0, src.Width, src.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    stride = d.Stride; var s = new byte[d.Stride * src.Height]; Marshal.Copy(d.Scan0, s, 0, s.Length); src.UnlockBits(d); return s;
  }
  // the colour a line of text is drawn in: the brightest of its letter pixels, averaged ("#rrggbb", "" when none)
  public static string LineColor(Bitmap src, int x, int y, int w, int h, int minLum, int mode) {
    x = Math.Max(0, x); y = Math.Max(0, y); w = Math.Min(w, src.Width - x); h = Math.Min(h, src.Height - y);
    if (w <= 0 || h <= 0) return "";
    // only the line's own pixels are copied
    var d = src.LockBits(new Rectangle(x, y, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    int stride = d.Stride; var s = new byte[stride * h]; Marshal.Copy(d.Scan0, s, 0, s.Length); src.UnlockBits(d);
    int best = 0;
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) { int k = j * stride + i * 3; if (Ink(s[k + 2], s[k + 1], s[k], minLum, mode)) best = Math.Max(best, Math.Max(s[k], Math.Max(s[k + 1], s[k + 2]))); }
    if (best == 0) return "";
    long r = 0, g = 0, b = 0, n = 0;
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
      int k = j * stride + i * 3; int m = Math.Max(s[k], Math.Max(s[k + 1], s[k + 2]));
      if (m >= best * 0.85 && Ink(s[k + 2], s[k + 1], s[k], minLum, mode)) { r += s[k + 2]; g += s[k + 1]; b += s[k]; n++; }
    }
    return string.Format("#{0:x2}{1:x2}{2:x2}", r / n, g / n, b / n);
  }
  static bool Ink(int r, int g, int b, int minLum, int mode) {
    if (mode == 2) return IsChatColor(r, g, b);
    double lum = mode == 1 ? Math.Max(b, Math.Max(g, r)) : 0.11 * b + 0.59 * g + 0.3 * r;
    return lum > minLum;
  }
  // party members' HP gauges (the game's party_box: a 130 x 4 px gauge on a brown track): "x,y,percent" each
  static bool GaugeRed(byte[] s, int k) { int r = s[k + 2], g = s[k + 1], b = s[k]; return r > 120 && r - g > 70 && Math.Abs(g - b) < 20; }
  static bool GaugeTrack(byte[] s, int k) { int r = s[k + 2], g = s[k + 1], b = s[k]; return r >= 20 && r <= 95 && g >= 5 && g <= 55 && b < 20 && r > g + 12; }
  // the game's party_box: a 130 x 4 px gauge on its brown track (exact, and it also sees a member at 0 HP)
  static System.Collections.Generic.List<string> PartyBox130(byte[] s, int stride, Bitmap src) {
    var found = new System.Collections.Generic.List<string>();
    int maxX = Math.Min(src.Width - 140, 420), maxY = src.Height - 160;
    Func<int, int, bool> on = (i, j) => { int k = j * stride + i * 3; return GaugeRed(s, k) || GaugeTrack(s, k); };
    for (int y = 45; y < maxY; y++) for (int x = 1; x < maxX; x++) {
      if (!on(x, y) || on(x - 1, y)) continue;
      bool ok = true;
      for (int j = y; j < y + 4 && ok; j++) { int run = 0; while (x + run < src.Width && on(x + run, j)) run++; ok = run >= 126 && run <= 134; }
      if (!ok || on(x + 5, y - 1) || on(x + 5, y + 4)) continue;
      int red = 0, k0 = (y + 2) * stride; while (red < 134 && GaugeRed(s, k0 + (x + red) * 3)) red++;
      found.Add(x + "," + y + "," + Math.Round(100.0 * Math.Min(130, red) / 130) + ",130");
      y += 4; break;
    }
    return found;
  }
  // any party list: a thin red HP bar (2 to 6 px high, 60 to 260 px long) in the left part of the window, measured
  // against its empty dark track (the wide party list); the party_box above first, exactly
  public static string[] PartyBars(Bitmap src) {
    int stride; var s = Bytes(src, out stride);
    var found = PartyBox130(s, stride, src);
    var boxYs = new System.Collections.Generic.List<int>(); foreach (var f in found) boxYs.Add(int.Parse(f.Split(',')[1]));
    int maxX = Math.Min(src.Width - 70, 420), maxY = src.Height - 160;
    Func<int, int, bool> red = (i, j) => i >= 0 && j >= 0 && i < src.Width && j < src.Height && GaugeRed(s, j * stride + i * 3);
    Func<int, int, bool> dark = (i, j) => { if (i >= src.Width) return false; int k = j * stride + i * 3; return GaugeTrack(s, k) || 0.11 * s[k] + 0.59 * s[k + 1] + 0.3 * s[k + 2] < 70; };
    Func<int, int, int> run = (x, y) => { int n = 0; while (x + n < src.Width && red(x + n, y)) n++; return n; };
    for (int y = 45; y < maxY; y++) for (int x = 1; x < maxX; x++) {
      if (!red(x, y) || red(x - 1, y) || red(x, y - 1)) continue;
      int len = run(x, y);
      if (len < 3 || len > 260) continue;
      // the bar's height: rows below that start at the same place with about the same length
      int h = 1; while (h < 8 && red(x, y + h) && Math.Abs(run(x, y + h) - len) <= 3) h++;
      if (h < 2 || h > 6 || red(x + 2, y + h)) continue;
      // the empty part of the bar (dark track) after the red, on the middle row
      int mid = y + h / 2, track = 0; while (track < 262 - len && dark(x + len + track, mid)) track++;
      int total = len + (track >= 3 ? track : 0);
      if (total < 60 || total > 262 || boxYs.Exists(by => Math.Abs(by - y) < 6)) continue;
      found.Add(x + "," + y + "," + Math.Round(100.0 * len / total) + "," + total);
      y += h; break;
    }
    found.Sort((a, b) => int.Parse(a.Split(',')[1]).CompareTo(int.Parse(b.Split(',')[1])));
    return found.ToArray();
  }
  // a JPEG copy of the frame (death replays, drop pictures)
  public static void SaveJpeg(Bitmap b, string file, long quality) {
    var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), e => e.MimeType == "image/jpeg");
    var p = new EncoderParameters(1); p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
    var tmp = file + ".tmp"; b.Save(tmp, enc, p);
    if (System.IO.File.Exists(file)) System.IO.File.Delete(file);
    System.IO.File.Move(tmp, file);
  }
  // the HUD's HP (red) or MP (blue) bar by pixel colour only, no text recognition: the best row between y0 and y1,
  // the rightmost fill-coloured pixel between x0 and x1 as a fraction of the bar (the tracker corrects the scale
  // against the numbers it reads, see "fast bars" in server.js). -1 when no bar is there.
  public static double BarFill(Bitmap s, int y0, int y1, int x0, int x1, bool red) {
    double best = -1; int bestN = 0;
    for (int y = Math.Max(0, y0); y <= y1 && y < s.Height; y++) {
      int n = 0, last = -1;
      for (int x = Math.Max(0, x0); x <= x1 && x < s.Width; x++) {
        var c = s.GetPixel(x, y);
        bool f = red ? (c.R > 150 && c.R > c.G + 70 && c.R > c.B + 70) : (c.B > 140 && c.B > c.R + 60 && c.B > c.G + 20);
        if (f) { n++; last = x; }
      }
      if (n > bestN) { bestN = n; best = (double)(last - x0 + 1) / (x1 - x0 + 1); }
    }
    return bestN < 2 ? (y1 < s.Height ? 0 : -1) : Math.Min(1, best);
  }
  // a fast look: only the HUD corner and the EXP strip at the bottom are copied from the game window (a few ms)
  public static Bitmap[] QuickCapture(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || IsIconic(hwnd)) return null;
    RECT r; if (!GetClientRect(hwnd, out r) || r.R < 200 || r.B < 200) return null;
    var hud = new Bitmap(240, 40, PixelFormat.Format24bppRgb); var strip = new Bitmap(r.R, 14, PixelFormat.Format24bppRgb);
    var src = GetDC(hwnd); bool ok = src != IntPtr.Zero;
    if (ok) {
      using (var g = Graphics.FromImage(hud)) { var h = g.GetHdc(); ok = BitBlt(h, 0, 0, 240, 40, src, 0, 0, 0x00CC0020); g.ReleaseHdc(h); }
      using (var g = Graphics.FromImage(strip)) { var h = g.GetHdc(); ok = ok && BitBlt(h, 0, 0, r.R, 14, src, 0, r.B - 14, 0x00CC0020); g.ReleaseHdc(h); }
      ReleaseDC(hwnd, src);
    }
    if (!ok || Blank(hud)) { hud.Dispose(); strip.Dispose(); return null; }
    return new Bitmap[] { hud, strip };
  }
  // share of a horizontal strip whose pixels are bluish (the EXP bar)
  public static double BlueFill(Bitmap src, int y, int x0, int x1) {
    int n = 0, total = 0;
    for (int x = Math.Max(0, x0); x < Math.Min(src.Width, x1); x++) { var c = src.GetPixel(x, Math.Max(0, Math.Min(src.Height - 1, y))); total++; if (c.B > 120 && c.B > c.R + 40) n++; }
    return total == 0 ? 0 : (double)n / total;
  }
}
// the Status window's white digits: one template per digit (sampled to a fixed grid), read by trying splits of a run
// of ink columns into digit widths and keeping the best match
public static class Digits {
  public const int TW = 7, TH = 10;
  public static bool[,] Ink(Bitmap src, int x, int y, int w, int h, int lum) {
    var ink = new bool[w, h];
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
      int px = x + i, py = y + j; if (px < 0 || py < 0 || px >= src.Width || py >= src.Height) continue;
      var c = src.GetPixel(px, py); ink[i, j] = Math.Max(c.R, Math.Max(c.G, c.B)) > lum;
    }
    return ink;
  }
  // columns [a, b) and rows [t, bt] of the ink grid sampled to TW x TH (fraction of ink per cell)
  public static double[] Sample(bool[,] ink, int a, int b, int t, int bt) {
    var o = new double[TW * TH]; int w = b - a, h = bt - t + 1;
    for (int r = 0; r < TH; r++) for (int c = 0; c < TW; c++) {
      int x0 = a + c * w / TW, x1 = Math.Max(x0 + 1, a + (c + 1) * w / TW), y0 = t + r * h / TH, y1 = Math.Max(y0 + 1, t + (r + 1) * h / TH);
      int n = 0, k = 0; for (int yy = y0; yy < y1; yy++) for (int xx = x0; xx < x1; xx++) { n++; if (ink[xx, yy]) k++; }
      o[r * TW + c] = n > 0 ? k / (double)n : 0;
    }
    return o;
  }
  // the runs of ink columns and the rows the ink spans
  public static System.Collections.Generic.List<int[]> Runs(bool[,] ink, out int top, out int bot) {
    int w = ink.GetLength(0), h = ink.GetLength(1); top = h; bot = -1;
    var runs = new System.Collections.Generic.List<int[]>(); int a = -1;
    for (int i = 0; i <= w; i++) {
      bool col = false; if (i < w) for (int j = 0; j < h; j++) if (ink[i, j]) { col = true; top = Math.Min(top, j); bot = Math.Max(bot, j); }
      if (col && a < 0) a = i;
      if (!col && a >= 0) { if (i - a >= 2) runs.Add(new[] { a, i }); a = -1; }
    }
    return runs;
  }
  public static System.Collections.Generic.Dictionary<char, double[]> Tpl = new System.Collections.Generic.Dictionary<char, double[]>();
  static double Cost(double[] s, double[] t) { double d = 0; for (int i = 0; i < s.Length; i++) d += Math.Abs(s[i] - t[i]); return d / s.Length; }
  // a number in a box: "" when nothing fits well
  public static string Read(Bitmap src, int x, int y, int w, int h, int lum) {
    if (Tpl.Count < 10) return "";
    var ink = Ink(src, x, y, w, h, lum); int top, bot; var runs = Runs(ink, out top, out bot);
    if (bot - top < 6) return "";
    var sb = new System.Text.StringBuilder();
    foreach (var r in runs) {
      int n = r[1] - r[0];
      // best[i]: cheapest reading of columns [r0, r0 + i); widths 3–5 for a "1", 6–8 for the others
      var best = new double[n + 1]; var from = new int[n + 1]; var dig = new char[n + 1];
      for (int i = 1; i <= n; i++) best[i] = double.MaxValue; best[0] = 0;
      for (int i = 0; i < n; i++) {
        if (best[i] == double.MaxValue) continue;
        for (int gw = 3; gw <= 9 && i + gw <= n; gw++) {
          var smp = Sample(ink, r[0] + i, r[0] + i + gw, top, bot);
          foreach (var kv in Tpl) {
            bool one = kv.Key == '1'; if (one ? gw > 5 : gw < 5) continue;
            double c = best[i] + Cost(smp, kv.Value) + 0.02; // a small cost per digit: fewer, better-fitting digits win
            if (c < best[i + gw]) { best[i + gw] = c; from[i + gw] = i; dig[i + gw] = kv.Key; }
          }
        }
      }
      if (best[n] == double.MaxValue) return "";
      var part = new System.Text.StringBuilder(); int digits = 0;
      for (int i = n; i > 0; i = from[i]) { part.Insert(0, dig[i]); digits++; }
      if (best[n] / digits > 0.28) return ""; // a poor fit: not these digits
      sb.Append(part);
    }
    return sb.ToString();
  }
  // templates from boxes whose numbers are known: each run split by the widths the known digits need
  public static string Learn(Bitmap src, int x, int y, int w, int h, int lum, string value, System.Collections.Generic.Dictionary<char, System.Collections.Generic.List<double[]>> acc) {
    var ink = Ink(src, x, y, w, h, lum); int top, bot; var runs = Runs(ink, out top, out bot);
    int total = 0; foreach (var r in runs) total += r[1] - r[0];
    // a "1" is ~4/7 of a digit's width: share the ink columns out by that
    double units = 0; foreach (var ch in value) units += ch == '1' ? 4 : 7;
    var cols = new System.Collections.Generic.List<int>(); foreach (var r in runs) for (int i = r[0]; i < r[1]; i++) cols.Add(i);
    if (cols.Count == 0) return "no ink";
    double pos = 0; var info = new System.Text.StringBuilder();
    foreach (var ch in value) {
      double wu = (ch == '1' ? 4 : 7) * cols.Count / units;
      int a = (int)Math.Round(pos), b = (int)Math.Round(pos + wu); pos += wu;
      if (b <= a) continue;
      int ca = cols[Math.Min(a, cols.Count - 1)], cb = cols[Math.Min(b - 1, cols.Count - 1)] + 1;
      System.Collections.Generic.List<double[]> l; if (!acc.TryGetValue(ch, out l)) acc[ch] = l = new System.Collections.Generic.List<double[]>();
      l.Add(Sample(ink, ca, cb, top, bot)); info.Append(ch + "[" + ca + "-" + cb + "]");
    }
    return info.ToString();
  }
  public static void Build(System.Collections.Generic.Dictionary<char, System.Collections.Generic.List<double[]>> acc) {
    Tpl.Clear();
    foreach (var kv in acc) { var m = new double[TW * TH]; foreach (var s in kv.Value) for (int i = 0; i < m.Length; i++) m[i] += s[i] / kv.Value.Count; Tpl[kv.Key] = m; }
  }
  public static string Dump() {
    var sb = new System.Text.StringBuilder();
    foreach (var kv in Tpl) { sb.Append(kv.Key + ":"); foreach (var v in kv.Value) sb.Append((int)Math.Round(v * 9)); sb.Append("\n"); }
    return sb.ToString();
  }
  public static void Load(string s) {
    Tpl.Clear();
    foreach (var line in s.Split(new[] { '\n', ';' }, StringSplitOptions.RemoveEmptyEntries)) {
      var p = line.Trim(); if (p.Length < 3 || p[1] != ':') continue;
      var v = new double[TW * TH]; for (int i = 0; i < v.Length && i + 2 < p.Length; i++) v[i] = (p[i + 2] - '0') / 9.0; Tpl[p[0]] = v;
    }
  }
}
// the hotbar's item counts ("102" in a slot's corner): small, bright green-leaning digits in the game's own font
// (MG BASIC 2, shipped in the Client folder). Templates are drawn from that font at the sizes that match the screen.
public static class Counts {
  public const int TW = 5, TH = 9;
  static System.Collections.Generic.List<Tuple<char, int, double[]>> tpl = new System.Collections.Generic.List<Tuple<char, int, double[]>>();
  public static int Count { get { return tpl.Count; } }
  static bool[,] Ink(Bitmap s, int x, int y, int w, int h) {
    var ink = new bool[w, h];
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) { int px = x + i, py = y + j; if (px < 0 || py < 0 || px >= s.Width || py >= s.Height) continue; var c = s.GetPixel(px, py); ink[i, j] = c.R + c.G + c.B >= 330 && c.G >= c.R; }
    return ink;
  }
  static double[] Sample(bool[,] ink, int a, int b, int t, int bt) {
    var o = new double[TW * TH]; int w = b - a, h = bt - t + 1;
    for (int r = 0; r < TH; r++) for (int c = 0; c < TW; c++) {
      int x0 = a + c * w / TW, x1 = Math.Max(x0 + 1, a + (c + 1) * w / TW), y0 = t + r * h / TH, y1 = Math.Max(y0 + 1, t + (r + 1) * h / TH);
      int n = 0, k = 0; for (int yy = y0; yy < y1; yy++) for (int xx = x0; xx < x1; xx++) { n++; if (ink[xx, yy]) k++; }
      o[r * TW + c] = n > 0 ? k / (double)n : 0;
    }
    return o;
  }
  // draw 0–9 with the game's font at each pixel size: each digit's ink cropped to its box, and its width
  public static int Make(string fontFile, float[] sizes) {
    tpl.Clear();
    var pfc = new System.Drawing.Text.PrivateFontCollection(); pfc.AddFontFile(fontFile);
    foreach (var px in sizes) using (var f = new Font(pfc.Families[0], px, FontStyle.Regular, GraphicsUnit.Pixel)) foreach (char ch in "0123456789") {
      using (var b = new Bitmap(40, 40)) using (var g = Graphics.FromImage(b)) {
        g.Clear(Color.Black); g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.SingleBitPerPixelGridFit;
        g.DrawString(ch.ToString(), f, Brushes.White, 4, 4);
        var ink = new bool[40, 40]; int l = 40, r = -1, t = 40, bt = -1;
        for (int y = 0; y < 40; y++) for (int x = 0; x < 40; x++) if (b.GetPixel(x, y).R > 128) { ink[x, y] = true; l = Math.Min(l, x); r = Math.Max(r, x); t = Math.Min(t, y); bt = Math.Max(bt, y); }
        if (r >= 0) tpl.Add(Tuple.Create(ch, r - l + 1, Sample(ink, l, r + 1, t, bt)));
      }
    }
    return tpl.Count;
  }
  static double Cost(double[] s, double[] t) { double d = 0; for (int i = 0; i < s.Length; i++) d += Math.Abs(s[i] - t[i]); return d / s.Length; }
  // the number in a box (columns split into runs of ink, each read as the cheapest chain of digits);
  // fit: the average cost per digit (lower is better), 9 when nothing was read
  public static string Read(Bitmap src, int x, int y, int w, int h, out double fit) {
    fit = 9; if (tpl.Count == 0) return "";
    var ink = Ink(src, x, y, w, h);
    int top = h, bot = -1; var cols = new bool[w];
    for (int i = 0; i < w; i++) for (int j = 0; j < h; j++) if (ink[i, j]) { cols[i] = true; top = Math.Min(top, j); bot = Math.Max(bot, j); }
    if (bot - top < 5) return "";
    int a = -1; var runs = new System.Collections.Generic.List<int[]>();
    for (int i = 0; i <= w; i++) { bool c = i < w && cols[i]; if (c && a < 0) a = i; if (!c && a >= 0) { runs.Add(new[] { a, i }); a = -1; } }
    var sb = new System.Text.StringBuilder(); double total = 0; int digits = 0;
    foreach (var r in runs) {
      int n = r[1] - r[0];
      var best = new double[n + 1]; var from = new int[n + 1]; var dig = new char[n + 1];
      for (int i = 1; i <= n; i++) best[i] = double.MaxValue;
      for (int i = 0; i < n; i++) { if (best[i] == double.MaxValue) continue;
        foreach (var tp in tpl) for (int gw = Math.Max(1, tp.Item2 - 1); gw <= tp.Item2 + 1 && i + gw <= n; gw++) {
          double c = best[i] + Cost(Sample(ink, r[0] + i, r[0] + i + gw, top, bot), tp.Item3) + 0.03;
          if (c < best[i + gw]) { best[i + gw] = c; from[i + gw] = i; dig[i + gw] = tp.Item1; } } }
      if (best[n] == double.MaxValue) continue;
      var part = new System.Text.StringBuilder(); int d = 0; for (int i = n; i > 0; i = from[i]) { part.Insert(0, dig[i]); d++; }
      sb.Append(part); total += best[n]; digits += d;
    }
    fit = digits > 0 ? total / digits : 9;
    return sb.ToString();
  }
}
'@

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
# English text recognition if Windows has it, else the PC's own language (numbers and Latin letters work in all of them)
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$engine = $null
if ([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -like 'en*' }) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { '{"error":"Windows text recognition is not available on this PC"}'; exit 1 }

# the game's effect icons (debuffs, a few buffs), loaded once: datas\interface\DATA\*_mini.bmp next to the client
$iconDir = $null
foreach ($c in @($env:SOF_GAME_DIR, 'C:\NetGame\ScionsOfFate')) { if ($c -and (Test-Path (Join-Path $c 'datas\interface\DATA'))) { $iconDir = Join-Path $c 'datas\interface\DATA'; break } }
if ($GamePid) { try { $exe = (Get-Process -Id $GamePid -ErrorAction Stop).Path; foreach ($gd in @((Split-Path $exe), (Split-Path (Split-Path $exe)))) { if (Test-Path (Join-Path $gd 'datas\interface\DATA')) { $iconDir = Join-Path $gd 'datas\interface\DATA'; break } } } catch { } }
if ($iconDir) {
  $iconFiles = @(Get-ChildItem $iconDir -File | Where-Object { $_.Name -match '_mini(_M)?\.bmp$' })
  $null = [SofScreen]::LoadIcons(@($iconFiles | ForEach-Object { $_.FullName }), @($iconFiles | ForEach-Object { $_.BaseName }))
  if (Test-Path (Join-Path $iconDir 'minimap_arrow.bmp')) { $null = [SofScreen]::LoadArrow((Join-Path $iconDir 'minimap_arrow.bmp')) }
}

# the Status window's white digits (one template per digit, 7 x 10 cells, 0-9 = how much ink), learned from a real frame
[Digits]::Load('1:0066666669999933339990000999000099900009990000999000099900009990000662;3:0488861158999301111540000493004899310115943000158100005956888941399940;7:7799995000047500047510004754004752400475242475200247520057520000000000;2:0009000299999009009920000099000079900009900009900009900009900006666666;5:0222222099777409900000992200099992004077920000099000029724229903344330;6:0000992009999009990000990200999999099900999900099990009909900990077770;4:0000990000999000499900099990099099009409909999999000099000009900000490;9:0033330069699039606999900099993039939939990666699000039603369600444400;8:0099990099009999000990990990099999049000999900099999009909999900000000;0:0088880279299229709998913999990799999292997979099499209913977920026220')
if (-not $IconIndex) { $IconIndex = Join-Path $PSScriptRoot 'data\icon-index.bin' }
if (Test-Path $IconIndex) { try { $null = [SofScreen]::LoadBuffIndex($IconIndex) } catch { } }
foreach ($id in ($HotbarIds -split ',')) { if ($id -match '^\d+$') { [void][SofScreen]::HotbarIds.Add([uint32]$id) } }
if (-not $FontFile) { $FontFile = 'C:\NetGame\ScionsOfFate\Client\MG BASIC2.TTF' }
if (Test-Path -LiteralPath $FontFile) { try { $null = [Counts]::Make($FontFile, [float[]]@(12, 13)) } catch { } }

function OcrLines([System.Drawing.Bitmap]$bmp) { @(OcrRich $bmp | ForEach-Object { $_.text }) }
# lines with where they are in the picture (x, y, w, h)
function OcrRich([System.Drawing.Bitmap]$bmp, [int]$pad = 24) {
  $padded = [SofScreen]::Pad($bmp, $pad)
  $ms = New-Object System.IO.MemoryStream; $padded.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp); $padded.Dispose()
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter $stream; $writer.WriteBytes($ms.ToArray())
  $null = Await ($writer.StoreAsync()) ([UInt32]); $stream.Seek(0)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  @($res.Lines | ForEach-Object {
    $x0 = 1e9; $y0 = 1e9; $x1 = 0; $y1 = 0
    foreach ($w in $_.Words) { $r = $w.BoundingRect; $x0 = [Math]::Min($x0, $r.X); $y0 = [Math]::Min($y0, $r.Y); $x1 = [Math]::Max($x1, $r.X + $r.Width); $y1 = [Math]::Max($y1, $r.Y + $r.Height) }
    [pscustomobject]@{ text = ($_.Text -replace '[\x00-\x1f]', ''); x = $x0 - $pad; y = $y0 - $pad; w = $x1 - $x0; h = $y1 - $y0 } })
}

# HUD positions in pixels (the game draws its HUD at a fixed size: top-left for HP/MP/level, bottom for EXP and chat)
# the HP / MP bars themselves (rows to search, and where the bar starts and ends), for reading them by colour
$Bar = @{ hp = @(9, 20); mp = @(22, 33); x0 = 57; x1 = 228 }
$R = @{ hp = @(60, 6, 175, 16); mp = @(60, 22, 175, 16); level = @(57, 48, 24, 15)   # inside the small level box only
  chat = @(0, 0, 380, 310); chatFromBottom = 345     # the whole chat area above the skill bar (it can be tall)
  shout = @(0, 0, 350, 46); shoutFromBottom = 390    # the "Lion's Roar" box above the chat
  target = @(0, 210, 168, 20); targetFromRight = 170 # the selected target's name, under the minimap
  chatPasses = @(@(0, 2), @(185, 0), @(140, 0)) }    # the game's text colours only, then white and grey text by brightness
if ($Regions -and (Test-Path $Regions)) { $j = Get-Content $Regions -Raw | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $R[$p.Name] = $p.Value } }

function Read-Frame([System.Drawing.Bitmap]$bmp) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $o = [ordered]@{ t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); w = $bmp.Width; h = $bmp.Height; via = [SofScreen]::LastMethod; ocr = $engine.RecognizerLanguage.LanguageTag }
  $read = { param($r, $scale, $lum, $mode = 0) $b = [SofScreen]::Prep($bmp, $r[0], $r[1], $r[2], $r[3], $scale, $lum, $mode)
    try { if ($DebugDir) { $b.Save((Join-Path $DebugDir ("prep_{0}_{1}_{2}.png" -f $r[1], $lum, $mode)), [System.Drawing.Imaging.ImageFormat]::Png) }; OcrLines $b } finally { $b.Dispose() } }
  # "7070 / 7070": the text recognition sometimes drops one of the numbers in this pixel font, and which one depends on
  # the size and margin of the picture: try a few until both numbers are there
  # (a word in front of the numbers helps too: "MP 1500 / 4992" is read where "1500 / 4992" alone is not)
  $pair = { param($r, $word)
    $last = ''
    foreach ($v in @(@(4, 24, ''), @(4, 40, $word), @(6, 40, $word), @(4, 60, ''), @(3, 60, ''), @(5, 40, $word))) {
      $b = [SofScreen]::Prep($bmp, $r[0], $r[1], $r[2], $r[3], $v[0], 200, 0)
      if ($v[2]) { $w = [SofScreen]::WithWord($b, $v[2]); $b.Dispose(); $b = $w }
      try { $last = ((@(OcrRich $b $v[1]) | ForEach-Object { $_.text }) -join ' ') -replace "^\s*$($v[2])\s*[:;]?\s*", '' } finally { $b.Dispose() }
      if ($last -match '\d[^\d/]*\s*[/lI|\\]\s*[^\d]*\d') { return $last }
    }
    $last }
  $o.hp = & $pair $R.hp 'HP'
  $o.mp = & $pair $R.mp 'MP'
  $o.level = (& $read $R.level 8 190) -join ' '
  $chatY = [Math]::Max(0, $bmp.Height - $R.chatFromBottom)
  # chat colours differ (white / yellow / blue / orange, grey trade chat): one pass per colour treatment, keep both;
  # each line also says what colour it is drawn in (whispers, party and house chat have colours of their own)
  $o.chat = @(); $o.chatPass = @(); $o.chatCol = @(); $o.chatY = @()
  foreach ($p in $R.chatPasses) {
    $b = [SofScreen]::Prep($bmp, $R.chat[0], $chatY, $R.chat[2], $R.chat[3], 3, $p[0], $p[1])
    try { $lines = @(OcrRich $b) } finally { $b.Dispose() }
    foreach ($l in $lines) { $o.chat += $l.text; $o.chatY += [int]($l.y / 3); $o.chatCol += [SofScreen]::LineColor($bmp, $R.chat[0] + [int]($l.x / 3), $chatY + [int]($l.y / 3), [int]($l.w / 3) + 1, [int]($l.h / 3) + 1, $p[0], $p[1]) }
    $o.chatPass += @($lines.Count)
  }
  # party members: HP from their gauges, the name from the box above each
  $o.party = @(foreach ($g in [SofScreen]::PartyBars($bmp)) {
    $v = $g -split ','; $gx = [int]$v[0]; $gy = [int]$v[1]
    [ordered]@{ name = ((& $read @(($gx - 2), ($gy - 18), ([int]$v[3] + 4), 16) 4 150 1) -join ' '); hp = [int]$v[2]; y = $gy } })
  # message boxes ("You have been disconnected from the server") open in the upper middle, over a HUD that stays
  # visible: read there every 5th look, and every look while the HUD is gone (login screen, loading)
  if (-not $o.hp -or ($script:look % 5) -eq 0) { $o.center = @(& $read @([int]($bmp.Width / 2 - 260), [int]($bmp.Height * 0.12), 520, [int]($bmp.Height * 0.34)) 2 170) }
  $script:look++
  $o.shout = @(& $read @($R.shout[0], [Math]::Max(0, $bmp.Height - $R.shoutFromBottom), $R.shout[2], $R.shout[3]) 3 170)
  $o.target = (& $read @(($bmp.Width - $R.targetFromRight), $R.target[1], $R.target[2], $R.target[3]) 4 170) -join ' '
  # the inventory open: gold and weight (the weight line is teal; the gold line is above it)
  $inv = [SofScreen]::FindInventory($bmp)
  if ($inv) {
    $v = $inv -split ',' | ForEach-Object { [int]$_ }
    $wx = [Math]::Max(0, $v[0] - 30); $ww = [Math]::Min($bmp.Width - $wx, $v[2] - $v[0] + 90)
    $wl = (& $read @($wx, ($v[1] - 4), $ww, ($v[3] - $v[1] + 9)) 3 120 1) -join ' '
    # (the gold text ends about where the weight text does: a window next to it would only confuse the OCR)
    $gx = [Math]::Max(0, $v[0] - 60); $gw = [Math]::Min($bmp.Width - $gx, $v[2] - $gx + 12)
    # a line of only digits is often dropped by the text recognition: a few sizes, with a word in front (as for HP)
    $gl = ''
    foreach ($gv in @(@(3, 24, ''), @(3, 40, 'Gold'), @(4, 40, 'Gold'), @(2, 40, 'Gold'), @(5, 60, ''))) {
      $b = [SofScreen]::NoCommas([SofScreen]::Prep($bmp, $gx, ($v[1] - 54), $gw, 26, $gv[0], 170, 0))
      if ($DebugDir) { $b.Save((Join-Path $DebugDir ("gold_{0}_{1}.png" -f $gv[0], $gv[2])), [System.Drawing.Imaging.ImageFormat]::Png) }
      if ($gv[2]) { $w2 = [SofScreen]::WithWord($b, $gv[2]); $b.Dispose(); $b = $w2 }
      try { $gl = ((@(OcrRich $b $gv[1]) | ForEach-Object { $_.text }) -join ' ') -replace "^\s*$($gv[2])\s*[:;]?\s*", '' } finally { $b.Dispose() }
      if ($gl -match '\d[\d,.\s]{5,}') { break }
    }
    if ($wl -match '\d\s*/\s*\d' -or $gl -match '\d[\d,.]{4,}') { $o.inventory = [ordered]@{ weight = $wl; gold = $gl; at = $inv } }
  }
  # the Status window (C) open: the Basic page's stats, or the Skill page: its tab, the header (Honor / Ki / A.P) and
  # the skills in it (matched by icon; on the Ascension tab with the level drawn in red on each)
  $sw = [SofScreen]::FindStatusWindow($bmp)
  if ($sw) {
    $v = $sw -split ','; $bx = [int]$v[0]; $by = [int]$v[1]; $page = [int]$v[2]
    $st = [ordered]@{ page = $page; at = "$bx,$by" }
    if ($page -eq 0) {
      # the values (white on dark boxes) with where they are, relative to the purple button: the labels next to them sit
      # on light parchment and don't come through, so the tracker tells the stats apart by position ("dx,dy,w|text")
      $rx = $bx + 140; $ry = $by + 25
      $b = [SofScreen]::Prep($bmp, $rx, $ry, 325, 320, 2, 205, 0)
      try { $ls = @(OcrRich $b) } finally { $b.Dispose() }
      $st.lines = @($ls | ForEach-Object { $_.text })
      # a sharp (uncompressed) picture of the window now and then, for teaching the digit reader the live font
      # (the debug captures are JPEG); not in test mode (-Image)
      if (-not $Image -and (-not $script:sharpAt -or ((Get-Date) - $script:sharpAt).TotalMinutes -ge 30)) {
        try {
          $dir = Join-Path $PSScriptRoot 'data\debug'; $null = New-Item -ItemType Directory -Force $dir
          $cx = [Math]::Max(0, $bx - 20); $cy = [Math]::Max(0, $by - 70); $cw = [Math]::Min($bmp.Width - $cx, 500); $ch = [Math]::Min($bmp.Height - $cy, 440)
          $crop = $bmp.Clone((New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch), $bmp.PixelFormat)
          $crop.Save((Join-Path $dir ("status-sharp-{0:yyyyMMdd-HHmmss}-b{1}x{2}.png" -f (Get-Date), ($bx - $cx), ($by - $cy))), [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose()
          $script:sharpAt = Get-Date
        } catch { }
      }
      # faction and class in their own boxes too (words: the text recognition reads them well alone)
      $fac = (& $read @(($bx + 237), ($by + 121), 60, 17) 4 150 1) -join ' '; if ($fac) { $st.lines += "Faction $fac" }
      $cls = (& $read @(($bx + 349), ($by + 121), 72, 17) 4 150 1) -join ' '; if ($cls) { $st.lines += "Class $cls" }
      $st.items = @($ls | ForEach-Object { "{0},{1},{2}|{3}" -f ([int]($rx + ($_.x + $_.w / 2) / 2 - $bx)), ([int]($ry + ($_.y + $_.h / 2) / 2 - $by)), ([int]($_.w / 2)), $_.text })
      # each number in its own box (centre dx, dy from the purple button; width), read like HP: digits alone are often
      # dropped, so with a word in front and a few sizes. Stats change rarely: read again every 15 looks at most
      if ($script:stCache -and $script:stCache.at -eq "$bx,$by" -and ($script:look - $script:stCache.look) -lt 15) { $st.fields = $script:stCache.fields }
      else {
        $boxes = @(@('level', 266, 149, 58), @('ki', 383, 149, 70), @('mastery', 378, 169, 50), @('attack', 260, 212, 38), @('skillAcc', 374, 212, 38),
          @('defense', 260, 229, 38), @('skillDef', 374, 229, 38), @('accuracy', 260, 246, 38), @('pvp', 374, 246, 38), @('evasion', 260, 263, 38),
          @('monAtk', 374, 263, 38), @('skillEvasion', 260, 280, 38), @('monDef', 374, 280, 38), @('pureDef', 374, 297, 38),
          @('int', 223, 329, 30), @('str', 282, 329, 30), @('vit', 340, 329, 30), @('dex', 401, 329, 30))
        # by shape (the game's digit font: fast, and the text recognition misses its slashed zero); where the shapes
        # don't fit, the text recognition in a few sizes
        $ocrNum = { param($fx, $fy, $fw, $tries)
          foreach ($fv in $tries) {
            $b = [SofScreen]::Prep($bmp, $fx, $fy, $fw, 16, $fv[0], 150, 1)
            if ($fv[2]) { $w = [SofScreen]::WithWord($b, $fv[2]); $b.Dispose(); $b = $w }
            try { $x = ((@(OcrRich $b $fv[1]) | ForEach-Object { $_.text }) -join ' ') -replace "^\s*$($fv[2])\s*", '' } finally { $b.Dispose() }
            $x = $x -replace '[Oo]', '0' -replace '\s', ''
            if ($x -match '^\d{1,12}$') { return $x }
          }
          '' }
        $st.fields = @(foreach ($f in $boxes) {
          $fx = $bx + $f[1] - [int]($f[3] / 2); $fy = $by + $f[2] - 8
          $shape = [Digits]::Read($bmp, $fx, $fy, $f[3], 16, 150)
          $t = $(if ($shape) { $shape } else { & $ocrNum $fx $fy $f[3] @(@(4, 30, 'No'), @(5, 40, 'No'), @(3, 40, 'No'), @(6, 40, 'No'), @(4, 60, '')) })
          "$($f[0])=$t" })
        $script:stCache = @{ at = "$bx,$by"; fields = $st.fields; look = $script:look }
      }
    }
    elseif ($page -eq 2) {
      $tab = [SofScreen]::StatusTab($bmp, $bx, $by); $st.tab = $tab
      $st.header = (& $read @(($bx + 125), ($by - 29), 330, 22) 3 180 0) -join ' '
      $icons = [SofScreen]::MatchIconArea($bmp, $bx + 255, $by + 2, $bx + 445, $by + 300, 2)
      $st.icons = $icons
      # the same icons as a moment ago: the levels from then (reading them takes a second)
      if ($tab -eq 0 -and $icons -and $script:lvCache -and $script:lvCache.icons -eq $icons -and ($script:look - $script:lvCache.look) -lt 15) { $st.levels = $script:lvCache.levels }
      elseif ($tab -eq 0 -and $icons) {
        # the red level right of the icon ("10" at x+35..46, y+6..15): digits alone are often dropped, so with a word in front
        $st.levels = @(foreach ($ic in ($icons -split ';')) {
          $p = ($ic -split '@')[1] -split ','; $ix = [int]$p[0]; $iy = [int]$p[1]
          # (as for HP: which size the text recognition reads depends on the picture, so a few until digits come back)
          $t = ''
          foreach ($lv in @(@(5, 30, 'Lv'), @(4, 40, 'Lv'), @(6, 40, 'Lv'), @(3, 40, 'Lv'), @(5, 60, 'Level'), @(7, 50, 'Lv'))) {
            $b = [SofScreen]::Prep($bmp, $ix + 33, $iy + 3, 17, 15, $lv[0], 0, 3)
            $w = [SofScreen]::WithWord($b, $lv[2]); $b.Dispose()
            if ($DebugDir) { $w.Save((Join-Path $DebugDir ("lv_{0}_{1}_{2}.png" -f $ix, $iy, $lv[0])), [System.Drawing.Imaging.ImageFormat]::Png) }
            try { $t = ((@(OcrRich $w $lv[1]) | ForEach-Object { $_.text }) -join ' ') -replace "^\s*$($lv[2])\s*", '' } finally { $w.Dispose() }
            if ($t -match '\d') { break }
          }
          "$ic=$t" })
        $script:lvCache = @{ icons = $icons; levels = $st.levels; look = $script:look }
      }
    }
    $o.status = $st
  }
  # the quest window open: the quests in its list ("[100] JungMu House Army Vice Presi…")
  # (not the Status window: its open button is the same purple)
  $qw = $(if ($sw) { '' } else { [SofScreen]::FindQuestWindow($bmp) })
  if ($qw) {
    $v = $qw -split ','
    $qx = [int]$v[0] + 165; $qy = [int]$v[1] + 66
    $o.quests = [ordered]@{ mode = $v[2]; at = "$($v[0]),$($v[1])"; lines = @(& $read @($qx, $qy, ([Math]::Min($bmp.Width - $qx, 275)), 262) 3 150) }
  }
  # an item tooltip open (hovering over gear): its lines with their colours, for the gear log
  $tt = [SofScreen]::FindTooltip($bmp)
  if ($tt) {
    $v = $tt -split ',' | ForEach-Object { [int]$_ }
    $sc = 2; $lum = 140 # read best in tests (larger scales and a lower threshold lost more words)
    $b = [SofScreen]::Prep($bmp, $v[0] + 2, $v[1] + 2, $v[2] - 4, $v[3] - 4, $sc, $lum, 1)
    try { $lines = @(OcrRich $b) } finally { $b.Dispose() }
    $o.tooltip = [ordered]@{ box = $tt; lines = @($lines | ForEach-Object { $_.text })
      cols = @($lines | ForEach-Object { [SofScreen]::LineColor($bmp, $v[0] + 2 + [int]($_.x / $sc), $v[1] + 2 + [int]($_.y / $sc), [int]($_.w / $sc) + 1, [int]($_.h / $sc) + 1, $lum, 1) }) }
  }
  # the hotbar (rows 1–0 and F1–F10 at the bottom): item icons in it, with the count drawn in their corner
  # (potions, ginseng…). Only items: skills have no count. "set:id@x,y" from the icon index, then the digits.
  $t1 = $watch.ElapsedMilliseconds
  $hb = [SofScreen]::HotbarItems($bmp)
  $o.hotbar = @(foreach ($h in @($hb -split ';' | Where-Object { $_ })) {
    $slot, $rest = $h -split '=', 2; $key, $at = $rest -split '@'; $xy = $at -split ','; $hx = [int]$xy[0]; $hy = [int]$xy[1]
    # the count in the slot's bottom-right corner, by the game font's digit shapes (null when it doesn't read well)
    $fit = 9.0; $txt = [Counts]::Read($bmp, $hx + 12, $hy + 16, 20, 13, [ref]$fit)
    [ordered]@{ slot = $slot; icon = $key; x = $hx; y = $hy; count = $(if ($txt -match '^\d{1,4}$' -and $fit -le 0.34) { [int]$txt } else { $null }); raw = $txt; fit = [math]::Round($fit, 3) }
  })
  $o.hotbarMs = $watch.ElapsedMilliseconds - $t1
  # a sharp (uncompressed) picture of the hotbar now and then while it holds counted items, for tuning the digit reader
  if (-not $Image -and $o.hotbar.Count -and (-not $script:hotbarSharpAt -or ((Get-Date) - $script:hotbarSharpAt).TotalMinutes -ge 30)) {
    try {
      $dir = Join-Path $PSScriptRoot 'data\debug'; $null = New-Item -ItemType Directory -Force $dir
      $hy0 = [Math]::Max(0, $bmp.Height - 100); $crop = $bmp.Clone((New-Object System.Drawing.Rectangle 0, $hy0, $bmp.Width, ($bmp.Height - $hy0)), $bmp.PixelFormat)
      $crop.Save((Join-Path $dir ('hotbar-sharp-{0:yyyyMMdd-HHmmss}.png' -f (Get-Date))), [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose(); $script:hotbarSharpAt = Get-Date
    } catch { }
  }
  # effect icons on you, and the player dots on the minimap
  $t0 = $watch.ElapsedMilliseconds
  $o.effects = [SofScreen]::FindIcons($bmp)
  $o.buffs = [SofScreen]::FindBuffs($bmp)
  $mm = ([SofScreen]::MinimapDots($bmp) + '||') -split '\|'
  $o.minimapMe = $mm[0]; $o.minimap = $mm[1]; $o.minimapParty = $mm[2]
  $o.iconMs = $watch.ElapsedMilliseconds - $t0
  $fill = [SofScreen]::ExpFill($bmp)
  $o.exp = $(if ($fill -lt 0) { $null } else { [math]::Round(100 * $fill, 2) })
  # the HP / MP bars by colour too: the tracker compares them with the numbers to calibrate the fast looks
  $o.bars = [ordered]@{ hp = [math]::Round([SofScreen]::BarFill($bmp, $Bar.hp[0], $Bar.hp[1], $Bar.x0, $Bar.x1, $true), 4); mp = [math]::Round([SofScreen]::BarFill($bmp, $Bar.mp[0], $Bar.mp[1], $Bar.x0, $Bar.x1, $false), 4) }
  $o.ms = $watch.ElapsedMilliseconds  # how long this look took to read
  $o | ConvertTo-Json -Compress -Depth 3
}

# a fast look between full ones (-Fast looks per second): the HP / MP / EXP bars by pixel colour only, no text recognition
function Quick-Look($hwnd) {
  $w = [Diagnostics.Stopwatch]::StartNew()
  $parts = [SofScreen]::QuickCapture($hwnd)
  if (-not $parts) { return }
  try {
    $exp = [SofScreen]::ExpFill($parts[1])
    $q = [ordered]@{ q = 1; hp = [math]::Round([SofScreen]::BarFill($parts[0], $Bar.hp[0], $Bar.hp[1], $Bar.x0, $Bar.x1, $true), 4)
      mp = [math]::Round([SofScreen]::BarFill($parts[0], $Bar.mp[0], $Bar.mp[1], $Bar.x0, $Bar.x1, $false), 4)
      exp = $(if ($exp -lt 0) { $null } else { [math]::Round(100 * $exp, 2) }); ms = $w.ElapsedMilliseconds }
    $q | ConvertTo-Json -Compress
  } finally { $parts[0].Dispose(); $parts[1].Dispose() }
}

if ($Image) { $bmp = [System.Drawing.Bitmap]::FromFile($Image); Read-Frame $bmp; exit 0 }
if (-not $GamePid) { '{"error":"no game window given"}'; exit 1 }
while ($true) {
  try {
    $proc = Get-Process -Id $GamePid -ErrorAction Stop
    $bmp = [SofScreen]::Capture($proc.MainWindowHandle)
    if (-not $bmp) { '{"state":"' + [SofScreen]::LastMethod + '"}' }
    else {
      try {
        if ($SaveFrame) { $bmp.Save($SaveFrame, [System.Drawing.Imaging.ImageFormat]::Png) }
        # the last few looks, kept as small pictures (the tracker copies them on a death or a drop)
        if ($RingDir) { [SofScreen]::SaveJpeg($bmp, (Join-Path $RingDir ("f{0}.jpg" -f ($ring++ % $RingSize))), 70) }
        Read-Frame $bmp
      } finally { $bmp.Dispose() }
    }
    if ($Once) { exit 0 }
  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { '{"state":"closed"}'; exit 0 }
  catch { '{"error":' + ($_.Exception.Message | ConvertTo-Json) + '}' }
  [Console]::Out.Flush()
  # "seconds;fast looks per second", e.g. "3;10" (0 seconds = the next full look right away)
  if ($IntervalFile -and (Test-Path $IntervalFile)) { try { $p = (Get-Content $IntervalFile -Raw).Trim() -split ';'; $v = [double]$p[0]; if ($v -ge 0 -and $v -le 60) { $Interval = $v }; if ($p.Count -gt 1) { $f = [double]$p[1]; if ($f -ge 0 -and $f -le 30) { $Fast = $f } } } catch { } }
  $until = [DateTime]::UtcNow.AddMilliseconds($Interval * 1000)
  if ($Fast -gt 0 -and $Interval -gt 0) {
    $step = 1000 / $Fast
    while ([DateTime]::UtcNow -lt $until) {
      $t0 = [DateTime]::UtcNow
      try { Quick-Look $proc.MainWindowHandle; [Console]::Out.Flush() } catch { if (-not $qErr) { $qErr = 1; '{"qerr":' + ($_.Exception.Message | ConvertTo-Json) + '}'; [Console]::Out.Flush() } }
      $left = [Math]::Min($step - ([DateTime]::UtcNow - $t0).TotalMilliseconds, ($until - [DateTime]::UtcNow).TotalMilliseconds)
      if ($left -gt 1) { Start-Sleep -Milliseconds ([int]$left) }
    }
  } elseif ($Interval -gt 0) { Start-Sleep -Milliseconds ([int]($Interval * 1000)) }
}
