param([Parameter(Mandatory=$true)][string]$SourcePath, [Parameter(Mandatory=$true)][string]$DestinationPath)
$ErrorActionPreference = 'Stop'
$wordApp = $null
$wordDoc = $null
$noSave = 0
$falseValue = $false
$trueValue = $true
try {
  $wordApp = New-Object -ComObject Word.Application
  $wordApp.Visible = $false
  $wordApp.DisplayAlerts = 0
  $originalSecurity = $wordApp.AutomationSecurity
  $originalLinks = $wordApp.Options.UpdateLinksAtOpen
  $wordApp.AutomationSecurity = 3
  $wordApp.Options.UpdateLinksAtOpen = $false
  $wordDoc = $wordApp.Documents.Open([ref]$SourcePath, [ref]$falseValue, [ref]$trueValue, [ref]$falseValue)
  $wordDoc.ExportAsFixedFormat($DestinationPath, 17, $false)
} finally {
  try {
    if ($null -ne $wordDoc) { try { $wordDoc.Close([ref]$noSave) } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordDoc) } }
  } finally {
    if ($null -ne $wordApp) {
      try {
        if ($null -ne $originalSecurity) { $wordApp.AutomationSecurity = $originalSecurity }
        if ($null -ne $originalLinks) { $wordApp.Options.UpdateLinksAtOpen = $originalLinks }
      } finally {
        try { $wordApp.Quit([ref]$noSave) } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp) }
      }
    }
  }
}
