Add-Type -AssemblyName System.Drawing

$OutputDir = "c:\Users\Administrator\Desktop\POD\docs\line-rich-menu"

function New-Brush([string]$hex) {
  return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function Draw-MenuImage {
  param(
    [string]$Path,
    [string]$Title,
    [string]$Subtitle,
    [array]$Tiles
  )

  $bitmap = New-Object System.Drawing.Bitmap 2500, 1686
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#F6F0FF"))
  $panelBrush = New-Brush "#FFFFFF"
  $heroBrush = New-Brush "#4A31A6"
  $titleBrush = New-Brush "#FFFFFF"
  $subtitleBrush = New-Brush "#E9E0FF"
  $footerBrush = New-Brush "#8A7AAE"

  $graphics.FillRectangle($panelBrush, 66, 66, 2368, 1554)
  $graphics.FillRectangle($heroBrush, 66, 66, 2368, 300)

  $titleFont = New-Object System.Drawing.Font("Segoe UI", 40, [System.Drawing.FontStyle]::Bold)
  $subtitleFont = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Regular)
  $tileTitleFont = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
  $tileTextFont = New-Object System.Drawing.Font("Segoe UI", 19, [System.Drawing.FontStyle]::Regular)
  $footerFont = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Regular)

  $graphics.DrawString($Title, $titleFont, $titleBrush, 152, 132)
  $graphics.DrawString($Subtitle, $subtitleFont, $subtitleBrush, 152, 220)

  foreach ($tile in $Tiles) {
    $bgBrush = New-Brush $tile.Background
    $iconBrush = New-Brush $tile.IconColor
    $headBrush = New-Brush $tile.TitleColor
    $bodyBrush = New-Brush $tile.TextColor

    $graphics.FillRectangle($bgBrush, $tile.X, $tile.Y, 688, 500)
    $graphics.FillEllipse($iconBrush, $tile.X + 54, $tile.Y + 72, 116, 116)
    $graphics.DrawString($tile.Title, $tileTitleFont, $headBrush, $tile.X + 208, $tile.Y + 86)
    $textRect = New-Object System.Drawing.RectangleF -ArgumentList @(([single]($tile.X + 208)), ([single]($tile.Y + 164)), ([single]430), ([single]180))
    $graphics.DrawString($tile.Text, $tileTextFont, $bodyBrush, $textRect)
  }

  $graphics.DrawString("Export this PNG and upload to LINE Rich Menu", $footerFont, $footerBrush, 152, 1560)
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

$homeTiles = @(
  @{ X = 132; Y = 430; Background = "#F7F1FF"; IconColor = "#7B5CFF"; Title = "Products"; TitleColor = "#2C2158"; Text = "Open the product flow and buy on web"; TextColor = "#6B5CA5" },
  @{ X = 906; Y = 430; Background = "#FFF8EE"; IconColor = "#D97706"; Title = "Promo"; TitleColor = "#5A3E00"; Text = "Jump to highlighted deals"; TextColor = "#A06A17" },
  @{ X = 1680; Y = 430; Background = "#F3F0FF"; IconColor = "#3F2B96"; Title = "Chat"; TitleColor = "#2C2158"; Text = "Open the realtime web room"; TextColor = "#6B5CA5" },
  @{ X = 132; Y = 992; Background = "#F6FBFF"; IconColor = "#2D9CDB"; Title = "Reviews"; TitleColor = "#153B56"; Text = "Build trust before purchase"; TextColor = "#5C7A95" },
  @{ X = 906; Y = 992; Background = "#F8FAFF"; IconColor = "#5C6BFF"; Title = "Track"; TitleColor = "#263A87"; Text = "Check order status anytime"; TextColor = "#5A6FB6" },
  @{ X = 1680; Y = 992; Background = "#F5F0FF"; IconColor = "#8B5CF6"; Title = "Catalog"; TitleColor = "#452E85"; Text = "Switch to product categories"; TextColor = "#7A66B6" }
)

$catalogTiles = @(
  @{ X = 132; Y = 430; Background = "#F4F0FF"; IconColor = "#5C6BFF"; Title = "Set"; TitleColor = "#263A87"; Text = "Bundles for value-focused buyers"; TextColor = "#6678BC" },
  @{ X = 906; Y = 430; Background = "#F3FAFF"; IconColor = "#2D9CDB"; Title = "Small"; TitleColor = "#153B56"; Text = "Easy trial and light budget"; TextColor = "#5C7A95" },
  @{ X = 1680; Y = 430; Background = "#F8F2FF"; IconColor = "#8B5CF6"; Title = "Large"; TitleColor = "#452E85"; Text = "For repeat and ongoing usage"; TextColor = "#7A66B6" },
  @{ X = 132; Y = 992; Background = "#FFF8EE"; IconColor = "#D97706"; Title = "Articles"; TitleColor = "#5A3E00"; Text = "Educational content and tips"; TextColor = "#A06A17" },
  @{ X = 906; Y = 992; Background = "#F8F8FF"; IconColor = "#3F2B96"; Title = "Account"; TitleColor = "#2C2158"; Text = "Open login and customer tools"; TextColor = "#6B5CA5" },
  @{ X = 1680; Y = 992; Background = "#F5F0FF"; IconColor = "#7B5CFF"; Title = "Home"; TitleColor = "#452E85"; Text = "Switch back to the main menu"; TextColor = "#7A66B6" }
)

Draw-MenuImage -Path (Join-Path $OutputDir "customer-home-richmenu.png") -Title "Khun Junenuch For Life" -Subtitle "Main rich menu for the easiest customer selling flow" -Tiles $homeTiles
Draw-MenuImage -Path (Join-Path $OutputDir "customer-catalog-richmenu.png") -Title "Catalog And Quick Links" -Subtitle "Menu 2 for category browsing and support links" -Tiles $catalogTiles

Write-Output "line-rich-menu-images-generated"
