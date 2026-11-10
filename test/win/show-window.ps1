Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'dsh-scissors test window'
$form.Width = 420
$form.Height = 260
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.Add_Shown({
  $form.TopMost = $false
  $form.Activate()
})

[System.Windows.Forms.Application]::Run($form)
