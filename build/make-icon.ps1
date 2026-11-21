param(
  [string]$In  = "C:\Users\Administrator\Doubao\chats\2026-11-21\new-chat-1\hongguo-skin\build\icon\raw.png",
  [string]$OutDir = "C:\Users\Administrator\Doubao\chats\2026-11-21\new-chat-1\hongguo-skin\build\icon"
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Common -ErrorAction SilentlyContinue

function New-RoundedPath([int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($w - $d, 0, $d, $d, 270, 90)
  $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  $p.AddArc(0, $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$src = [System.Drawing.Bitmap]::FromFile($In)

# 1) 找到非白区域的包围盒
$minX = $src.Width; $minY = $src.Height; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $src.Height; $y += 2) {
  for ($x = 0; $x -lt $src.Width; $x += 2) {
    $c = $src.GetPixel($x, $y)
    if ($c.A -gt 40 -and ($c.R -lt 244 -or $c.G -lt 244 -or $c.B -lt 244)) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
"包围盒: $minX,$minY - $maxX,$maxY"
$bw = $maxX - $minX; $bh = $maxY - $minY
$side = [Math]::Min($bw, $bh)
$cx = $minX + $bw / 2; $cy = $minY + $bh / 2
$rect = New-Object System.Drawing.Rectangle `
  ([int]($cx - $side / 2)), ([int]($cy - $side / 2)), $side, $side

# 2) 1024 母版：裁方 + 圆角遮罩（角外透明）
$size = 1024
$master = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($master)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$path = New-RoundedPath $size $size ([int]($size * 0.225))
$g.SetClip($path)
$dest = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$g.DrawImage($src, $dest, $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.ResetClip()
$g.Dispose()
$src.Dispose()

# 3) 母版 + 各尺寸 PNG
$master.Save((Join-Path $OutDir "master-1024.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngBytes = @{}
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.DrawImage($master, 0, 0, $s, $s)
  $gg.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes[$s] = $ms.ToArray()
  $ms.Dispose(); $bmp.Dispose()
}
# 界面用：256 + 128
[System.IO.File]::WriteAllBytes((Join-Path $OutDir "app-256.png"), $pngBytes[256])

# 4) 组装 ICO（Vista+ PNG 压缩条目）
$fsPath = Join-Path $OutDir "hongguo.ico"
$fs = [System.IO.File]::Create($fsPath)
$bw2 = New-Object System.IO.BinaryWriter($fs)
$bw2.Write([UInt16]0); $bw2.Write([UInt16]1); $bw2.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
$entries = @()
foreach ($s in $sizes) {
  $entries += [PSCustomObject]@{ Size = $s; Bytes = $pngBytes[$s]; Offset = $offset }
  $offset += $pngBytes[$s].Length
}
foreach ($e in $entries) {
  $b = [byte]($(if ($e.Size -ge 256) { 0 } else { $e.Size }))
  $bw2.Write($b); $bw2.Write($b)      # 宽 / 高
  $bw2.Write([byte]0); $bw2.Write([byte]0)  # 调色板 / 保留
  $bw2.Write([UInt16]1); $bw2.Write([UInt16]32)
  $bw2.Write([UInt32]$e.Bytes.Length); $bw2.Write([UInt32]$e.Offset)
}
foreach ($e in $entries) { $bw2.Write($e.Bytes) }
$bw2.Flush(); $bw2.Dispose(); $fs.Close()
$master.Dispose()
Get-ChildItem $OutDir | Select-Object Name, Length | Format-Table -AutoSize
