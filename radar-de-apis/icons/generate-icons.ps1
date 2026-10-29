# Recria os PNGs do Chrome usando o desenho vetorial de radar.svg como referência.
# Execute no Windows: powershell -File .\icons\generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$canvas = New-Object System.Drawing.Bitmap 512, 512
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(4, 4)

$backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#101b2d'))
$sectorBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#193e4b'))
$greenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#57e3ad'))
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#e7edf7'))
$ringPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#75bbff')), 4
$sweepPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#57e3ad')), 6
$sweepPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$sweepPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$outline = New-Object System.Drawing.Drawing2D.GraphicsPath

try {
    # Fundo com cantos arredondados e transparência fora do contorno.
    $outline.AddArc(0, 0, 56, 56, 180, 90)
    $outline.AddArc(72, 0, 56, 56, 270, 90)
    $outline.AddArc(72, 72, 56, 56, 0, 90)
    $outline.AddArc(0, 72, 56, 56, 90, 90)
    $outline.CloseFigure()
    $graphics.FillPath($backgroundBrush, $outline)

    # Anéis, varredura e pontos representam chamadas detectadas pelo radar.
    $graphics.FillPie($sectorBrush, 21, 21, 86, 86, 315, 45)
    $graphics.DrawEllipse($ringPen, 21, 21, 86, 86)
    $graphics.DrawEllipse($ringPen, 40, 40, 48, 48)
    $graphics.DrawLine($sweepPen, 64, 64, 94, 34)
    $graphics.FillEllipse($greenBrush, 58, 58, 12, 12)
    $graphics.FillEllipse($greenBrush, 31, 71, 14, 14)
    $graphics.FillEllipse($whiteBrush, 77, 78, 10, 10)

    # Reduz o desenho maior para preservar bordas suaves nos tamanhos menores.
    foreach ($size in @(16, 32, 48, 128)) {
        $icon = New-Object System.Drawing.Bitmap $size, $size
        $outputGraphics = [System.Drawing.Graphics]::FromImage($icon)

        try {
            $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $outputGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $outputGraphics.DrawImage($canvas, 0, 0, $size, $size)
            $icon.Save((Join-Path $PSScriptRoot "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally {
            $outputGraphics.Dispose()
            $icon.Dispose()
        }
    }
}
finally {
    $outline.Dispose()
    $sweepPen.Dispose()
    $ringPen.Dispose()
    $whiteBrush.Dispose()
    $greenBrush.Dispose()
    $sectorBrush.Dispose()
    $backgroundBrush.Dispose()
    $graphics.Dispose()
    $canvas.Dispose()
}
