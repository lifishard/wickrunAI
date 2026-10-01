'use strict';

const {execFile,spawnSync}=require('node:child_process');
const fs=require('node:fs');

const PROCESS_NAME=/^[a-zA-Z0-9_. -]{1,80}$/;
const cleanAllowlist=list=>[...new Set((Array.isArray(list)?list:[]).map(x=>String(x).trim()).filter(x=>PROCESS_NAME.test(x)))].slice(0,50);
const run=(command,args,execFileImpl=execFile)=>new Promise((resolve,reject)=>{
  execFileImpl(command,args,{timeout:4000,maxBuffer:64*1024,windowsHide:true},(error,stdout)=>error?reject(error):resolve(String(stdout??'')));
});

function desktopSourceStatus({platform=process.platform,env=process.env,spawnSyncImpl=spawnSync}={}){
  if(platform==='win32'){
    const probe=spawnSyncImpl('powershell.exe',['-NoProfile','-Command','$PSVersionTable.PSVersion.Major'],{timeout:1500,windowsHide:true});
    return {available:!probe.error&&probe.status===0,note:'读取前台窗口中可访问、可见的静态文字；需要应用开放 UI Automation。'};
  }
  if(platform==='darwin'){
    const probe=spawnSyncImpl('osascript',['-e','return "ok"'],{timeout:1500});
    return {available:!probe.error&&probe.status===0,note:'读取前台应用的 AXStaticText；macOS 需在辅助功能权限中批准 wickrunAI。'};
  }
  if(platform==='linux'){
    if(env.WAYLAND_DISPLAY)return {available:false,note:'Wayland 会话没有可用的窗口读取权限。'};
    if(!env.DISPLAY)return {available:false,note:'未检测到 X11 显示会话。'};
    const probe=spawnSyncImpl('xdotool',['--version'],{timeout:1500});
    return {available:!probe.error&&probe.status===0,note:'X11 只能读取白名单前台窗口标题；不会假称能读取窗口正文。'};
  }
  return {available:false,note:'此系统暂未提供可访问的前台文字读取。'};
}

function windowsScript(allowlist){
  const names=allowlist.map(x=>`'${x.replace(/'/g,"''")}'`).join(',');
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -Namespace Butler -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
'@
$window = [Butler.Native]::GetForegroundWindow()
$foregroundProcessId = [uint32]0
[void][Butler.Native]::GetWindowThreadProcessId($window,[ref]$foregroundProcessId)
$proc = Get-Process -Id $foregroundProcessId -ErrorAction Stop
$processName = $proc.ProcessName + '.exe'
$allowed = @(${names})
if($allowed -notcontains $processName -and $allowed -notcontains $proc.ProcessName){ return }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($window)
$chunks = New-Object System.Collections.Generic.List[string]
if($root -and -not $root.Current.IsOffscreen){
  $title = [string]$root.Current.Name
  if($title){$chunks.Add($title)}
  $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $limit = [Math]::Min($elements.Count,300)
  for($i=0;$i -lt $limit;$i++){
    $element = $elements.Item($i)
    try {
      $current = $element.Current
      if($current.IsOffscreen -or $current.IsPassword -or $current.ControlType -eq [System.Windows.Automation.ControlType]::Edit){continue}
      if($current.ControlType -ne [System.Windows.Automation.ControlType]::Text -and $current.ControlType -ne [System.Windows.Automation.ControlType]::Document){continue}
      $value = [string]$current.Name
      if($value -and $value.Length -le 1000){$chunks.Add($value)}
      if($chunks.Count -ge 100){break}
    } catch {}
  }
}
@{processName=$processName;title=($chunks | Select-Object -First 1);text=($chunks -join " ")} | ConvertTo-Json -Compress -Depth 3
`;
}

function macScript(allowlist){
  const names=allowlist.map(x=>`"${x.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`).join(', ');
  return `set allowedNames to {${names}}
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set processName to name of frontApp
  if processName is not in allowedNames then return ""
  set chunks to {}
  try
    tell frontApp
      set frontWindow to front window
      set end of chunks to name of frontWindow as text
      set elements to entire contents of frontWindow
      repeat with elementItem in elements
        try
          if role of elementItem is "AXStaticText" then
            set valueText to value of elementItem as text
            if length of valueText is less than 1001 then set end of chunks to valueText
          end if
        end try
        if count of chunks is greater than 100 then exit repeat
      end repeat
    end tell
  end try
  return processName & linefeed & (chunks as text)
end tell`;
}

async function readForegroundText({allowlist,platform=process.platform,env=process.env,execFileImpl=execFile}={}){
  const allowed=cleanAllowlist(allowlist);
  if(!allowed.length)return null;
  if(platform==='win32'){
    const encoded=Buffer.from(windowsScript(allowed),'utf16le').toString('base64');
    const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded],execFileImpl);
    if(!output.trim())return null;
    const result=JSON.parse(output.trim());
    if(!allowed.some(name=>name.toLowerCase()===String(result.processName).toLowerCase())||!result.text)return null;
    return {processName:String(result.processName),title:String(result.title??''),text:String(result.text).slice(0,8000)};
  }
  if(platform==='darwin'){
    const output=await run('osascript',['-e',macScript(allowed)],execFileImpl);
    if(!output.trim())return null;
    const [processName,...rest]=output.trim().split(/\r?\n/);
    if(!allowed.some(name=>name.toLowerCase()===processName.toLowerCase()))return null;
    return {processName,title:'',text:rest.join(' ').slice(0,8000)};
  }
  if(platform==='linux'&&env.DISPLAY&&!env.WAYLAND_DISPLAY){
    const windowId=(await run('xdotool',['getactivewindow'],execFileImpl)).trim();
    if(!/^\d+$/.test(windowId))return null;
    const [pidText,title]=await Promise.all([run('xdotool',['getwindowpid',windowId],execFileImpl),run('xdotool',['getwindowname',windowId],execFileImpl)]);
    const pid=Number(pidText.trim());if(!Number.isSafeInteger(pid)||pid<=0)return null;
    const processName=fs.readFileSync(`/proc/${pid}/comm`,'utf8').trim();
    if(!allowed.some(name=>name.toLowerCase()===processName.toLowerCase()))return null;
    return {processName,title:title.trim(),text:title.trim().slice(0,8000)};
  }
  return null;
}

async function listSourceApps({platform=process.platform,execFileImpl=execFile}={}) {
  let text='';
  if(platform==='win32')text=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object {$_.ProcessName + '.exe'} | Sort-Object -Unique"],execFileImpl);
  else if(platform==='darwin')text=(await run('osascript',['-e','tell application "System Events" to get name of every application process whose background only is false'],execFileImpl)).split(', ').join('\n');
  else if(platform==='linux')text=await run('ps',['-eo','comm='],execFileImpl);
  return cleanAllowlist(text.split(/\r?\n/)).map(id=>({id,name:id}));
}
module.exports={desktopSourceStatus,readForegroundText,cleanAllowlist,windowsScript,macScript,listSourceApps};
