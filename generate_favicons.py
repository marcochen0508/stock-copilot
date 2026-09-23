import os
from PIL import Image, ImageDraw, ImageFilter

def create_favicon_assets():
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    os.makedirs(static_dir, exist_ok=True)
    
    # 1. Create static/favicon.svg
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a101f"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="lineGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
    <linearGradient id="bar1" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="bar2" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
    <linearGradient id="bar3" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#b91c1c"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Squircle Base -->
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bgGrad)" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.35"/>

  <!-- Candlesticks / Growth Bars -->
  <!-- Bar 1 (Left) -->
  <rect x="12" y="32" width="8" height="20" rx="2" fill="url(#bar1)"/>
  <line x1="16" y1="28" x2="16" y2="32" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="16" y1="52" x2="16" y2="54" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>

  <!-- Bar 2 (Middle) -->
  <rect x="26" y="24" width="8" height="28" rx="2" fill="url(#bar2)"/>
  <line x1="30" y1="20" x2="30" y2="24" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="30" y1="52" x2="30" y2="54" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>

  <!-- Bar 3 (Right - Bullish Up) -->
  <rect x="40" y="15" width="8" height="37" rx="2" fill="url(#bar3)"/>
  <line x1="44" y1="11" x2="44" y2="15" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="44" y1="52" x2="44" y2="54" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/>

  <!-- Upward Trendline & Breakout Arrow -->
  <path d="M 12 40 Q 28 32, 48 13" fill="none" stroke="url(#lineGrad)" stroke-width="3" stroke-linecap="round" filter="url(#glow)"/>
  
  <!-- Arrow Head / Bullish Star Peak -->
  <circle cx="48" cy="13" r="3.5" fill="#ffffff" stroke="#ef4444" stroke-width="1.5"/>
</svg>
'''
    svg_path = os.path.join(static_dir, "favicon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content.strip())
    print("Created:", svg_path)

    # 2. Render high-res PNG using Pillow (512x512)
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background rounded rectangle
    margin = 16
    radius = 110
    draw.rounded_rectangle(
        [(margin, margin), (size - margin, size - margin)],
        radius=radius,
        fill=(10, 16, 31, 255),
        outline=(56, 189, 248, 120),
        width=12
    )

    # Bars
    # Bar 1 (Left Cyan)
    draw.line([(128, 220), (128, 430)], fill=(56, 189, 248, 255), width=12) # wick
    draw.rounded_rectangle([(96, 260), (160, 420)], radius=16, fill=(56, 189, 248, 255))

    # Bar 2 (Middle Indigo)
    draw.line([(240, 160), (240, 430)], fill=(129, 140, 248, 255), width=12) # wick
    draw.rounded_rectangle([(208, 190), (272, 420)], radius=16, fill=(129, 140, 248, 255))

    # Bar 3 (Right Red/Up)
    draw.line([(352, 90), (352, 430)], fill=(239, 68, 68, 255), width=12) # wick
    draw.rounded_rectangle([(320, 120), (384, 420)], radius=16, fill=(239, 68, 68, 255))

    # Dynamic Upward Curve
    # Points along curve
    curve_points = []
    for t in range(0, 101):
        ratio = t / 100.0
        # Quadratic bezier from (90, 320) through (220, 260) to (400, 100)
        p0 = (90, 320)
        p1 = (220, 250)
        p2 = (400, 100)
        x = (1 - ratio)**2 * p0[0] + 2 * (1 - ratio) * ratio * p1[0] + ratio**2 * p2[0]
        y = (1 - ratio)**2 * p0[1] + 2 * (1 - ratio) * ratio * p1[1] + ratio**2 * p2[1]
        curve_points.append((x, y))

    for i in range(len(curve_points) - 1):
        progress = i / len(curve_points)
        # Interpolate color from cyan (56, 189, 248) to gold to red (239, 68, 68)
        if progress < 0.5:
            c_r = int(56 + (245 - 56) * (progress * 2))
            c_g = int(189 + (158 - 189) * (progress * 2))
            c_b = int(248 + (11 - 248) * (progress * 2))
        else:
            p2_prog = (progress - 0.5) * 2
            c_r = int(245 + (239 - 245) * p2_prog)
            c_g = int(158 + (68 - 158) * p2_prog)
            c_b = int(11 + (68 - 11) * p2_prog)
        draw.line([curve_points[i], curve_points[i+1]], fill=(c_r, c_g, c_b, 255), width=24)

    # Bullish glowing peak point
    peak_x, peak_y = curve_points[-1]
    # Red glow circle
    draw.ellipse([(peak_x - 36, peak_y - 36), (peak_x + 36, peak_y + 36)], fill=(239, 68, 68, 180))
    # White core
    draw.ellipse([(peak_x - 22, peak_y - 22), (peak_x + 22, peak_y + 22)], fill=(255, 255, 255, 255))

    # Save multiple resolutions
    p512 = os.path.join(static_dir, "icon-512.png")
    img.save(p512, "PNG")

    p180 = os.path.join(static_dir, "apple-touch-icon.png")
    img.resize((180, 180), Image.Resampling.LANCZOS).save(p180, "PNG")

    p32 = os.path.join(static_dir, "favicon-32x32.png")
    img32 = img.resize((32, 32), Image.Resampling.LANCZOS)
    img32.save(p32, "PNG")

    p16 = os.path.join(static_dir, "favicon-16x16.png")
    img16 = img.resize((16, 16), Image.Resampling.LANCZOS)
    img16.save(p16, "PNG")

    # Multi-resolution ICO
    ico_path = os.path.join(static_dir, "favicon.ico")
    img.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("Created:", ico_path, p180, p32, p16, p512)

if __name__ == "__main__":
    create_favicon_assets()
