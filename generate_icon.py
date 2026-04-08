"""Generate Krawl app icon - a stylized 'K' with document/search motif"""
from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 512

img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background: rounded square with dark gradient feel
def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.pieslice([x0, y0, x0 + 2*radius, y0 + 2*radius], 180, 270, fill=fill)
    draw.pieslice([x1 - 2*radius, y0, x1, y0 + 2*radius], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2*radius, x0 + 2*radius, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2*radius, y1 - 2*radius, x1, y1], 0, 90, fill=fill)

# Main background - deep dark
rounded_rect(draw, [10, 10, SIZE-10, SIZE-10], 90, (15, 17, 27, 255))

# Subtle border glow
for i in range(4):
    offset = 12 + i
    r = 88 - i
    alpha = 80 - i * 18
    # Only draw the border by overlaying
    
# Inner highlight border  
rounded_rect(draw, [12, 12, SIZE-12, SIZE-12], 88, (26, 29, 42, 255))
rounded_rect(draw, [16, 16, SIZE-16, SIZE-16], 84, (18, 21, 33, 255))

cx, cy = SIZE // 2, SIZE // 2
stroke_w = 44

# Vertical bar of K - bright indigo
draw.rectangle([cx - 105, cy - 150, cx - 105 + stroke_w, cy + 150], fill=(129, 140, 248, 255))

# Upper arm - indigo
arm_pts = [
    (cx - 61, cy - 20),
    (cx + 105, cy - 150),
    (cx + 105, cy - 150 + 52),
    (cx - 61, cy + 22),
]
draw.polygon(arm_pts, fill=(129, 140, 248, 255))

# Lower arm - purple gradient effect
arm_pts2 = [
    (cx - 61, cy - 12),
    (cx - 61, cy + 30),
    (cx + 105, cy + 150),
    (cx + 105, cy + 150 - 52),
]
draw.polygon(arm_pts2, fill=(168, 85, 247, 255))

# Accent dot - golden yellow (like a search beacon)
draw.ellipse([cx + 72, cy + 95, cx + 125, cy + 148], fill=(251, 191, 36, 255))

# Save as PNG
img.save('c:/Users/NICK/Documents/GESTOR DE ARCHIVOS/build/icon.png', 'PNG')

# Create ICO with multiple sizes
sizes = [16, 24, 32, 48, 64, 128, 256]
img_256 = img.resize((256, 256), Image.LANCZOS)
img_256.save('c:/Users/NICK/Documents/GESTOR DE ARCHIVOS/build/icon.ico', 'ICO', 
             sizes=[(s, s) for s in sizes])

print("Icons generated: build/icon.png and build/icon.ico")
