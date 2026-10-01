$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$resourceDir = Join-Path $PSScriptRoot '../resources'
New-Item -ItemType Directory -Path $resourceDir -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(38, 40, 39))
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(239, 239, 231), 18)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawBezier($pen, 53, 87, 85, 69, 156, 87, 199, 78)
$graphics.DrawBezier($pen, 94, 83, 94, 123, 93, 160, 73, 183)
$graphics.DrawBezier($pen, 158, 85, 153, 132, 147, 195, 184, 180)
$bitmap.Save((Join-Path $resourceDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = [System.IO.File]::ReadAllBytes((Join-Path $resourceDir 'icon.png'))
$stream = [System.IO.File]::Create((Join-Path $resourceDir 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length); $writer.Write([UInt32]22); $writer.Write($pngBytes)
$writer.Dispose(); $graphics.Dispose(); $pen.Dispose(); $bitmap.Dispose()
