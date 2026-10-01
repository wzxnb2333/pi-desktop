param([Parameter(Mandatory)][string]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DesktopImeAcceptance {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUIINFO { public uint size, flags; public IntPtr active, focus, capture, menu, move, caret; public RECT rect; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint current, uint target, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr LoadKeyboardLayout(string name, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] input, int size);
  [DllImport("imm32.dll")] static extern IntPtr ImmGetDefaultIMEWnd(IntPtr h);
  static void Press(ushort key) {
    var input = new INPUT[2];
    input[0].type = input[1].type = 1;
    input[0].data.keyboard.vk = input[1].data.keyboard.vk = key;
    input[1].data.keyboard.flags = 2;
    if (SendInput(2, input, Marshal.SizeOf<INPUT>()) != 2) throw new Exception("Native keyboard input failed");
  }
  public static void Run(long handle) {
    IntPtr target = new IntPtr(handle);
    IntPtr previousWindow = GetForegroundWindow();
    uint ignored;
    uint thread = GetWindowThreadProcessId(target, out ignored);
    IntPtr previousLayout = GetKeyboardLayout(thread);
    uint foregroundThread = GetWindowThreadProcessId(previousWindow, out ignored);
    uint currentThread = GetCurrentThreadId();
    bool attached = currentThread != foregroundThread && AttachThreadInput(currentThread, foregroundThread, true);
    try { SetForegroundWindow(target); }
    finally { if (attached) AttachThreadInput(currentThread, foregroundThread, false); }
    Thread.Sleep(150);
    if (GetForegroundWindow() != target) {
      var name = new StringBuilder(256);
      GetClassName(GetForegroundWindow(), name, 256);
      if (name.ToString() == "XamlExplorerHostIslandWindow") {
        Press(27);
        Thread.Sleep(300);
        SetForegroundWindow(target);
        Thread.Sleep(150);
      }
      if (GetForegroundWindow() != target) throw new Exception("Acceptance window is not foreground; foreground class=" + name);
    }
    var info = new GUIINFO { size=(uint)Marshal.SizeOf<GUIINFO>() };
    if (!GetGUIThreadInfo(thread, ref info) || info.focus == IntPtr.Zero) throw new Exception("No focused acceptance control");
    IntPtr ime = ImmGetDefaultIMEWnd(info.focus);
    IntPtr open = SendMessage(ime, 0x0283, new IntPtr(5), IntPtr.Zero);
    IntPtr conversion = SendMessage(ime, 0x0283, new IntPtr(1), IntPtr.Zero);
    try {
      IntPtr chinese = LoadKeyboardLayout("00000804", 0);
      if (chinese == IntPtr.Zero) throw new Exception("Chinese layout unavailable");
      SendMessage(target, 0x0050, IntPtr.Zero, chinese);
      SendMessage(info.focus, 0x0050, IntPtr.Zero, chinese);
      Thread.Sleep(250);
      ime = ImmGetDefaultIMEWnd(info.focus);
      SendMessage(ime, 0x0283, new IntPtr(6), new IntPtr(1));
      SendMessage(ime, 0x0283, new IntPtr(2), new IntPtr(1));
      foreach (char key in "NIHAO ") {
        if (GetForegroundWindow() != target) { SetForegroundWindow(target); Thread.Sleep(150); }
        if (GetForegroundWindow() != target) throw new Exception("Cannot restore acceptance window focus");
        Press(key);
        Thread.Sleep(80);
      }
      Thread.Sleep(300);
    } finally {
      SendMessage(ime, 0x0283, new IntPtr(2), conversion);
      SendMessage(ime, 0x0283, new IntPtr(6), open);
      SendMessage(target, 0x0050, IntPtr.Zero, previousLayout);
      SendMessage(info.focus, 0x0050, IntPtr.Zero, previousLayout);
      if (previousWindow != target) SetForegroundWindow(previousWindow);
    }
  }
}
'@
[DesktopImeAcceptance]::Run([long]$WindowHandle)
